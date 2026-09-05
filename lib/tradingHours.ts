// Handelszeiten-Gate (Umsetzungsplan Phase 1, 05.09.2026) -- portiert das
// Konzept aus shared/handelszeiten.js im Crypto-Trading-Journal (Toby's
// Freund, siehe Chat) auf Nexus' Datenbasis. Beantwortet fuer Tobys reale
// 15m/5m-Einstiege die Frage "ist JETZT eine schlechte Zeit zum Handeln,
// und was kommt als Naechstes" -- unabhaengig vom MTF-Einstiegsfilter
// (lib/entryFilter.ts), der nur die STRUKTUR bewertet, nicht den Zeitpunkt.
//
// Reines Modul (keine Netzwerk-/DB-Zugriffe): nimmt `nowMs` und die bereits
// geladenen economic_calendar_events-Zeilen entgegen, damit dieselbe
// Berechnung serverseitig (fuer Push-Benachrichtigungen, spaeter) und im
// Browser laeuft.
//
// Zeitzonen bewusst mit der nativen Intl-API statt einer neuen Abhaengigkeit
// (dayjs o.ae.) berechnet -- das Projekt hat noch keine Datums-/Zeitzonen-
// Bibliothek, und die noetige Umrechnung Wanduhrzeit->UTC ist mit
// Intl.DateTimeFormat vollstaendig (inkl. Sommerzeit) loesbar, siehe
// zonedWallTimeToUtc() unten.
//
// WICHTIG: economic_calendar_events fuehrt NUR die vier bewusst verfolgten
// Hochrisiko-Termine (cpi/pce/nfp/fomc, siehe lib/economicCalendar.ts) --
// anders als das Journal-Vorbild (ForexFactory, mit `impact`-Feld) braucht
// es hier also KEINEN Impact-Filter: jede Zeile in dieser Tabelle ist per
// Definition bereits "wichtig genug, um zu verfolgen".

export type SessionId = "asia" | "london" | "usPre" | "usCash" | "usPost";
export type MarkId = "macro830" | "cashOpen" | "fomc1400" | "cashClose" | "cmePause";
export type WarningId = "opening" | "macro" | "fomc" | "close" | "cme";
export type WarningLevel = "high" | "medium";

export interface EconomicEventRow {
  event_key: string;
  event_date: string; // 'YYYY-MM-DD'
}

interface SessionDef {
  id: SessionId;
  zone: string;
  von: string; // 'HH:mm' Wanduhrzeit in `zone`
  bis: string;
  rang: number; // hoeherer Rang gewinnt, wenn mehrere Sessions ueberlappen
}

interface MarkDef {
  id: MarkId;
  zone: string;
  zeit: string;
  bis?: string; // nur bei spanne:true
  spanne?: boolean;
  tage?: number[]; // Wochentage 0=So..6=Sa, Default Mo-Fr
  // Termine, deren event_key hier steht, muessen an diesem Tag in
  // economic_calendar_events vorkommen, sonst wird diese Marke an diesem
  // Tag ignoriert (kein taeglich blinkendes FOMC-Fenster ohne echten Termin).
  benoetigtEreignis?: string[];
}

interface WarningDef {
  id: WarningId;
  mark: MarkId;
  vorMin: number;
  nachMin: number;
  level: WarningLevel;
}

const ZONE_US = "America/New_York";
const MINUTE_MS = 60 * 1000;

const SESSIONS: SessionDef[] = [
  { id: "asia", zone: "Asia/Tokyo", von: "09:00", bis: "15:00", rang: 1 },
  { id: "london", zone: "Europe/London", von: "08:00", bis: "16:30", rang: 2 },
  { id: "usPre", zone: ZONE_US, von: "04:00", bis: "09:30", rang: 3 },
  { id: "usPost", zone: ZONE_US, von: "16:00", bis: "20:00", rang: 3 },
  { id: "usCash", zone: ZONE_US, von: "09:30", bis: "16:00", rang: 5 },
];

