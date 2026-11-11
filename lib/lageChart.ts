// Lage-Chart: reine Logik (kein DB-Zugriff, keine Darstellung).
//
// Die Kachel zeigt Preis, Lage-Verlauf, Fluss und Positionierung auf EINER
// Zeitachse. Dieses Modul rechnet aus Kerzen, Features und Funding pro Kerze
// vier Lage-Zustaende (Trend, Fluss, Positionierung, Risiko), dazu Wochen- und
// Monats-VWAP (Toby 11.11.2026: kein Tages-VWAP). Die Schwellen unten sind
// Startwerte fuer den Prototyp und noch nicht gegen die Regime-Logik der
// Marktphase abgeglichen.

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type LageKind = "bull" | "bear" | "flat" | "warn" | "hot";
export type LageKey = "trend" | "flow" | "fund" | "risk";
export const LAGE_KEYS: LageKey[] = ["trend", "flow", "fund", "risk"];
export const LAGE_KEY_LABEL: Record<LageKey, string> = {
  trend: "Trend",
  flow: "Fluss",
  fund: "Positionierung",
  risk: "Risiko",
};

export interface LageState {
  kind: LageKind;
  label: string;
  why: string;
}

export interface LageStructure {
  type: "BOS" | "CHoCH";
  dir: 1 | -1;
}

/** Eine Kerze mit den Features, die der Chart braucht (Zeit = Kerzenbeginn, UTC-ms). */
export interface LageInputCandle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  adx: number | null;
  atr: number | null;
  cvdDelta: number | null;
  cvdCum: number | null;
  oiDeltaPct: number | null;
  basisPct: number | null;
  /** Funding in Prozent (0.01 = 0.01 %), letzter bekannter Wert zum Kerzenende. */
  funding: number | null;
  structure: LageStructure | null;
}

export interface LagePoint extends LageInputCandle {
  wvwap: number | null;
  mvwap: number | null;
  /** Neuer Wochen-/Monatsanker in dieser Kerze: die Linie wird unterbrochen. */
  wBreak: boolean;
  mBreak: boolean;
  states: Record<LageKey, LageState>;
  /** Seit wie vielen Kerzen der Zustand gilt und was davor war. */
  since: Record<LageKey, { candles: number; prev: string | null }>;
}

export interface LageEvent {
  t: number;
  label: string;
}

export interface LageSeries {
  interval: "1h" | "4h";
  hours: number;
  points: LagePoint[];
}

// ---------- Formatierung ----------

export const nf = (v: number, d = 0): string =>
  v.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
export const sg = (v: number, d = 0): string => (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d);

// ---------- Anker-VWAP (Woche Montag 00:00 UTC, Monat 1. 00:00 UTC) ----------
// Gleiche Anker wie get_anchored_vwap_summary() in der Datenbank.

export function weekStartMs(t: number): number {
  const day = Math.floor(t / DAY_MS);
  // 1.1.1970 war ein Donnerstag: (day + 3) % 7 = Tage seit Montag.
  return (day - ((day + 3) % 7)) * DAY_MS;
}

