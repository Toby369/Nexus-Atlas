import { zonedWallTimeToUtc } from "./tradingHours";

// Statische, regelbasierte BTC-Einordnung je verfolgtem Wirtschaftsereignis
// (kein KI-Modell -- dieselbe Philosophie wie exchangeDivergenceInfo in
// lib/panelInfo.ts). Die Termine selbst kommen aus economic_calendar_events
// (siehe Edge Function collect-economic-calendar), diese Texte beschreiben nur
// die allgemein bekannte, historisch beobachtete Wirkungsrichtung -- keine
// Prognose fuer den konkreten kommenden Termin.
export const ECONOMIC_EVENT_INTERPRETATION: Record<string, string> = {
  cpi: "Höher als erwartete CPI-Daten werden am Markt häufig als Signal für eine straffere Fed-Politik gelesen, was Risikoassets wie BTC tendenziell belastet — niedriger als erwartet wirkt oft umgekehrt. Kein Automatismus, keine Anlageberatung.",
  pce: "PCE ist der von der Fed selbst bevorzugte Inflationsmesswert und fließt direkt in ihre Zinsentscheide ein — die Marktreaktion verläuft tendenziell in dieselbe Richtung wie bei CPI. Kein Automatismus, keine Anlageberatung.",
  nfp: "Überraschend starke Beschäftigungsdaten werden oft als Argument für eine straffere Fed-Politik gelesen (belastend für Risikoassets), schwache Daten oft umgekehrt — die tatsächliche Reaktion hängt stark vom Gesamtkontext ab. Kein Automatismus, keine Anlageberatung.",
  fomc: "Der Zinsentscheid selbst und vor allem die begleitenden Aussagen zur weiteren Ausrichtung bewegen Risikoassets oft stärker als andere Einzeltermine — Überraschungen gegenüber den Markterwartungen lösen typischerweise die stärkste Reaktion aus. Kein Automatismus, keine Anlageberatung.",
};

// Pfeil/Farb-Logik (Nutzer-Wunsch 03.10.2026: "mit Pfeil Richtung und Farbe
// angezeigt werden was Resultat bedeuten würde") -- Quelle der Wahrheit fuer
// sowohl die Kachel (EconomicCalendarPanel) als auch die Push-Benachrichtigung
// (Supabase Edge Function send-state-change-push, die dieses Repo nicht
// importieren kann und die Logik daher dupliziert, siehe Kommentar dort).
// true = ein Anstieg gegenueber dem Vorwert gilt als baerisch fuer BTC (und
// ein Rueckgang damit als bullisch) -- fuer alle vier verfolgten Ereignisse
// dieselbe Grundaussage wie in ECONOMIC_EVENT_INTERPRETATION oben, hier nur
// als stures Flag statt Fliesstext.
export const EVENT_HIGHER_MEANS_BEARISH: Record<string, boolean> = {
  cpi: true,
  pce: true,
  nfp: true,
  fomc: true, // Zinserhöhung = bärisch, Zinssenkung = bullisch
};

// FRED-Serie je Ereignis in macro_snapshots (siehe collect-macro) -- liefert
// den tatsaechlich veroeffentlichten Wert fuer die "Resultat"-Anzeige, ohne
// eigenen neuen Collector.
export const EVENT_FRED_SYMBOL: Record<string, string> = {
  cpi: "CPIAUCSL",
  pce: "PCEPI",
  nfp: "PAYEMS",
  fomc: "DFF",
};

export type EconomicDirection = "up" | "down" | "flat";

export function economicDirectionMeaning(
  eventKey: string,
  direction: EconomicDirection
): { arrow: string; emoji: string; meaning: "bullisch" | "bärisch" | "neutral" } {
  if (direction === "flat") return { arrow: "→", emoji: "⚪", meaning: "neutral" };
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  const isBearish = direction === "up" ? bearishIfUp : !bearishIfUp;
  return {
    arrow: direction === "up" ? "↑" : "↓",
    emoji: isBearish ? "🔴" : "🟢",
    meaning: isBearish ? "bärisch" : "bullisch",
  };
}

// Allgemeine Legende (beide Richtungen) fuer die Vorwarnung, solange noch
// kein Resultat vorliegt.
export function economicDirectionLegend(eventKey: string): string {
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  return bearishIfUp
    ? "↑ höher als zuvor → 🔴 bärisch für BTC · ↓ niedriger → 🟢 bullisch für BTC"
    : "↑ höher als zuvor → 🟢 bullisch für BTC · ↓ niedriger → 🔴 bärisch für BTC";
}

// Head-Kachel (Nutzer-Wunsch 03.10.2026: "aktuellste bevorstehende daten
// sollen in head kachel erscheinen, bis und mit die daten da sind (verbleibt
// dann 4h mit den aktuellen daten) gleichzeitig kommt dann die naechste
// bevorstehende."): EIN Termin wird angezeigt, Auswahl nach Zeit-Prioritaet
// -- siehe getHeroEconomicEventStatus() unten fuer die genaue Zustandsmaschine
// (upcoming -> awaiting_result -> result_recent -> naechster Termin).
//
// Veroeffentlichungszeit je Ereignis (ET-Wanduhrzeit) -- identisch zu
// NEWS_MARKS in der Supabase Edge Function send-state-change-push (dort
// dupliziert, da Edge Functions dieses Repo nicht importieren koennen).
export const EVENT_TIME_ET: Record<string, string> = {
  cpi: "08:30",
  pce: "08:30",
  nfp: "08:30",
  fomc: "14:00",
};