const MARKS: MarkDef[] = [
  { id: "macro830", zone: ZONE_US, zeit: "08:30", benoetigtEreignis: ["cpi", "pce", "nfp"] },
  { id: "cashOpen", zone: ZONE_US, zeit: "09:30" },
  { id: "fomc1400", zone: ZONE_US, zeit: "14:00", benoetigtEreignis: ["fomc"] },
  { id: "cashClose", zone: ZONE_US, zeit: "16:00" },
  { id: "cmePause", zone: ZONE_US, zeit: "17:00", bis: "18:00", spanne: true, tage: [1, 2, 3, 4] },
];

const WARNINGS: WarningDef[] = [
  { id: "opening", mark: "cashOpen", vorMin: 5, nachMin: 15, level: "high" },
  { id: "macro", mark: "macro830", vorMin: 2, nachMin: 10, level: "high" },
  { id: "fomc", mark: "fomc1400", vorMin: 2, nachMin: 20, level: "high" },
  { id: "close", mark: "cashClose", vorMin: 15, nachMin: 5, level: "medium" },
  { id: "cme", mark: "cmePause", vorMin: 0, nachMin: 0, level: "medium" },
];

export interface ActiveSession {
  id: SessionId;
  von: number;
  bis: number;
}

export interface UpcomingMark {
  id: MarkId | SessionId;
  kind: "session" | "mark";
  atMs: number;
  inMs: number;
}

export interface TradingWarning {
  id: WarningId;
  level: WarningLevel;
  vonMs: number;
  bisMs: number;
  mark: MarkId;
}

export interface TradingHoursState {
  nowMs: number;
  /** Alle gerade laufenden Sessions, absteigend nach Rang (erste = massgeblich). */
  active: ActiveSession[];
  /** Ueberlappung London/US-Kassa -- die volumenstaerkste Phase des Tages. */
  overlapLondonUsCash: boolean;
  /** Naechste 4 Ereignisse (Sessions oder Marken), aufsteigend nach Zeit. */
  upcoming: UpcomingMark[];
  /** Gerade aktive Warnfenster, aufsteigend nach Beginn. */
  warnings: TradingWarning[];
  /** false, sobald mindestens eine "high"-Warnung aktiv ist. */
  tradeable: boolean;
}

/** Wanduhrzeit `HH:mm` an `dateStr` (`YYYY-MM-DD`) in `zone` -> UTC-Millisekunden. */
function zonedWallTimeToUtc(dateStr: string, hhmm: string, zone: string): number {
  const naiveUtc = Date.parse(`${dateStr}T${hhmm}:00Z`);
  const offsetMs = timeZoneOffsetMs(zone, naiveUtc);
  return naiveUtc - offsetMs;
}

/** Offset von `zone` gegenueber UTC (in ms) zum Zeitpunkt `atUtcMs`. */
function timeZoneOffsetMs(zone: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(atUtcMs).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - atUtcMs;
}

/** Kalendertag (`YYYY-MM-DD`) von `atUtcMs`, gelesen in `zone`. */
function dateInZone(atUtcMs: number, zone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(atUtcMs); // en-CA formatiert bereits als YYYY-MM-DD
}

/** Wochentag (0=So..6=Sa) von `dateStr` in `zone`, ausgewertet um 12:00 Wanduhrzeit (DST-sicher). */
function weekdayOf(dateStr: string, zone: string): number {
  const noonUtc = zonedWallTimeToUtc(dateStr, "12:00", zone);
  return new Date(noonUtc).getUTCDay();
}

/** Kalendertage (Vortag/heute/Folgetag) um `nowMs`, gelesen in `zone`. */
function daysAround(nowMs: number, zone: string): string[] {
  const today = dateInZone(nowMs, zone);
  const base = new Date(`${today}T12:00:00Z`).getTime();
  return [-1, 0, 1].map((d) => dateInZone(base + d * 24 * 60 * 60 * 1000, zone));
}

