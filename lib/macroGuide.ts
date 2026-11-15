// US-Makrodaten und BTC (Toby 15.11.2026, Punkt D): EIN Inhalt fuer drei
// Orte -- Lage (Aufklapper "US-Makro"), Lernen (Grundlagen "Makro-Daten")
// und Quiz. Statischer Lerninhalt, keine Tabelle. Aktuelle Werte (Fed-Zins,
// letzter CPI) bewusst NICHT hier: sie veralten, die Lage-Kachel zeigt nur
// Termine und Einordnungen, die Nexus selbst kennt, mit Datum.

import { economicEventMarkMs } from "./economicCalendar";

export interface MacroEventGuide {
  key: string;
  short: string;
  name: string;
  /** Wann, Schweizer Zeit. */
  when: string;
  measures: string;
  /** Was "hoeher als erwartet" bzw. "tiefer" fuer BTC meist heisst. */
  effect: string;
  /** Regeln vor und nach dem Termin, wie im Veto. */
  rules: string;
}

const STANDARD_RULES =
  "Ab 30 Min vorher keine neue Position. Danach 15–30 Min abwarten, Einstieg erst mit 4H-Schluss. Halbe Grösse am Datentag.";

export const MACRO_EVENT_GUIDE: Record<string, MacroEventGuide> = {
  cpi: {
    key: "cpi",
    short: "CPI",
    name: "Verbraucherpreise",
    when: "Mitte Monat, 14:30",
    measures: "Die Inflation bei den Verbraucherpreisen. Die Kernrate ohne Energie und Essen zählt mehr.",
    effect: "Höher als erwartet → bärisch, tiefer → bullisch.",
    rules: STANDARD_RULES,
  },
  ppi: {
    key: "ppi",
    short: "PPI",
    name: "Produzentenpreise",
    when: "um den CPI herum, 14:30",
    measures: "Die Preise, die Firmen verlangen. Ein Vorbote für den CPI.",
    effect: "Wie CPI, meist schwächer: höher als erwartet → bärisch.",
    rules: STANDARD_RULES,
  },
  pce: {
    key: "pce",
    short: "PCE",
    name: "PCE-Preisindex",
    when: "Ende Monat, 14:30",
    measures: "Das Inflationsmass, auf das die Fed am meisten schaut.",
    effect: "Wie CPI, meist kleinere Reaktion: höher als erwartet → bärisch.",
    rules: STANDARD_RULES,
  },
  nfp: {
    key: "nfp",
    short: "NFP",
    name: "Arbeitsmarktbericht",
    when: "1. Freitag im Monat, 14:30",
    measures: "Neue Stellen und Arbeitslosenquote.",
    effect: "Sehr stark → Zinsen bleiben hoch (bärisch). Schwach → Senkungshoffnung (bullisch), aber zu schwach → Rezessionsangst (bärisch).",
    rules: STANDARD_RULES,
  },
  fomc: {
    key: "fomc",
    short: "FOMC",
    name: "Zinsentscheid der Fed",
    when: "8× im Jahr, 20:00, Pressekonferenz 20:30",
    measures: "Leitzins und Ton der Fed.",
    effect: "Oft zählt der Ton mehr als der Entscheid: streng (hawkish) → bärisch, locker (dovish) → bullisch.",
    rules: "Ab 19:30 keine neue Position. Nach der Pressekonferenz bis 21:00 warten, Einstieg erst mit 4H-Schluss. Halbe Grösse am Datentag.",
  },
};

export const MACRO_MECHANISM = {
  up: ["Inflation hoch", "Fed hält Zinsen hoch", "Anleihen bringen mehr, Dollar stärker", "weniger Geld für BTC"],
  down: ["Inflation sinkt", "Senkungen wahrscheinlicher", "Geld sucht Rendite", "eher gut für BTC"],
  surprise:
    "Nur die Überraschung bewegt. Die Prognose ist schon im Preis: 0,3 % bei erwarteten 0,3 % ist ein Nicht-Ereignis, 0,3 % bei erwarteten 0,2 % ist ein Schock.",
  companions: "Dollar-Index (DXY) und Rendite 10-jähriger US-Anleihen laufen mit. Steigen sie, ist das meist Gegenwind für BTC.",
  caveat:
    "Der Zusammenhang gilt meistens, nicht immer. Bei einer Liquidationskaskade oder ETF-Abflüssen kann BTC auch gegen gute Daten fallen.",
};

export const MACRO_PRICE_BEHAVIOUR = {
  text: "Nach der Veröffentlichung kommen heftige Dochte in beide Richtungen, weil Stopps auf beiden Seiten abgeholt werden. Der erste Ausschlag ist oft falsch.",
  example:
    "Beispiel CPI am 10.11.2026 um 14:30: In der 1H-Kerze von 14 bis 15 Uhr ging es von 74’788 auf 73’368, dann kam der Stich auf 74’824 und danach der Fall auf 72’690. Beide Marken sind CPI-Dochte, später als Sweep-Hoch und Sweep-Tief eingezeichnet.",
};

export const MACRO_RULES: { when: string; text: string }[] = [
  { when: "−30 Min", text: "Keine neue Position. Bei offenen Trades den Stopp prüfen oder Gewinne mitnehmen." },
  { when: "+15 bis +30 Min", text: "Abwarten. Einsteigen erst nach dem normalen Ablauf, mit 4H-Schluss." },
  { when: "Datentag", text: "Mit halber Positionsgrösse handeln (Risiko 0,5 statt 1 USDT)." },
  { when: "Morgens", text: "Im Tagesplan nachsehen. Nexus warnt per Push und setzt das Veto." },
];

/** event_keys, die als Datentag gelten (halbe Groesse) und im Veto zaehlen. */
export const MACRO_DATA_DAY_KEYS = ["cpi", "ppi", "pce", "nfp", "fomc"];

const zurichDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const zurichTime = (ms: number) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** "CPI 14:30" (mehrere: "PPI 14:30, FOMC 20:00"), wenn heute (Schweizer Datum) ein US-Datentag ist, sonst null. */
export function dataDayLabel(nowMs: number, events: { event_key: string; event_date: string }[]): string | null {
  const today = zurichDate(nowMs);
  const hits = events
    .filter((e) => MACRO_DATA_DAY_KEYS.includes(e.event_key))
    .map((e) => ({ key: e.event_key, ms: economicEventMarkMs(e.event_key, e.event_date) }))
    .filter((x): x is { key: string; ms: number } => x.ms !== null && zurichDate(x.ms) === today)
    .sort((a, b) => a.ms - b.ms);
  if (hits.length === 0) return null;
  return [...new Map(hits.map((h) => [`${h.key}${h.ms}`, h])).values()]
    .map((h) => `${MACRO_EVENT_GUIDE[h.key]?.short ?? h.key.toUpperCase()} ${zurichTime(h.ms)}`)
    .join(", ");
}
