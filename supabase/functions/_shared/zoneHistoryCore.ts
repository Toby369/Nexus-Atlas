// Gemeinsamer Kern der Zonen-Geschichte (Zonen mit Gedaechtnis): genutzt von
// der App (lib/zoneHistory.ts, Zonen-Kachel) und von der Edge Function
// send-state-change-push (Ergebnis-Alarme, Phase 4). Reines TypeScript ohne
// Imports, damit Next.js und Deno dieselbe Datei verwenden. Regeln siehe
// lib/zoneHistory.ts und docs/research/ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md.

export interface ZoneCandle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type ZoneTimeframe = "1h" | "4h" | "1d";
/** Kurs relativ zur Zone: darueber (Zone wirkt als Unterstuetzung) oder darunter. */
export type ZoneSide = "above" | "below";

/** So viele abgeschlossene Kerzen je Zeiteinheit werden ausgewertet (1h: 30 Tage, 4h: 120 Tage, 1D: knapp 2 Jahre). */
export const ZONE_HISTORY_CANDLES = 720;
export const FAKEOUT_WINDOW = 3;
/** Beinahe-Beruehrung: so viele ATR (14, Zeiteinheit der Zone) vor der Zonenkante zaehlen noch. */
export const NEAR_MISS_ATR = 0.25;
const ATR_PERIOD = 14;

export interface ZoneEvent {
  kind: "beruehrung" | "fehlausbruch" | "bruch";
  /** Kerzenbeginn (ISO). Beim Bruch die erste Kerze, die jenseits schloss. */
  time: string;
  /** Seite des Kurses vor dem Ereignis. */
  side: ZoneSide;
  /** Beruehrung ohne Eintritt in die Zone (bis NEAR_MISS_ATR davor). */
  near?: boolean;
  /** Kerzenbeginn der Kerze, mit deren Schluss das Ereignis feststand (Bruch/Fehlausbruch: bis 3 Kerzen spaeter). */
  decidedAt: string;
  /** Schlusskurs dieser Kerze. */
  decidedClose: number;
}

export interface ZoneHistory {
  tf: ZoneTimeframe;
  /** Erste und letzte ausgewertete Kerze (ISO). */
  from: string | null;
  to: string | null;
  events: ZoneEvent[];
  /** Seite, auf der die erste Kerze ausserhalb der Zone schloss. */
  initialSide: ZoneSide | null;
  side: ZoneSide | null;
  /** Schluss jenseits der Zone, noch nicht bestaetigt (zu wenige Kerzen danach). */
  pendingBreak: string | null;
}

/**
 * Zeiteinheit aus dem Anfang der AutarkTrade-Beschriftung: "1h …", "4H …",
 * "1D …", "D …", "Daily …". Ohne Angabe null (keine Geschichte).
 */
export function timeframeFromLabel(label: string | null | undefined): ZoneTimeframe | null {
  const m = label?.match(/^\s*(1\s*h|4\s*h|1\s*d|daily|d)(?![a-zäöü])/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, "").toLowerCase();
  return t === "1h" ? "1h" : t === "4h" ? "4h" : "1d";
}

/** ATR (Wilder) je Kerze; die ersten Werte sind der laufende Mittelwert der True Range. */
export function atrSeries(candles: ZoneCandle[], period = ATR_PERIOD): number[] {
  const out: number[] = [];
  let atr = 0;
  candles.forEach((c, i) => {
    const prev = i > 0 ? candles[i - 1].close : c.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    atr = i < period ? (atr * i + tr) / (i + 1) : (atr * (period - 1) + tr) / period;
    out.push(atr);
  });
  return out;
}

export function computeZoneHistory(candles: ZoneCandle[], low: number, high: number, tf: ZoneTimeframe): ZoneHistory {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const atr = atrSeries(candles);
  const overlaps = (c: ZoneCandle) => c.low <= hi && c.high >= lo;
  // Reichweite fuer Beruehrungen: Zone plus NEAR_MISS_ATR (ATR der Kerze davor) zur Kursseite hin.
  const reaches = (i: number, s: ZoneSide) => {
    const pad = NEAR_MISS_ATR * atr[Math.max(0, i - 1)];
    const c = candles[i];
    return s === "above" ? c.low <= hi + pad && c.high >= lo : c.high >= lo - pad && c.low <= hi;
  };
  const beyond = (c: ZoneCandle, s: ZoneSide) => (s === "above" ? c.close < lo : c.close > hi);
  const back = (c: ZoneCandle, s: ZoneSide) => (s === "above" ? c.close > hi : c.close < lo);
  const out: ZoneHistory = {
    tf,
    from: candles[0]?.openTime ?? null,
    to: candles[candles.length - 1]?.openTime ?? null,
    events: [],
    initialSide: null,
    side: null,
    pendingBreak: null,
  };
  let side: ZoneSide | null = null;
  let prevIn = false;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (side === null) {
      if (c.close > hi) side = "above";
      else if (c.close < lo) side = "below";
      if (side) out.initialSide = side;
      prevIn = side ? reaches(i, side) : true;
      continue;
    }
    if (!beyond(c, side)) {
      const inReach = reaches(i, side);
      if (inReach && !prevIn) {
        out.events.push({
          kind: "beruehrung",
          time: c.openTime,
          side,
          ...(overlaps(c) ? {} : { near: true }),
          decidedAt: c.openTime,
          decidedClose: c.close,
        });
      }
      prevIn = inReach;
      continue;
    }
    // Schluss jenseits: Bruch oder Fehlausbruch? Bis zu 3 Kerzen danach ansehen.
    let decided: "bruch" | "fehlausbruch" | null = null;
    let j = i + 1;
    for (; j <= i + FAKEOUT_WINDOW && j < candles.length; j++) {
      if (back(candles[j], side)) {
        decided = "fehlausbruch";
        break;
      }
      if (j === i + 1 && beyond(candles[j], side)) {
        decided = "bruch";
        break;
      }
    }
    if (decided === null) {
      if (j > i + FAKEOUT_WINDOW) {
        decided = "bruch";
        j = i + FAKEOUT_WINDOW;
      } else {
        out.pendingBreak = c.openTime; // zu wenige Kerzen danach
        break;
      }
    }
    out.events.push({ kind: decided, time: c.openTime, side, decidedAt: candles[j].openTime, decidedClose: candles[j].close });
    if (decided === "bruch") side = side === "above" ? "below" : "above";
    prevIn = reaches(j, side);
    i = j;
  }
  out.side = side;
  return out;
}