function sessionOccurrences(def: SessionDef, nowMs: number): ActiveSession[] {
  const tage = new Set([1, 2, 3, 4, 5]);
  const out: ActiveSession[] = [];
  for (const day of daysAround(nowMs, def.zone)) {
    if (!tage.has(weekdayOf(day, def.zone))) continue;
    const von = zonedWallTimeToUtc(day, def.von, def.zone);
    let bis = zonedWallTimeToUtc(day, def.bis, def.zone);
    if (bis <= von) bis += 24 * 60 * 60 * 1000; // Session laeuft ueber Mitternacht
    out.push({ id: def.id, von, bis });
  }
  return out;
}

function markOccurrences(def: MarkDef, nowMs: number): { id: MarkId; t: number; bis: number }[] {
  const tage = new Set(def.tage ?? [1, 2, 3, 4, 5]);
  const out: { id: MarkId; t: number; bis: number }[] = [];
  for (const day of daysAround(nowMs, def.zone)) {
    if (!tage.has(weekdayOf(day, def.zone))) continue;
    const t = zonedWallTimeToUtc(day, def.zeit, def.zone);
    const bis = def.spanne && def.bis ? zonedWallTimeToUtc(day, def.bis, def.zone) : t;
    out.push({ id: def.id, t, bis });
  }
  return out;
}

/** Gibt es an `dateStr` einen verfolgten Termin mit einem der `eventKeys`? */
function hasEventOn(dateStr: string, eventKeys: string[], events: EconomicEventRow[]): boolean {
  return events.some((e) => e.event_date === dateStr && eventKeys.includes(e.event_key));
}

export function getTradingHoursState(nowMs: number, events: EconomicEventRow[] = []): TradingHoursState {
  const allSessions = SESSIONS.flatMap((s) => sessionOccurrences(s, nowMs));
  const active = allSessions
    .filter((s) => nowMs >= s.von && nowMs < s.bis)
    .sort((a, b) => {
      const rangA = SESSIONS.find((s) => s.id === a.id)!.rang;
      const rangB = SESSIONS.find((s) => s.id === b.id)!.rang;
      return rangB - rangA;
    });
  const activeIds = new Set(active.map((s) => s.id));
  const overlapLondonUsCash = activeIds.has("london") && activeIds.has("usCash");

  const allMarks = MARKS.flatMap((m) => {
    const occs = markOccurrences(m, nowMs);
    if (!m.benoetigtEreignis) return occs;
    return occs.filter((o) => hasEventOn(dateInZone(o.t, m.zone), m.benoetigtEreignis!, events));
  });

  const upcoming: UpcomingMark[] = [];
  for (const s of allSessions) {
    if (s.von > nowMs) upcoming.push({ id: s.id, kind: "session", atMs: s.von, inMs: s.von - nowMs });
  }
  for (const m of allMarks) {
    if (m.t > nowMs) upcoming.push({ id: m.id, kind: "mark", atMs: m.t, inMs: m.t - nowMs });
  }
  upcoming.sort((a, b) => a.atMs - b.atMs);

  const warnings: TradingWarning[] = [];
  for (const w of WARNINGS) {
    for (const m of allMarks) {
      if (m.id !== w.mark) continue;
      const vonMs = m.t - w.vorMin * MINUTE_MS;
      const bisMs = m.bis + w.nachMin * MINUTE_MS;
      if (nowMs < vonMs || nowMs >= bisMs) continue;
      warnings.push({ id: w.id, level: w.level, vonMs, bisMs, mark: m.id });
    }
  }
  warnings.sort((a, b) => a.vonMs - b.vonMs);

  return {
    nowMs,
    active,
    overlapLondonUsCash,
    upcoming: upcoming.slice(0, 4),
    warnings,
    tradeable: !warnings.some((w) => w.level === "high"),
  };
}