const ZONE_US = "America/New_York";
const RESULT_DISPLAY_MS = 4 * 60 * 60 * 1000;

export type HeroEconomicPhase = "upcoming" | "awaiting_result" | "result_recent";

export interface HeroEconomicEventStatus {
  eventKey: string;
  label: string;
  markMs: number;
  phase: HeroEconomicPhase;
  actualValue: number | null;
  baselineValue: number | null;
  resultDetectedAtMs: number | null;
}

interface MacroSnapshotRow {
  last_price: number | null;
  timestamp_utc: string;
}

// Minimale Schnittstelle statt des vollen Supabase-Client-Typs -- macht die
// Funktion ohne echten Supabase-Mock testbar (siehe
// lib/economicCalendar.test.ts). `bound` ist absichtlich ein benanntes
// Objekt statt eines einzelnen optionalen Strings -- eine fruehere Version
// nutzte denselben "afterIso"-Parameter fuer sowohl die "letzter Wert VOR
// dem Termin"- als auch die "erste Zeile NACH dem Termin"-Abfrage und
// berechnete dadurch faelschlich den global neuesten statt den
// vortermin-Wert als baseline. Explizite beforeIso/fromIso-Varianten
// schliessen diese Verwechslung aus.
export interface MacroSnapshotFetcher {
  (symbol: string, bound: { beforeIso: string } | { fromIso: string }, limit: number, order: "asc" | "desc"): Promise<MacroSnapshotRow[]>;
}

// Sucht die erste Zeile NACH `markMs`, deren last_price vom Vorwert
// (`baseline`, letzter bekannter Wert VOR dem Termin) abweicht -- robuster
// Nachweis "das Ergebnis ist jetzt wirklich da" als ein reiner Datumsvergleich
// (FRED fuehrt market_time_utc als Berichtsperiode, nicht als
// Veroeffentlichungsdatum, siehe gleichnamiger Kommentar in der Edge
// Function). Identische Logik wie dort, hier fuer die Kachel wiederverwendet.
async function detectResult(
  fetchMacro: MacroSnapshotFetcher,
  symbol: string,
  markMs: number
): Promise<{ baseline: number | null; result: { value: number; atMs: number } | null }> {
  const markIso = new Date(markMs).toISOString();
  const preRows = await fetchMacro(symbol, { beforeIso: markIso }, 1, "desc");
  const baseline = preRows[0]?.last_price !== null && preRows[0]?.last_price !== undefined ? Number(preRows[0].last_price) : null;

  const afterRows = await fetchMacro(symbol, { fromIso: markIso }, 50, "asc");
  for (const row of afterRows) {
    if (row.last_price === null || row.last_price === undefined) continue;
    const value = Number(row.last_price);
    if (baseline === null || value !== baseline) {
      return { baseline, result: { value, atMs: new Date(row.timestamp_utc).getTime() } };
    }
  }
  return { baseline, result: null };
}

// Reine Zustandsmaschine (bis auf die injizierte fetchMacro-Funktion) --
// iteriert die verfolgten Termine chronologisch und gibt den ERSTEN
// zurueck, der noch nicht "abgelaufen" ist (Resultat vorhanden UND aelter
// als RESULT_DISPLAY_MS): upcoming (Termin noch nicht da), awaiting_result
// (Termin da, aber macro_snapshots zeigt noch den alten Wert -- Veroeffent-
// lichungs-/Collector-Verzoegerung), result_recent (neuer Wert da, noch
// innerhalb der 4h-Anzeigefrist). Ist ein Termin abgelaufen, wird direkt der
// naechste in derselben Weise geprueft -- kein zusaetzlicher Aufruf noetig.
export async function getHeroEconomicEventStatus(
  events: { event_key: string; label: string; event_date: string }[],
  fetchMacro: MacroSnapshotFetcher,
  nowMs: number = Date.now()
): Promise<HeroEconomicEventStatus | null> {
  const candidates = events
    .filter((e) => EVENT_TIME_ET[e.event_key] && EVENT_FRED_SYMBOL[e.event_key])
    .map((e) => ({ event: e, markMs: zonedWallTimeToUtc(e.event_date, EVENT_TIME_ET[e.event_key], ZONE_US) }))
    .sort((a, b) => a.markMs - b.markMs);

  for (const { event, markMs } of candidates) {
    if (nowMs < markMs) {
      return {
        eventKey: event.event_key,
        label: event.label,
        markMs,
        phase: "upcoming",
        actualValue: null,
        baselineValue: null,
        resultDetectedAtMs: null,
      };
    }

    const symbol = EVENT_FRED_SYMBOL[event.event_key];
    const { baseline, result } = await detectResult(fetchMacro, symbol, markMs);

    if (!result) {
      return {
        eventKey: event.event_key,
        label: event.label,
        markMs,
        phase: "awaiting_result",
        actualValue: null,
        baselineValue: baseline,
        resultDetectedAtMs: null,
      };
    }

    if (nowMs - result.atMs <= RESULT_DISPLAY_MS) {
      return {
        eventKey: event.event_key,
        label: event.label,
        markMs,
        phase: "result_recent",
        actualValue: result.value,
        baselineValue: baseline,
        resultDetectedAtMs: result.atMs,
      };
    }
    // Abgelaufen (Resultat laenger als 4h her) -- naechsten Termin pruefen.
  }

  return null;
}
