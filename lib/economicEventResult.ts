import { supabase } from "./supabase";

// Ergebnis eines Wirtschaftstermins (CPI/PCE/NFP/FOMC) aus den News statt aus
// FRED (Toby 14.10.2026): FRED traegt neue Werte oft erst Stunden spaeter ein,
// und der Indexstand gegen den Vormonat ergab bei CPI praktisch immer
// "baerisch". Die Schlagzeilen ("CPI hoeher als erwartet") sind dagegen
// Minuten nach der Veroeffentlichung da (nexus-news-collector). Daraus
// schreibt eine KI einmal 1-2 Saetze plus bullish/bearish, gespeichert in
// economic_event_results (app/api/economic-result/generate/route.ts).
// Angezeigt im Lagebild, in der Kalender-Kachel und per Push
// (send-state-change-push liest dieselbe Tabelle).

export type EconomicResultBias = "bullish" | "bearish" | "neutral";

export interface EconomicEventResult {
  event_key: string;
  event_date: string;
  bias: EconomicResultBias;
  summary: string;
  created_at: string;
}

export interface ResultHeadline {
  published_at: string;
  title: string;
  title_de: string | null;
}

// Schlagzeilen, die zum Termin passen. Bewusst ueber den Titel statt die
// News-Kategorie: der Analyst ordnet CPI-Meldungen mal "cpi", mal "fed" zu.
export const EVENT_HEADLINE_PATTERN: Record<string, RegExp> = {
  cpi: /\bCPI\b|\bVPI\b|consumer price|verbraucherpreis|inflation/i,
  pce: /\bPCE\b|personal consumption|konsumausgaben|inflation/i,
  nfp: /non-?farm|payrolls|jobs report|arbeitsmarkt|besch(ä|ae)ftigung|unemployment|arbeitslos/i,
  fomc: /\bFOMC\b|zinsentscheid|leitzins|rate (cut|hike|decision)|zinssenkung|zinserh(ö|oe)hung|powell/i,
};

const MINUTE_MS = 60_000;
/** Vorlauf: Meldungen kurz vor dem Termin (Vorschau-Artikel) zaehlen nicht. */
export const HEADLINE_LEAD_MS = 2 * MINUTE_MS;
/** Eine einzelne Schlagzeile reicht erst, wenn sie so alt ist (sonst auf eine zweite warten). */
export const SINGLE_HEADLINE_WAIT_MS = 10 * MINUTE_MS;
export const MAX_HEADLINES = 8;

export function matchResultHeadlines(
  eventKey: string,
  news: ResultHeadline[],
  markMs: number
): ResultHeadline[] {
  const pattern = EVENT_HEADLINE_PATTERN[eventKey];
  if (!pattern) return [];
  return news
    .filter((n) => new Date(n.published_at).getTime() >= markMs + HEADLINE_LEAD_MS)
    .filter((n) => pattern.test(n.title) || (n.title_de !== null && pattern.test(n.title_de)))
    .sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime())
    .slice(0, MAX_HEADLINES);
}

/** Genug Material fuer eine Einordnung: zwei Meldungen oder eine, die schon 10 Min steht. */
export function headlinesReady(headlines: ResultHeadline[], nowMs: number): boolean {
  if (headlines.length >= 2) return true;
  if (headlines.length === 1) {
    return nowMs - new Date(headlines[0].published_at).getTime() >= SINGLE_HEADLINE_WAIT_MS;
  }
  return false;
}

export function resultBiasDisplay(bias: EconomicResultBias): {
  emoji: string;
  label: "bullisch" | "bärisch" | "neutral";
  colorClass: string;
} {
  if (bias === "bullish") return { emoji: "🟢", label: "bullisch", colorClass: "text-up" };
  if (bias === "bearish") return { emoji: "🔴", label: "bärisch", colorClass: "text-down" };
  return { emoji: "⚪", label: "neutral", colorClass: "text-text-faint" };
}

/** Gespeicherte Einordnung lesen (Anon-Client, RLS "Public read access"). */
export async function fetchEconomicResult(eventKey: string, eventDate: string): Promise<EconomicEventResult | null> {
  const { data, error } = await supabase
    .from("economic_event_results")
    .select("event_key, event_date, bias, summary, created_at")
    .eq("event_key", eventKey)
    .eq("event_date", eventDate)
    .maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Wirtschaftsdaten-Ergebnisses:", error.message);
    return null;
  }
  return (data as EconomicEventResult | null) ?? null;
}
