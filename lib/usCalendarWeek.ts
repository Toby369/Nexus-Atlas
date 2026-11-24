import { supabase } from "./supabase";
import { zonedWallTimeToUtc } from "./tradingHours";

// US-Wochenkalender: Termine der laufenden Woche (Prognose/Vorherig) aus
// us_calendar_week, gefuellt von der Edge Function collect-economic-calendar
// (ForexFactory-Feed, nur USD, nur Relevanz High/Medium). "Aktuell" liefert der
// Feed nicht. Die Texte unten sind regelbasiert (kein KI-Modell) und
// beschreiben nur die allgemein bekannte Wirkungsrichtung, keine Prognose.

export type UsCalendarImpact = "High" | "Medium";

export interface UsCalendarWeekEvent {
  event_time: string;
  title: string;
  impact: UsCalendarImpact;
  forecast: string | null;
  previous: string | null;
}

export interface UsEventInfo {
  /** Titel auf Deutsch. */
  de: string;
  /** Was der Wert misst. */
  what: string;
  /** Ergebnis, das BTC eher steigen laesst (im Vergleich zur Prognose). */
  bullish: string;
  /** Ergebnis, das BTC eher fallen laesst (im Vergleich zur Prognose). */
  bearish: string;
  /** Kurze Faustregel, z.B. "Höher = bärisch". */
  rule: string;
}

const ZONE_CH = "Europe/Zurich";

const INFLATION_BULL = "Tiefer als Prognose: weniger Preisdruck, Zinssenkungen werden wahrscheinlicher.";
const INFLATION_BEAR = "Höher als Prognose: mehr Preisdruck, Zinssenkungen rücken nach hinten.";
const MIXED_RULE = "Uneindeutig";

const PMI_WHAT =
  "Umfrage unter Einkaufsmanagern. Über 50 Punkten wächst die Branche, unter 50 schrumpft sie. „Flash“ ist die schnelle erste Schätzung, die später leicht korrigiert wird.";
const PMI_BULL = "Unter Prognose, aber nicht stark: Die Wirtschaft kühlt ab, die Fed hat Spielraum für Senkungen.";
const PMI_BEAR = "Deutlich über Prognose: Die Wirtschaft läuft heiss, Zinssenkungen werden unwahrscheinlicher.";

const JOBS_BULL = "Schwächer als Prognose, aber kein Einbruch: Der Arbeitsmarkt kühlt ab, Zinssenkungen werden wahrscheinlicher.";
const JOBS_BEAR = "Stärker als Prognose: Der Arbeitsmarkt ist robust, Zinssenkungen rücken nach hinten.";

