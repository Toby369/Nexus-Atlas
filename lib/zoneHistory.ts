import type { Candle } from "./candles";

// Zonen mit Gedaechtnis, Phase 2 (docs/research/ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md).
// Die Geschichte einer AutarkTrade-Zone wird bei jedem Laden aus den
// abgeschlossenen Kerzen ihrer Zeiteinheit berechnet, nicht gespeichert:
// funktioniert rueckwirkend, uebersteht den Autark-Sync (der alle Zonen neu
// schreibt) und braucht keinen Speicher. Die Zone ist ein Ziel, keine
// Vorhersage: Nexus erzaehlt, was dort passiert ist, nicht ob sie haelt.
//
// Regeln (Toby 20.11.2026), gezaehlt werden Schlusskurse der Zeiteinheit:
// - Beruehrung: Kerze reicht in die Zone, Schluss bleibt auf derselben Seite;
//   aufeinanderfolgende Kerzen in der Zone zaehlen einmal. Kommt der Kurs bis
//   auf NEAR_MISS_ATR an die Zone heran, ohne hineinzulaufen, zaehlt das auch
//   ("knapp nicht angelaufen", Toby 20.11.2026).
// - Bruch: Schluss jenseits der Zone, bestaetigt durch einen zweiten Schluss
//   jenseits direkt danach oder dadurch, dass der Kurs innerhalb von 3 Kerzen
//   nicht auf die alte Seite zurueckschliesst.
// - Fehlausbruch: Schluss jenseits, aber innerhalb von 3 Kerzen wieder ein
//   Schluss auf der alten Seite. Zaehlt als Beruehrung (Beispiel 04.11.2026).
// - Retest: Beruehrung nach einem Bruch, von der neuen Seite her. Danach ist
//   die Zone gedreht (Unterstuetzung -> Widerstand oder umgekehrt).

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
export function atrSeries(candles: Candle[], period = ATR_PERIOD): number[] {
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

export function computeZoneHistory(candles: Candle[], low: number, high: number, tf: ZoneTimeframe): ZoneHistory {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const atr = atrSeries(candles);
  const overlaps = (c: Candle) => c.low <= hi && c.high >= lo;
  // Reichweite fuer Beruehrungen: Zone plus NEAR_MISS_ATR (ATR der Kerze davor) zur Kursseite hin.
  const reaches = (i: number, s: ZoneSide) => {
    const pad = NEAR_MISS_ATR * atr[Math.max(0, i - 1)];
    const c = candles[i];
    return s === "above" ? c.low <= hi + pad && c.high >= lo : c.high >= lo - pad && c.low <= hi;
  };
  const beyond = (c: Candle, s: ZoneSide) => (s === "above" ? c.close < lo : c.close > hi);
  const back = (c: Candle, s: ZoneSide) => (s === "above" ? c.close > hi : c.close < lo);
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
        out.events.push({ kind: "beruehrung", time: c.openTime, side, ...(overlaps(c) ? {} : { near: true }) });
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
    out.events.push({ kind: decided, time: c.openTime, side });
    if (decided === "bruch") side = side === "above" ? "below" : "above";
    prevIn = reaches(j, side);
    i = j;
  }
  out.side = side;
  return out;
}

const TZ = "Europe/Zurich";
const dayFmt = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", timeZone: TZ });
const yearFmt = new Intl.DateTimeFormat("de-CH", { year: "2-digit", timeZone: TZ });
/** "05.11." oder, ausserhalb des Jahres der letzten Kerze, "29.01.25". */
function dayText(iso: string, refIso: string | null): string {
  const d = new Date(iso);
  const sameYear = refIso === null || yearFmt.format(d) === yearFmt.format(new Date(refIso));
  return sameYear ? dayFmt.format(d) : `${dayFmt.format(d)}${yearFmt.format(d)}`;
}
// Kurzform wie in der Zonen-Kachel (Toby 20.11.2026): S = Unterstuetzung, R = Widerstand.
const roleOf = (s: ZoneSide) => (s === "above" ? "S" : "R");
const TF_TEXT: Record<ZoneTimeframe, string> = { "1h": "1h", "4h": "4h", "1d": "1D" };

