import { zonedWallTimeToUtc } from "./tradingHours";
import type { EconomicEventResult } from "./economicEventResult";

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

// Legende fuer die Vorwarnung (was ein Ergebnis fuer BTC bedeuten wuerde) --
// Quelle der Wahrheit fuer die Kachel (EconomicCalendarPanel), das Lagebild
// und die Push-Vorwarnung (Supabase Edge Function send-state-change-push,
// die dieses Repo nicht importieren kann und den Text dupliziert). true =
// hoeher als erwartet gilt als baerisch fuer BTC. Das tatsaechliche Ergebnis
// kommt seit 14.10.2026 aus den News (lib/economicEventResult.ts), nicht mehr
// aus FRED.
export const EVENT_HIGHER_MEANS_BEARISH: Record<string, boolean> = {
  cpi: true,
  pce: true,
  nfp: true,
  fomc: true, // Zinserhöhung = bärisch, Zinssenkung = bullisch
};

export function economicDirectionLegend(eventKey: string): string {
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  return bearishIfUp
    ? "↑ höher als erwartet → 🔴 bärisch für BTC · ↓ tiefer → 🟢 bullisch für BTC"
    : "↑ höher als erwartet → 🟢 bullisch für BTC · ↓ tiefer → 🔴 bärisch für BTC";
}

// Lagebild: zeigt einen Termin ab 2h vorher bis 1h nach dem Resultat (Toby
// 14.10.2026), sonst nichts. EIN Termin wird angezeigt, Auswahl nach Zeit-
// Prioritaet -- siehe getHeroEconomicEventStatus() unten. Uhrzeiten werden immer in Schweizer Zeit angezeigt.
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
const ZONE_CH = "Europe/Zurich";
const HOUR_MS = 60 * 60 * 1000;
/** Ab wann vor dem Termin er im Lagebild erscheint. */
export const HERO_LEAD_MS = 2 * HOUR_MS;
/** Wie lange das Resultat im Lagebild stehen bleibt. */
export const RESULT_DISPLAY_MS = 1 * HOUR_MS;
/** Kommt nach so langer Zeit kein Resultat (Datenquelle haengt), verschwindet der Termin trotzdem. */
export const AWAITING_MAX_MS = 6 * HOUR_MS;

/** Veroeffentlichungszeitpunkt (UTC-ms) eines verfolgten Termins, sonst null. */
export function economicEventMarkMs(eventKey: string, eventDate: string): number | null {
  const timeEt = EVENT_TIME_ET[eventKey];
  return timeEt ? zonedWallTimeToUtc(eventDate, timeEt, ZONE_US) : null;
}

/** Uhrzeit in Schweizer Zeit, z.B. "14:30 Uhr". */
export function formatZurichTime(ms: number): string {
  const hhmm = new Intl.DateTimeFormat("de-CH", {
    timeZone: ZONE_CH,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
  return `${hhmm} Uhr`;
}

export type HeroEconomicPhase = "upcoming" | "awaiting_result" | "result_recent";

export interface HeroEconomicEventStatus {
  eventKey: string;
  eventDate: string;
  label: string;
  markMs: number;
  phase: HeroEconomicPhase;
  result: EconomicEventResult | null;
}

// Liefert die gespeicherte Einordnung (economic_event_results) oder null --
// injiziert, damit die Zustandsmaschine ohne Supabase testbar bleibt.
export type EconomicResultFetcher = (eventKey: string, eventDate: string) => Promise<EconomicEventResult | null>;

// Reine Zustandsmaschine (bis auf fetchResult): iteriert die verfolgten
// Termine chronologisch und gibt den ERSTEN zurueck, der noch nicht
// abgelaufen ist -- upcoming (ab 2h vorher), awaiting_result (Termin da,
// Einordnung aus den News fehlt noch, hoechstens 6h), result_recent
// (Einordnung da, noch innerhalb 1h). Abgelaufene Termine werden
// uebersprungen.
export async function getHeroEconomicEventStatus(
  events: { event_key: string; label: string; event_date: string }[],
  fetchResult: EconomicResultFetcher,
  nowMs: number = Date.now()
): Promise<HeroEconomicEventStatus | null> {
  const candidates = events
    .filter((e) => EVENT_TIME_ET[e.event_key])
    .map((e) => ({ event: e, markMs: economicEventMarkMs(e.event_key, e.event_date) as number }))
    .sort((a, b) => a.markMs - b.markMs);

  for (const { event, markMs } of candidates) {
    const base = { eventKey: event.event_key, eventDate: event.event_date, label: event.label, markMs };
    if (nowMs < markMs) {
      // Noch mehr als 2h hin: im Lagebild nichts zeigen (Kalender-Kachel
      // listet die Termine ohnehin). Spaetere Termine liegen noch weiter weg.
      if (nowMs < markMs - HERO_LEAD_MS) return null;
      return { ...base, phase: "upcoming", result: null };
    }

    const result = await fetchResult(event.event_key, event.event_date);
    if (!result) {
      if (nowMs - markMs > AWAITING_MAX_MS) continue;
      return { ...base, phase: "awaiting_result", result: null };
    }
    if (nowMs - new Date(result.created_at).getTime() <= RESULT_DISPLAY_MS) {
      return { ...base, phase: "result_recent", result };
    }
    // Abgelaufen (Einordnung laenger als 1h her) -- naechsten Termin pruefen.
  }

  return null;
}