// Reihenfolge zaehlt: spezifischere Muster zuerst (Core PCE vor PCE, GDP Price vor GDP).
const RULES: { test: RegExp; info: UsEventInfo }[] = [
  {
    test: /Core PCE/i,
    info: {
      de: "PCE-Kernrate (Preisindex), Monat",
      what: "Wie stark die Preise für Konsumgüter und Dienstleistungen in den USA gegenüber dem Vormonat gestiegen sind, ohne Lebensmittel und Energie. Das ist der Inflationswert, den die Fed am meisten beachtet.",
      bullish: INFLATION_BULL,
      bearish: INFLATION_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /Core CPI/i,
    info: {
      de: "Verbraucherpreise ohne Energie und Lebensmittel (Kern-CPI)",
      what: "Wie stark die Preise für Konsumgüter und Dienstleistungen gestiegen sind, ohne Lebensmittel und Energie. Schwankt weniger als der Gesamtwert und zeigt den Preisdruck darunter.",
      bullish: INFLATION_BULL,
      bearish: INFLATION_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /\bCPI\b/i,
    info: {
      de: "Verbraucherpreise (CPI)",
      what: "Wie stark die Preise für einen typischen Warenkorb von US-Haushalten gestiegen sind. Das ist der bekannteste Inflationswert.",
      bullish: INFLATION_BULL,
      bearish: INFLATION_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /\bPPI\b/i,
    info: {
      de: "Produzentenpreise (PPI)",
      what: "Was Firmen für ihre Waren verlangen. Gilt als Vorbote für die Verbraucherpreise, die Marktreaktion fällt aber meist kleiner aus.",
      bullish: INFLATION_BULL,
      bearish: INFLATION_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /ADP/i,
    info: {
      de: "ADP-Beschäftigung (Privatwirtschaft)",
      what: "Wie viele neue Stellen in der Privatwirtschaft entstanden sind. Kommt zwei Tage vor dem offiziellen Arbeitsmarktbericht und gilt als Vorgeschmack.",
      bullish: JOBS_BULL,
      bearish: JOBS_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /Non-?Farm/i,
    info: {
      de: "Arbeitsmarktbericht (Nonfarm Payrolls)",
      what: "Wie viele neue Stellen ausserhalb der Landwirtschaft im Vormonat entstanden sind. Einer der wichtigsten US-Werte für die Zinserwartungen.",
      bullish: JOBS_BULL,
      bearish: JOBS_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /Unemployment Rate/i,
    info: {
      de: "Arbeitslosenquote",
      what: "Anteil der Erwerbspersonen ohne Arbeit. Kommt zusammen mit dem Arbeitsmarktbericht.",
      bullish: "Leicht höher als Prognose: Der Arbeitsmarkt kühlt ab, Zinssenkungen werden wahrscheinlicher.",
      bearish: "Deutlich höher: Rezessionsangst. Tiefer als Prognose: Arbeitsmarkt robust, Zinssenkungen rücken nach hinten.",
      rule: MIXED_RULE,
    },
  },
  {
    test: /Unemployment Claims|Jobless Claims/i,
    info: {
      de: "Erstanträge auf Arbeitslosenhilfe",
      what: "Wie viele Menschen in der letzten Woche zum ersten Mal Arbeitslosenhilfe beantragt haben. Wöchentlicher, schneller Hinweis auf den Arbeitsmarkt.",
      bullish: "Etwas höher als Prognose: Der Arbeitsmarkt kühlt ab, Zinssenkungen werden wahrscheinlicher.",
      bearish: "Sprunghaft höher: Rezessionsangst. Deutlich tiefer: Arbeitsmarkt sehr robust.",
      rule: MIXED_RULE,
    },
  },
  {
    test: /JOLTS/i,
    info: {
      de: "Offene Stellen (JOLTS)",
      what: "Wie viele Stellen in den USA offen sind. Viele offene Stellen bedeuten einen angespannten Arbeitsmarkt.",
      bullish: JOBS_BULL,
      bearish: JOBS_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /FOMC.*Minutes/i,
    info: {
      de: "FOMC-Protokoll",
      what: "Das Protokoll der letzten Zinssitzung der Fed. Es zeigt, wie sich die Mitglieder zu Zinsen und Inflation geäussert haben.",
      bullish: "Hinweise auf baldige Zinssenkungen (taubenhaft).",
      bearish: "Hinweise auf länger hohe Zinsen oder Erhöhungen (falkenhaft).",
      rule: "Tonfall zählt",
    },
  },
  {
    test: /Federal Funds Rate|FOMC (Statement|Press)|Interest Rate/i,
    info: {
      de: "Fed-Zinsentscheid",
      what: "Der Leitzins der US-Notenbank und die Aussagen dazu. Überraschungen und der Ausblick auf weitere Schritte bewegen Risikoassets oft stärker als andere Einzeltermine.",
      bullish: "Zinssenkung oder Hinweis auf baldige Senkungen, mehr als erwartet.",
      bearish: "Zinserhöhung oder Hinweis auf länger hohe Zinsen, mehr als erwartet.",
      rule: "Höher = bärisch",
    },
  },
  {
    test: /Speaks|Testifies|Press Conference/i,
    info: {
      de: "Rede eines Notenbankers",
      what: "Auftritt eines Fed-Mitglieds. Der Tonfall kann die Zinserwartungen verschieben, auch ohne neue Zahlen.",
      bullish: "Hinweise auf Zinssenkungen (taubenhaft).",
      bearish: "Hinweise auf länger hohe Zinsen (falkenhaft).",
      rule: "Tonfall zählt",
    },
  },
  {
    test: /ISM.*PMI|ISM (Manufacturing|Services)/i,
    info: {
      de: "ISM-Einkaufsmanagerindex",
      what: "Umfrage des ISM unter Einkaufsmanagern. Über 50 Punkten wächst die Branche, unter 50 schrumpft sie. Gehört zu den wichtigsten Konjunkturwerten der USA.",
      bullish: PMI_BULL,
      bearish: PMI_BEAR,
      rule: MIXED_RULE,
    },
  },
  {
    test: /Manufacturing PMI/i,
    info: {
      de: "Einkaufsmanagerindex Industrie",
      what: PMI_WHAT,
      bullish: PMI_BULL,
      bearish: PMI_BEAR,
      rule: MIXED_RULE,
    },
  },
  {
    test: /Services PMI/i,
    info: {
      de: "Einkaufsmanagerindex Dienstleistungen",
      what: PMI_WHAT,
      bullish: PMI_BULL,
      bearish: PMI_BEAR,
      rule: MIXED_RULE,
    },
  },
  {
    test: /Retail Sales/i,
    info: {
      de: "Einzelhandelsumsatz",
      what: "Wie viel in den USA im Einzelhandel ausgegeben wurde. Der Konsum trägt rund zwei Drittel der US-Wirtschaft.",
      bullish: "Etwas unter Prognose: schwächerer Konsum, Zinssenkungen werden wahrscheinlicher.",
      bearish: "Deutlich über Prognose: starker Konsum, die Fed muss nicht senken. Ein Absturz kann Rezessionsangst auslösen.",
      rule: MIXED_RULE,
    },
  },
  {
    test: /GDP Price/i,
    info: {
      de: "BIP-Preisindex",
      what: "Wie stark die Preise innerhalb der gesamten US-Wirtschaft im Quartal gestiegen sind. Ein weiterer Inflationsmesser, kommt zusammen mit dem BIP.",
      bullish: INFLATION_BULL,
      bearish: INFLATION_BEAR,
      rule: "Höher = bärisch",
    },
  },
  {
    test: /GDP/i,
    info: {
      de: "Bruttoinlandsprodukt (BIP), Quartal",
      what: "Wie stark die US-Wirtschaft im letzten Quartal gewachsen ist (auf ein Jahr hochgerechnet). Erste Schätzungen werden später korrigiert.",
      bullish: "Leicht unter Prognose: Die Wirtschaft kühlt ab, ohne einzubrechen. Die Fed kann Zinsen senken.",
      bearish: "Deutlich über Prognose: Die Wirtschaft läuft heiss, Zinsen bleiben hoch. Ein starker Einbruch wirkt ebenfalls bärisch (Rezessionsangst).",
      rule: MIXED_RULE,
    },
  },
  {
    test: /Consumer Confidence|Consumer Sentiment/i,
    info: {
      de: "Verbrauchervertrauen",
      what: "Umfrage, wie zuversichtlich US-Haushalte bei Wirtschaft und Arbeitsmarkt sind. Der Konsum trägt rund zwei Drittel der US-Wirtschaft.",
      bullish: "Etwas unter Prognose: schwächerer Konsum, Zinssenkungen werden wahrscheinlicher.",
      bearish: "Deutlich über Prognose: starker Konsum, die Fed muss nicht senken. Ein Absturz kann Rezessionsangst auslösen.",
      rule: MIXED_RULE,
    },
  },
];

function fallbackInfo(title: string): UsEventInfo {
  return {
    de: title,
    what: "Ein weiterer US-Wirtschaftswert. Je wichtiger er für die Fed-Zinsen ist, desto stärker reagiert der Markt.",
    bullish: "Schwächer als Prognose: Die Fed bekommt mehr Spielraum für Zinssenkungen.",
    bearish: "Stärker als Prognose: Zinssenkungen rücken nach hinten.",
    rule: MIXED_RULE,
  };
}

/** Deutscher Titel und BTC-Einordnung; unbekannte Termine bekommen einen allgemeinen Text. */
export function usEventInfo(title: string): UsEventInfo {
  return RULES.find((r) => r.test.test(title))?.info ?? fallbackInfo(title);
}

/** Kalendertag (YYYY-MM-DD) in Schweizer Zeit. */
export function zurichDayKey(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE_CH }).format(ms);
}

export interface UsCalendarDay {
  dayKey: string;
  events: UsCalendarWeekEvent[];
}

/** Filtert nach Relevanz, sortiert nach Zeit und gruppiert nach Schweizer Kalendertag. */
export function groupUsCalendarByDay(
  events: UsCalendarWeekEvent[],
  onlyHigh: boolean
): UsCalendarDay[] {
  const sorted = events
    .filter((e) => !onlyHigh || e.impact === "High")
    .slice()
    .sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time) || a.title.localeCompare(b.title));
  const days: UsCalendarDay[] = [];
  for (const e of sorted) {
    const key = zurichDayKey(Date.parse(e.event_time));
    const last = days[days.length - 1];
    if (last && last.dayKey === key) last.events.push(e);
    else days.push({ dayKey: key, events: [e] });
  }
  return days;
}

/** Beginn des heutigen Kalendertags in Schweizer Zeit (UTC-ms). */
export function startOfZurichDayMs(nowMs: number): number {
  return zonedWallTimeToUtc(zurichDayKey(nowMs), "00:00", ZONE_CH);
}

/** Termine ab heute 00:00 Schweizer Zeit (laufende Woche, inkl. bereits Erschienenes von heute). */
export async function fetchUsCalendarWeek(nowMs: number = Date.now()): Promise<UsCalendarWeekEvent[]> {
  const { data, error } = await supabase
    .from("us_calendar_week")
    .select("event_time,title,impact,forecast,previous")
    .gte("event_time", new Date(startOfZurichDayMs(nowMs)).toISOString())
    .order("event_time", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden des US-Wochenkalenders:", error.message);
    return [];
  }
  return (data ?? []) as UsCalendarWeekEvent[];
}