/**
 * Kurzgeschichte fuer die Zonen-Kachel, z. B.
 * "1h: S, 7× berührt (30.10.–04.11.), Fehlausbruch 04.11. · Bruch 05.11. · Retest 06.11.–07.11. (5×) → jetzt R".
 * Bei mehreren Rollenwechseln nur die letzten zwei Abschnitte.
 */
export function zoneHistoryText(h: ZoneHistory): string {
  const day = (iso: string) => dayText(iso, h.to);
  const span = (a: string, b: string) => (day(a) === day(b) ? day(a) : `${day(a)}–${day(b)}`);
  if (h.initialSide === null) return `${TF_TEXT[h.tf]}: Kurs seit ${h.from ? day(h.from) : "?"} in der Zone`;
  // Abschnitte zwischen den Bruechen
  const segments: { side: ZoneSide; touches: ZoneEvent[]; breakAt: string | null }[] = [
    { side: h.initialSide, touches: [], breakAt: null },
  ];
  for (const e of h.events) {
    const cur = segments[segments.length - 1];
    if (e.kind === "bruch") {
      cur.breakAt = e.time;
      segments.push({ side: e.side === "above" ? "below" : "above", touches: [], breakAt: null });
    } else cur.touches.push(e);
  }
  const shown = segments.slice(-2);
  const earlier = segments.length - shown.length;
  const parts: string[] = [];
  shown.forEach((s, k) => {
    const isFirst = k === 0 && earlier === 0;
    const fake = s.touches.filter((t) => t.kind === "fehlausbruch").map((t) => day(t.time));
    const n = s.touches.length;
    const range = n ? span(s.touches[0].time, s.touches[n - 1].time) : "";
    const nNear = s.touches.filter((t) => t.near).length;
    const nearText = nNear ? `, davon ${nNear} knapp` : "";
    if (isFirst || k === 0) {
      const head = isFirst ? roleOf(s.side) : `wieder ${roleOf(s.side)}`;
      parts.push(n ? `${head}, ${n}× berührt${nearText} (${range})` : `${head}, unberührt seit ${h.from ? day(h.from) : "?"}`);
    } else {
      parts.push(n ? `Retest ${range}${n > 1 ? ` (${n}×${nearText})` : nearText ? " (knapp)" : ""} → jetzt ${roleOf(s.side)}` : `noch kein Retest`);
    }
    if (fake.length) parts[parts.length - 1] += `, Fehlausbruch ${[...new Set(fake)].join(", ")}`;
    if (s.breakAt) parts.push(`Bruch ${day(s.breakAt)}`);
  });
  if (h.pendingBreak) parts.push(`Schluss jenseits ${day(h.pendingBreak)}, Bruch noch offen`);
  const prefix = earlier > 0 ? `${earlier} frühere Rollenwechsel · ` : "";
  return `${TF_TEXT[h.tf]}: ${prefix}${parts.join(" · ")}`;
}

export interface ZoneHistoryInput {
  low: number;
  high: number;
  label: string | null;
}

/** Schluessel, ueber den die Zonen-Kachel eine Geschichte ihrer Zone zuordnet. */
export const zoneKey = (low: number, high: number) => `${Math.min(low, high)}-${Math.max(low, high)}`;

/**
 * Kurzgeschichte je Zone mit Zeiteinheit im Namen; Zonen ohne Angabe bekommen
 * einen Hinweis statt einer Geschichte.
 */
export function zoneHistoryTexts(
  zones: ZoneHistoryInput[],
  candles: Partial<Record<ZoneTimeframe, Candle[]>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const z of zones) {
    const tf = timeframeFromLabel(z.label);
    const key = zoneKey(z.low, z.high);
    if (!tf) {
      out[key] = "Ohne Geschichte: Zeiteinheit (1h, 4h, 1D) am Namensanfang fehlt";
      continue;
    }
    const c = candles[tf];
    out[key] = c && c.length ? zoneHistoryText(computeZoneHistory(c, z.low, z.high, tf)) : `${TF_TEXT[tf]}: keine Kerzen`;
  }
  return out;
}