export function monthStartMs(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface HourlyCandle {
  t: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnchoredVwapRow {
  t: number;
  week: number | null;
  month: number | null;
  weekAnchor: number;
  monthAnchor: number;
}

/** Wochen- und Monats-VWAP je 1h-Kerze, kumulativ ab dem Anker (Typical Price x Volumen). Eingabe aufsteigend. */
export function anchoredVwapSeries(hourly: HourlyCandle[]): AnchoredVwapRow[] {
  const out: AnchoredVwapRow[] = [];
  let wAnchor = -1;
  let mAnchor = -1;
  let wPv = 0;
  let wV = 0;
  let mPv = 0;
  let mV = 0;
  for (const c of hourly) {
    const wa = weekStartMs(c.t);
    const ma = monthStartMs(c.t);
    if (wa !== wAnchor) {
      wAnchor = wa;
      wPv = 0;
      wV = 0;
    }
    if (ma !== mAnchor) {
      mAnchor = ma;
      mPv = 0;
      mV = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    wPv += tp * c.volume;
    wV += c.volume;
    mPv += tp * c.volume;
    mV += c.volume;
    out.push({
      t: c.t,
      week: wV > 0 ? wPv / wV : null,
      month: mV > 0 ? mPv / mV : null,
      weekAnchor: wa,
      monthAnchor: ma,
    });
  }
  return out;
}

// ---------- Zustaende ----------

export const ADX_RANGE_BELOW = 20;
export const FLOW_WINDOW_CANDLES = 6;
export const FLOW_Z_THRESHOLD = 0.5;
export const FUNDING_WARN_PCT = 0.025;
export const FUNDING_HOT_PCT = 0.045;
export const FUNDING_SHORT_WARN_PCT = -0.005;
export const FUNDING_SHORT_HOT_PCT = -0.02;
export const ATR_HIGH_FACTOR = 1.2;
export const EVENT_LEAD_HOURS = 6;
export const EVENT_AFTER_HOURS = 2;

function median(values: (number | null)[]): number | null {
  const s = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

function trendState(c: LageInputCandle): LageState {
  if (c.adx === null || c.ema20 === null || c.ema50 === null) {
    return { kind: "flat", label: "Range", why: "zu wenig Verlauf" };
  }
  const adx = nf(c.adx, 0);
  if (c.adx < ADX_RANGE_BELOW) return { kind: "flat", label: "Range", why: `ADX ${adx} unter ${ADX_RANGE_BELOW}` };
  if (c.ema20 > c.ema50 && c.close > c.ema50) {
    return { kind: "bull", label: "Bullisch", why: `EMA 20 über EMA 50 · ADX ${adx}` };
  }
  if (c.ema20 < c.ema50 && c.close < c.ema50) {
    return { kind: "bear", label: "Bärisch", why: `EMA 20 unter EMA 50 · ADX ${adx}` };
  }
  return { kind: "flat", label: "Übergang", why: `EMAs widersprechen sich · ADX ${adx}` };
}

function flowState(candles: LageInputCandle[], i: number): LageState {
  const c = candles[i];
  const back = candles[i - FLOW_WINDOW_CANDLES];
  if (!back || c.cvdCum === null || back.cvdCum === null) {
    return { kind: "flat", label: "Ausgeglichen", why: "zu wenig Verlauf" };
  }
  const sum = c.cvdCum - back.cvdCum;
  let absSum = 0;
  let count = 0;
  for (let j = Math.max(0, i - 48); j <= i; j++) {
    const d = candles[j].cvdDelta;
    if (d !== null) {
      absSum += Math.abs(d);
      count++;
    }
  }
  const scale = count ? (2.5 * absSum) / count : 0;
  const z = scale > 0 ? sum / scale : 0;
  const why = `CVD ${sg(sum)} BTC in ${FLOW_WINDOW_CANDLES} Kerzen`;
  if (z > FLOW_Z_THRESHOLD) return { kind: "bull", label: "Käufer", why };
  if (z < -FLOW_Z_THRESHOLD) return { kind: "bear", label: "Verkäufer", why };
  return { kind: "flat", label: "Ausgeglichen", why };
}

function fundState(c: LageInputCandle): LageState {
  if (c.funding === null) return { kind: "flat", label: "Keine Daten", why: "Funding fehlt für diese Kerze" };
  const f = c.funding;
  const why = `Funding ${nf(f, 3)} %` + (c.basisPct !== null ? ` · Basis ${nf(c.basisPct, 2)} %` : "");
  if (f > FUNDING_HOT_PCT) return { kind: "hot", label: "Überhitzt (Long)", why };
  if (f > FUNDING_WARN_PCT) return { kind: "warn", label: "Long-lastig", why };
  if (f < FUNDING_SHORT_HOT_PCT) return { kind: "hot", label: "Überhitzt (Short)", why };
  if (f < FUNDING_SHORT_WARN_PCT) return { kind: "warn", label: "Short-lastig", why };
  return { kind: "flat", label: "Ausgewogen", why };
}

function riskState(candles: LageInputCandle[], i: number, hours: number, events: LageEvent[]): LageState {
  const c = candles[i];
  const atrPct = (k: number) => {
    const x = candles[k];
    return x.atr !== null && x.close > 0 ? (x.atr / x.close) * 100 : null;
  };
  const now = atrPct(i);
  const med = median(Array.from({ length: Math.min(121, i + 1) }, (_, d) => atrPct(i - d)));
  const hiVol = now !== null && med !== null && now > ATR_HIGH_FACTOR * med;
  const end = c.t + hours * HOUR_MS;
  let ev: string | null = null;
  for (const e of events) {
    const pre = e.t - end;
    const post = c.t - e.t;
    if (pre >= -HOUR_MS && pre <= EVENT_LEAD_HOURS * HOUR_MS) {
      ev = pre > 0 ? `${e.label} in ${Math.max(1, Math.round(pre / HOUR_MS))} h` : `${e.label} läuft`;
    } else if (post >= 0 && post <= EVENT_AFTER_HOURS * HOUR_MS) {
      ev = `${e.label} vor ${Math.max(1, Math.round(post / HOUR_MS))} h`;
    }
  }
  if (ev && hiVol) return { kind: "hot", label: "Hoch", why: `${ev} · hohe Schwankung` };
  if (ev) return { kind: "warn", label: "Erhöht", why: ev };
  const atrText = now !== null ? `ATR ${nf(now, 2)} % vom Preis` : "ATR fehlt";
  if (hiVol) return { kind: "warn", label: "Erhöht", why: `Schwankung über Normal · ${atrText}` };
  return { kind: "flat", label: "Ruhig", why: atrText };
}

export function computeStates(
  candles: LageInputCandle[],
  hours: number,
  events: LageEvent[]
): Record<LageKey, LageState>[] {
  return candles.map((c, i) => ({
    trend: trendState(c),
    flow: flowState(candles, i),
    fund: fundState(c),
    risk: riskState(candles, i, hours, events),
  }));
}

/** Je Kerze und Bereich: seit wie vielen Kerzen dieselbe Beschriftung gilt und was davor stand. */
export function computeSince(
  states: Record<LageKey, LageState>[]
): Record<LageKey, { candles: number; prev: string | null }>[] {
  const out: Record<LageKey, { candles: number; prev: string | null }>[] = [];
  states.forEach((s, i) => {
    const row = {} as Record<LageKey, { candles: number; prev: string | null }>;
    for (const k of LAGE_KEYS) {
      const before = out[i - 1]?.[k];
      row[k] =
        before && states[i - 1][k].label === s[k].label
          ? { candles: before.candles + 1, prev: before.prev }
          : { candles: 1, prev: i > 0 ? states[i - 1][k].label : null };
    }
    out.push(row);
  });
  return out;
}

// ---------- Zusammenbau ----------

export interface FundingSample {
  t: number;
  /** Rohwert der Boerse als Bruch (0.0001 = 0.01 %). */
  rate: number;
}

/** Letztes Funding mit t <= endMs (Eingabe aufsteigend), in Prozent. */
export function fundingAt(samples: FundingSample[], endMs: number): number | null {
  let lo = 0;
  let hi = samples.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= endMs) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? samples[best].rate * 100 : null;
}

export interface LageBuildInput {
  interval: "1h" | "4h";
  /** Kerzen inkl. Features, aufsteigend, nur abgeschlossene. */
  candles: LageInputCandle[];
  hourly: HourlyCandle[];
  funding: FundingSample[];
  events: LageEvent[];
  /** So viele juengste Kerzen kommen in die Ausgabe (aeltere dienen nur der Rechnung). */
  keep: number;
}

export function buildLageSeries(input: LageBuildInput): LageSeries {
  const hours = input.interval === "4h" ? 4 : 1;
  const vwap = anchoredVwapSeries(input.hourly);
  const byT = new Map(vwap.map((r, idx) => [r.t, idx]));
  const withFunding = input.candles.map((c) => ({
    ...c,
    funding: fundingAt(input.funding, c.t + hours * HOUR_MS),
  }));
  const states = computeStates(withFunding, hours, input.events);
  const since = computeSince(states);
  const points: LagePoint[] = withFunding.map((c, i) => {
    // Letzte 1h-Kerze, die in dieser Kerze liegt.
    const idx = byT.get(c.t + (hours - 1) * HOUR_MS);
    const row = idx !== undefined ? vwap[idx] : undefined;
    const prevIdx = i > 0 ? byT.get(withFunding[i - 1].t + (hours - 1) * HOUR_MS) : undefined;
    const prev = prevIdx !== undefined ? vwap[prevIdx] : undefined;
    return {
      ...c,
      wvwap: row?.week ?? null,
      mvwap: row?.month ?? null,
      wBreak: !!row && !!prev && row.weekAnchor !== prev.weekAnchor,
      mBreak: !!row && !!prev && row.monthAnchor !== prev.monthAnchor,
      states: states[i],
      since: since[i],
    };
  });
  return { interval: input.interval, hours, points: points.slice(-input.keep) };
}

// ---------- Zeilen aus der Datenbank ----------

export interface CandleRow {
  open_time: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
}

export interface FeatureRow {
  candle_open_time: string;
  ema_20: number | string | null;
  ema_50: number | string | null;
  ema_200: number | string | null;
  rsi_14: number | string | null;
  adx_14: number | string | null;
  atr_14: number | string | null;
  cvd_delta: number | string | null;
  cvd_cumulative: number | string | null;
  oi_delta_pct: number | string | null;
  basis_pct: number | string | null;
  bos: boolean | null;
  bos_direction: string | null;
  choch: boolean | null;
  choch_direction: string | null;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function structureOf(f: FeatureRow | undefined): LageStructure | null {
  if (!f) return null;
  if (f.choch && f.choch_direction) return { type: "CHoCH", dir: f.choch_direction === "bullish" ? 1 : -1 };
  if (f.bos && f.bos_direction) return { type: "BOS", dir: f.bos_direction === "bullish" ? 1 : -1 };
  return null;
}

/** Fuehrt Kerzen und Features (ueber die Kerzenzeit) zusammen. Kerzen ohne Features bleiben mit leeren Werten. */
export function mergeCandleRows(candles: CandleRow[], features: FeatureRow[]): LageInputCandle[] {
  const feat = new Map(features.map((f) => [new Date(f.candle_open_time).getTime(), f]));
  return candles
    .map((c) => {
      const t = new Date(c.open_time).getTime();
      const f = feat.get(t);
      return {
        t,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: num(c.volume) ?? 0,
        ema20: num(f?.ema_20),
        ema50: num(f?.ema_50),
        ema200: num(f?.ema_200),
        rsi: num(f?.rsi_14),
        adx: num(f?.adx_14),
        atr: num(f?.atr_14),
        cvdDelta: num(f?.cvd_delta),
        cvdCum: num(f?.cvd_cumulative),
        oiDeltaPct: num(f?.oi_delta_pct),
        basisPct: num(f?.basis_pct),
        funding: null,
        structure: structureOf(f),
      };
    })
    .sort((a, b) => a.t - b.t);
}

/** Nur abgeschlossene Kerzen: Beginn + Dauer <= jetzt. */
export function onlyClosed<T extends { t: number }>(rows: T[], hours: number, nowMs: number): T[] {
  return rows.filter((r) => r.t + hours * HOUR_MS <= nowMs);
}
