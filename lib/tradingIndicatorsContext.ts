import { supabase } from "./supabase";
import { detectFractalSwings, emaSeries, findPivots, type FractalSwingResult } from "./swingDetection";
import { isTrendingRegime } from "./marketRegime";
import type { MarketRegime } from "./types";

// Datenschicht fuer Tobys eigene TradingView-Indikatoren (GUSS/VWAP-Vector/
// CVD -- Umsetzungsplan "Exakte Faktoren", Phase 1-3). Reine On-Request-
// Berechnung bei jedem Seitenaufruf (gleiches Muster wie getEma13() in
// lib/meinSystemContext.ts), keine neue Tabelle/Edge-Function/Cron in v1 --
// siehe Umsetzungsplan Entscheidung 2 fuer die Begruendung.

const GUSS_CANDLE_LOOKBACK = 300;
// Mo's VWAP-Vector-Skript nutzt swingPivLen=20 -- dieselbe Fenstergroesse
// hier fuer GUSS' Pullback-Ursprung, damit beide Indikatoren dieselbe
// Swing-Definition teilen (siehe lib/swingDetection.ts Kopf-Kommentar:
// bewusst getrennt von market_features.swing_type, das lookback=5 nutzt).
const GUSS_SWING_LOOKBACK = 20;
// GUSS pruefte laut Toby "EMA 50 oder 21, je nach Kontext" -- ohne
// automatisch entscheidbares Kriterium, WELCHE der beiden gemeint ist,
// werden hier BEIDE Varianten parallel berechnet und angezeigt, statt eine
// zu erraten.
const GUSS_EMA_PERIODS = [21, 50] as const;
type GussEmaPeriod = (typeof GUSS_EMA_PERIODS)[number];

// VWAP-Vector nutzt dieselben 1H-Kerzen + Swing-Erkennung wie GUSS (siehe
// fetchBaseData() unten) -- ein gemeinsamer Fetch statt zwei getrennter
// Anfragen an candles/market_state_matrix.
const VWAP_EMA_INTERVALS = ["1h", "4h"] as const;
type VwapEmaInterval = (typeof VWAP_EMA_INTERVALS)[number];
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

interface Candle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradingIndicatorsBaseData {
  candles: Candle[];
  regime: MarketRegime | null;
  regimeAllowsGuss: boolean | null;
}

export interface GussVariantData {
  emaPeriod: GussEmaPeriod;
  emaValue: number | null;
  trendDirection: "up" | "down" | null;
  pullbackTouchedEma: boolean | null;
  pullbackClean: boolean | null;
  // touched && clean && regimeAllowsGuss -- null, wenn irgendeine der drei
  // Teilaussagen nicht bekannt ist (nie faelschlich false/true erfinden).
  active: boolean | null;
}

export interface GussSignalData {
  interval: "1h";
  variants: GussVariantData[];
  regimeAllowsGuss: boolean | null;
  regime: MarketRegime | null;
  closePrice: number | null;
  dataAsOf: string | null;
}

// Pruefung der eigentlichen GUSS-Regel auf einem bereits abgegrenzten
// Pullback-Segment (vom letzten Swing-Extrempunkt bis jetzt, Segment[0] =
// die Swing-Kerze selbst). Als reine Funktion exportiert, damit die
// Kernlogik ohne Supabase-Mock testbar ist (wie computeEma() in
// meinSystemContext.ts).
//
// GUSS-Regel (vom Nutzer spezifiziert, Original-Skript nicht einsehbar):
// Trend = Preis ueber/unter der EMA. Der Pullback laeuft VOM letzten
// Swing-Extrempunkt IN Trendrichtung (Swing-Hoch bei Aufwaertstrend,
// Swing-Tief bei Abwaertstrend) zurueck zur EMA -- die Pullback-RICHTUNG
// ist also der Trendrichtung entgegengesetzt. "touched" = irgendeine Kerze
// im Segment beruehrt die EMA per Docht (Body-Beruehrung nicht nötig).
// "clean" = KEINE Kerze im Segment (ausser der Ursprungs-Swing-Kerze
// selbst) schloss entgegen der Pullback-Richtung -- bei Aufwaertstrend
// waere das eine bullische Kerze (schliesst gegen die abwaerts laufende
// Pullback-Bewegung), bei Abwaertstrend eine baerische.
export function evaluateGussPullback(
  segment: Pick<Candle, "open" | "high" | "low" | "close">[],
  emaAtSegment: (number | null)[],
  trendDirection: "up" | "down"
): { touched: boolean | null; clean: boolean | null } {
  if (segment.length === 0) return { touched: null, clean: null };

  let touched = false;
  let touchedKnown = false;
  let clean = true;

  for (let i = 0; i < segment.length; i++) {
    const ema = emaAtSegment[i];
    if (ema !== null) {
      touchedKnown = true;
      if (trendDirection === "up" && segment[i].low <= ema) touched = true;
      if (trendDirection === "down" && segment[i].high >= ema) touched = true;
    }
    if (i === 0) continue; // Ursprungs-Swing-Kerze selbst ausgenommen.
    if (trendDirection === "up" && segment[i].close > segment[i].open) clean = false;
    if (trendDirection === "down" && segment[i].close < segment[i].open) clean = false;
  }

  return { touched: touchedKnown ? touched : null, clean };
}

function emptyVariant(period: GussEmaPeriod): GussVariantData {
  return {
    emaPeriod: period,
    emaValue: null,
    trendDirection: null,
    pullbackTouchedEma: null,
    pullbackClean: null,
    active: null,
  };
}

function buildGussVariant(
  period: GussEmaPeriod,
  candles: Candle[],
  closes: number[],
  swings: FractalSwingResult,
  regimeAllowsGuss: boolean | null
): GussVariantData {
  const emaValues = emaSeries(closes, period);
  const lastEma = emaValues[emaValues.length - 1] ?? null;
  const lastClose = closes[closes.length - 1] ?? null;
  if (lastEma === null || lastClose === null) return emptyVariant(period);

  const trendDirection: "up" | "down" | null =
    lastClose > lastEma ? "up" : lastClose < lastEma ? "down" : null;
  if (trendDirection === null) {
    return { emaPeriod: period, emaValue: lastEma, trendDirection: null, pullbackTouchedEma: null, pullbackClean: null, active: null };
  }

  // Pullback-Ursprung: letztes bestaetigtes Swing-Hoch bei Aufwaertstrend
  // (der Pullback faellt VON diesem Hoch zurueck zur EMA), letztes
  // bestaetigtes Swing-Tief bei Abwaertstrend.
  const originFlags = trendDirection === "up" ? swings.isSwingHigh : swings.isSwingLow;
  let originIdx: number | null = null;
  for (let i = originFlags.length - 1; i >= 0; i--) {
    if (originFlags[i]) {
      originIdx = i;
      break;
    }
  }
  if (originIdx === null) {
    return { emaPeriod: period, emaValue: lastEma, trendDirection, pullbackTouchedEma: null, pullbackClean: null, active: null };
  }

  const segment = candles.slice(originIdx);
  const emaAtSegment = emaValues.slice(originIdx);
  const { touched, clean } = evaluateGussPullback(segment, emaAtSegment, trendDirection);

  const active =
    touched === null || clean === null || regimeAllowsGuss === null ? null : touched && clean && regimeAllowsGuss;

  return { emaPeriod: period, emaValue: lastEma, trendDirection, pullbackTouchedEma: touched, pullbackClean: clean, active };
}

// Gemeinsamer Fetch fuer GUSS UND VWAP-Vector (beide brauchen dieselben
// juengsten 1H-Kerzen + dasselbe Regime) -- EIN Query-Paar statt zweier,
// wenn beide Faktoren zusammen ueber getTradingIndicatorsData() geladen
// werden (siehe Umsetzungsplan Phase 2, "gemeinsame getTradingIndicatorsData()").
async function fetchBaseData(): Promise<TradingIndicatorsBaseData> {
  const [{ data: candleRows, error: candleError }, { data: regimeRow, error: regimeError }] = await Promise.all([
    supabase
      .from("candles")
      .select("open_time, open, high, low, close")
      .eq("exchange", "binance")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "1h")
      .order("open_time", { ascending: false })
      .limit(GUSS_CANDLE_LOOKBACK),
    // Regime-Gate: market_state_matrix.regime ist Nexus' dedizierte Trend-
    // vs-Seitwaerts-Klassifikation (VOLA_SQUEEZE_RANGING = "Seitwaerts") --
    // genau das, was Toby mit "Nexus' Regime-Engine" meint (Umsetzungsplan-
    // Korrektur: NICHT der interne trend_strength-Teilfaktor). Gleiches
    // Abfragemuster wie getLatestRegime() in lib/marketStateNarrativeContext.ts.
    supabase
      .from("market_state_matrix")
      .select("regime, data_coverage_pct")
      .order("timestamp_utc", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (candleError) {
    console.error("tradingIndicatorsContext: Fehler beim Laden der 1H-Kerzen:", candleError.message);
  }
  if (regimeError) {
    console.error("tradingIndicatorsContext: Fehler beim Laden des Regimes:", regimeError.message);
  }

  const candles: Candle[] = (candleRows ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      openTime: row.open_time as string,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }));

  const regime = (regimeRow?.regime as MarketRegime | undefined) ?? null;
  const regimeAllowsGuss = regime ? isTrendingRegime(regime) : null;

  return { candles, regime, regimeAllowsGuss };
}

function computeGuss(base: TradingIndicatorsBaseData): GussSignalData {
  const { candles, regime, regimeAllowsGuss } = base;
  const lastCandle = candles[candles.length - 1] ?? null;

  if (candles.length < GUSS_SWING_LOOKBACK * 2 + 1) {
    return {
      interval: "1h",
      variants: GUSS_EMA_PERIODS.map((period) => emptyVariant(period)),
      regimeAllowsGuss,
      regime,
      closePrice: lastCandle?.close ?? null,
      dataAsOf: lastCandle?.openTime ?? null,
    };
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const swings = detectFractalSwings(highs, lows, GUSS_SWING_LOOKBACK);

  const variants = GUSS_EMA_PERIODS.map((period) =>
    buildGussVariant(period, candles, closes, swings, regimeAllowsGuss)
  );

  return {
    interval: "1h",
    variants,
    regimeAllowsGuss,
    regime,
    closePrice: lastCandle?.close ?? null,
    dataAsOf: lastCandle?.openTime ?? null,
  };
}

export async function getGussSignalData(): Promise<GussSignalData> {
  return computeGuss(await fetchBaseData());
}

// --- VWAP-Vector (Umsetzungsplan Phase 2) -----------------------------

export interface VwapEmaFan {
  interval: VwapEmaInterval;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  ema800: number | null;
}

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface VwapVectorData {
  currentPrice: number | null;
  dayVwap: number | null;
  weeklyVwap: number | null;
  weeklyAnchorUtc: string | null;
  monthlyVwap: number | null;
  monthlyAnchorUtc: string | null;
  swingHighVwap: number | null;
  swingHighAnchorUtc: string | null;
  swingLowVwap: number | null;
  swingLowAnchorUtc: string | null;
  emaFans: VwapEmaFan[];
  // Standard-Retracement-Grid (0/23,6/38,2/50/61,8/78,6/100%) zwischen dem
  // juengsten Swing-Hoch und -Tief. Mo's Original-Skript erweitert dieses
  // Grid vermutlich per ATR ueber 0%/100% hinaus (Fibonacci-Extension) --
  // ohne einsehbaren Original-Quellcode wird hier bewusst nur das
  // gesicherte Retracement-Grid nachgebaut, keine erratene ATR-Erweiterung.
  fibLevels: FibLevel[] | null;
  dataAsOf: string | null;
}

async function fetchEmaFan(interval: VwapEmaInterval): Promise<VwapEmaFan> {
  const { data, error } = await supabase
    .from("market_features")
    .select("ema_20, ema_50, ema_100, ema_200, ema_800")
    .eq("symbol", "BTCUSDT")
    .eq("interval", interval)
    .order("candle_open_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`tradingIndicatorsContext: Fehler beim Laden des EMA-Faechers (${interval}):`, error.message);
  }

  return {
    interval,
    ema20: data?.ema_20 ?? null,
    ema50: data?.ema_50 ?? null,
    ema100: data?.ema_100 ?? null,
    ema200: data?.ema_200 ?? null,
    ema800: data?.ema_800 ?? null,
  };
}

function computeFibLevels(candles: Candle[], swings: FractalSwingResult): FibLevel[] | null {
  let lastSwingHighIdx: number | null = null;
  let lastSwingLowIdx: number | null = null;
  for (let i = swings.isSwingHigh.length - 1; i >= 0; i--) {
    if (lastSwingHighIdx === null && swings.isSwingHigh[i]) lastSwingHighIdx = i;
    if (lastSwingLowIdx === null && swings.isSwingLow[i]) lastSwingLowIdx = i;
    if (lastSwingHighIdx !== null && lastSwingLowIdx !== null) break;
  }
  if (lastSwingHighIdx === null || lastSwingLowIdx === null) return null;

  const highPrice = candles[lastSwingHighIdx].high;
  const lowPrice = candles[lastSwingLowIdx].low;
  const range = highPrice - lowPrice;
  if (range <= 0) return null;

  return FIB_RATIOS.map((ratio) => ({ ratio, price: highPrice - ratio * range }));
}

async function computeVwapVector(base: TradingIndicatorsBaseData): Promise<VwapVectorData> {
  const { candles } = base;
  const lastCandle = candles[candles.length - 1] ?? null;

  const dayAnchor = new Date();
  dayAnchor.setUTCHours(0, 0, 0, 0);

  const [anchoredRes, dayRes, emaFans] = await Promise.all([
    // Deckt weekly_vwap/monthly_vwap bereits vollstaendig ab (siehe
    // Umsetzungsplan Punkt 4/Recherche pg_get_functiondef) -- kein
    // Doppelaufbau derselben Arithmetik.
    supabase.rpc("get_anchored_vwap_summary"),
    supabase.rpc("get_vwap_since", { p_anchor_utc: dayAnchor.toISOString() }),
    Promise.all(VWAP_EMA_INTERVALS.map((interval) => fetchEmaFan(interval))),
  ]);

  if (anchoredRes.error) {
    console.error("tradingIndicatorsContext: Fehler bei get_anchored_vwap_summary:", anchoredRes.error.message);
  }
  if (dayRes.error) {
    console.error("tradingIndicatorsContext: Fehler bei get_vwap_since (Tag-Anker):", dayRes.error.message);
  }

  const anchored = (anchoredRes.data ?? null) as Record<string, unknown> | null;

  let swingHighVwap: number | null = null;
  let swingHighAnchorUtc: string | null = null;
  let swingLowVwap: number | null = null;
  let swingLowAnchorUtc: string | null = null;
  let fibLevels: FibLevel[] | null = null;

  if (candles.length >= GUSS_SWING_LOOKBACK * 2 + 1) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const swings = detectFractalSwings(highs, lows, GUSS_SWING_LOOKBACK);

    let lastSwingHighIdx: number | null = null;
    let lastSwingLowIdx: number | null = null;
    for (let i = swings.isSwingHigh.length - 1; i >= 0; i--) {
      if (swings.isSwingHigh[i]) {
        lastSwingHighIdx = i;
        break;
      }
    }
    for (let i = swings.isSwingLow.length - 1; i >= 0; i--) {
      if (swings.isSwingLow[i]) {
        lastSwingLowIdx = i;
        break;
      }
    }

    const [swingHighRes, swingLowRes] = await Promise.all([
      lastSwingHighIdx !== null
        ? supabase.rpc("get_vwap_since", { p_anchor_utc: candles[lastSwingHighIdx].openTime })
        : Promise.resolve({ data: null, error: null }),
      lastSwingLowIdx !== null
        ? supabase.rpc("get_vwap_since", { p_anchor_utc: candles[lastSwingLowIdx].openTime })
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (swingHighRes.error) {
      console.error("tradingIndicatorsContext: Fehler bei get_vwap_since (Swing-Hoch):", swingHighRes.error.message);
    }
    if (swingLowRes.error) {
      console.error("tradingIndicatorsContext: Fehler bei get_vwap_since (Swing-Tief):", swingLowRes.error.message);
    }

    swingHighVwap = (swingHighRes.data as number | null) ?? null;
    swingHighAnchorUtc = lastSwingHighIdx !== null ? candles[lastSwingHighIdx].openTime : null;
    swingLowVwap = (swingLowRes.data as number | null) ?? null;
    swingLowAnchorUtc = lastSwingLowIdx !== null ? candles[lastSwingLowIdx].openTime : null;

    fibLevels = computeFibLevels(candles, swings);
  }

  return {
    currentPrice: (anchored?.current_price as number | null) ?? lastCandle?.close ?? null,
    dayVwap: (dayRes.data as number | null) ?? null,
    weeklyVwap: (anchored?.weekly_vwap as number | null) ?? null,
    weeklyAnchorUtc: (anchored?.weekly_anchor_utc as string | null) ?? null,
    monthlyVwap: (anchored?.monthly_vwap as number | null) ?? null,
    monthlyAnchorUtc: (anchored?.monthly_anchor_utc as string | null) ?? null,
    swingHighVwap,
    swingHighAnchorUtc,
    swingLowVwap,
    swingLowAnchorUtc,
    emaFans,
    fibLevels,
    dataAsOf: lastCandle?.openTime ?? null,
  };
}

export async function getVwapVectorData(): Promise<VwapVectorData> {
  return computeVwapVector(await fetchBaseData());
}

// --- CVD Footprint (Umsetzungsplan Phase 3) ---------------------------

// Wie viele der juengsten 1H-Kerzen aus dem gemeinsamen fetchBaseData()-
// Fenster fuer die CVD-Berechnung genutzt werden (Untermenge von
// GUSS_CANDLE_LOOKBACK) -- 48h decken sowohl den Trend-Lookback (5) als
// auch den Divergenz-Lookback (10) mit deutlicher Reserve ab, ohne bei
// jedem Seitenaufruf unnoetig viele 1-Minuten-Zeilen laden zu muessen.
const CVD_HIGHER_TF_LOOKBACK = 48;
// Gleicher Lookback wie CVD_TREND_LOOKBACK in collect-candles -- dieselbe
// rising/falling/flat-Klassifikation, hier auf dem Intrabar-1m-Rollup statt
// auf dem Naeherungswert der Kerzen-Richtung angewendet.
const CVD_TREND_LOOKBACK = 5;
// Mo's Pine-Skript nutzt divLb=10 fuer die Pivot-basierte Divergenz-
// Erkennung -- derselbe Wert hier fuer findPivots().
const CVD_DIVERGENCE_LOOKBACK = 10;

export interface CvdDivergence {
  type: "bullish" | "bearish";
  atOpenTime: string;
}

export interface CvdFootprintData {
  higherTf: "1h";
  latestDelta: number | null;
  latestCumulative: number | null;
  trend: "rising" | "falling" | "flat" | null;
  divergence: CvdDivergence | null;
  dataAsOf: string | null;
}

function hourBucketKey(iso: string): number {
  return Math.floor(Date.parse(iso) / 3_600_000);
}

// Aggregiert die reale 1-Minuten-Taker-Buy/Sell-Differenz (aus candles.
// taker_buy_base_vol -- echte Binance-Aggressor-Seite, siehe collect-
// candles-Kommentar) INNERHALB jeder 1H-Kerze zu einem echten Intrabar-
// CVD-Footprint. Das ist NICHT dasselbe wie market_features.cvd_delta
// (dort: 2*taker_buy_base_vol-volume AM NATIVEN INTERVALL selbst, kein
// 1-Minuten-Rollup) -- siehe lib/panelInfo.ts::cvdFootprintInfo fuer die
// Abgrenzung.
export function bucketMinuteDeltas(
  candles1h: Candle[],
  minuteRows: { open_time: string; volume: number; taker_buy_base_vol: number | null }[]
): number[] {
  const bucketIndex = new Map<number, number>();
  candles1h.forEach((c, i) => bucketIndex.set(hourBucketKey(c.openTime), i));

  const delta = new Array(candles1h.length).fill(0);
  for (const row of minuteRows) {
    const idx = bucketIndex.get(hourBucketKey(row.open_time));
    if (idx === undefined) continue; // ausserhalb des geladenen 1H-Fensters
    const takerBuy = row.taker_buy_base_vol ?? 0;
    delta[idx] += 2 * takerBuy - row.volume;
  }
  return delta;
}

export function classifyCvdTrend(delta: number[], cumulative: number[], lookback: number): "rising" | "falling" | "flat" | null {
  const i = cumulative.length - 1;
  if (i < lookback) return null;
  const change = cumulative[i] - cumulative[i - lookback];
  const recentAvgAbsDelta =
    delta.slice(i - lookback + 1, i + 1).reduce((a, b) => a + Math.abs(b), 0) / lookback;
  const flatThreshold = recentAvgAbsDelta * 0.5;
  if (Math.abs(change) < flatThreshold) return "flat";
  return change > 0 ? "rising" : "falling";
}

// Klassische Preis-/Oszillator-Divergenz: an den juengsten zwei Preis-
// Pivot-Hochs (bzw. -Tiefs) wird NICHT ein eigenes CVD-Pivot verlangt,
// sondern der CVD-Wert an genau diesen Preis-Pivot-Indizes verglichen --
// Standard-Divergenz-Definition (wie bei RSI/MACD-Divergenz), robuster als
// zwei unabhaengige, potenziell versetzte Pivot-Serien gegeneinander
// abzugleichen.
export function detectCvdDivergence(
  candles: Candle[],
  cumulative: number[],
  lookback: number
): CvdDivergence | null {
  const closes = candles.map((c) => c.close);
  const pivots = findPivots(closes, lookback);
  const highs = pivots.filter((p) => p.kind === "high");
  const lows = pivots.filter((p) => p.kind === "low");

  let best: CvdDivergence | null = null;
  let bestIdx = -1;

  if (highs.length >= 2) {
    const prev = highs[highs.length - 2];
    const latest = highs[highs.length - 1];
    if (latest.value > prev.value && cumulative[latest.index] < cumulative[prev.index]) {
      best = { type: "bearish", atOpenTime: candles[latest.index].openTime };
      bestIdx = latest.index;
    }
  }
  if (lows.length >= 2) {
    const prev = lows[lows.length - 2];
    const latest = lows[lows.length - 1];
    if (latest.value < prev.value && cumulative[latest.index] > cumulative[prev.index] && latest.index > bestIdx) {
      best = { type: "bullish", atOpenTime: candles[latest.index].openTime };
    }
  }
  return best;
}

async function computeCvdFootprint(base: TradingIndicatorsBaseData): Promise<CvdFootprintData> {
  const candles1h = base.candles.slice(-CVD_HIGHER_TF_LOOKBACK);
  const lastCandle = candles1h[candles1h.length - 1] ?? null;

  if (candles1h.length < CVD_DIVERGENCE_LOOKBACK * 2 + 1) {
    return { higherTf: "1h", latestDelta: null, latestCumulative: null, trend: null, divergence: null, dataAsOf: lastCandle?.openTime ?? null };
  }

  const { data: minuteRows, error } = await supabase
    .from("candles")
    .select("open_time, volume, taker_buy_base_vol")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1m")
    .gte("open_time", candles1h[0].openTime)
    .order("open_time", { ascending: true })
    .limit(CVD_HIGHER_TF_LOOKBACK * 60 + 200);

  if (error) {
    console.error("tradingIndicatorsContext: Fehler beim Laden der 1m-Kerzen fuer CVD:", error.message);
  }

  const rows = (minuteRows ?? []).map((r) => ({
    open_time: r.open_time as string,
    volume: Number(r.volume),
    taker_buy_base_vol: r.taker_buy_base_vol === null ? null : Number(r.taker_buy_base_vol),
  }));

  const delta = bucketMinuteDeltas(candles1h, rows);
  const cumulative: number[] = [];
  let cum = 0;
  for (const d of delta) {
    cum += d;
    cumulative.push(cum);
  }

  return {
    higherTf: "1h",
    latestDelta: delta[delta.length - 1] ?? null,
    latestCumulative: cumulative[cumulative.length - 1] ?? null,
    trend: classifyCvdTrend(delta, cumulative, CVD_TREND_LOOKBACK),
    divergence: detectCvdDivergence(candles1h, cumulative, CVD_DIVERGENCE_LOOKBACK),
    dataAsOf: lastCandle?.openTime ?? null,
  };
}

export async function getCvdFootprintData(): Promise<CvdFootprintData> {
  return computeCvdFootprint(await fetchBaseData());
}

// --- Kombinierter Einstiegspunkt (von app/lernen/page.tsx genutzt) -----

export interface TradingIndicatorsData {
  guss: GussSignalData;
  vwapVector: VwapVectorData;
  cvd: CvdFootprintData;
}

export async function getTradingIndicatorsData(): Promise<TradingIndicatorsData> {
  const base = await fetchBaseData();
  const [guss, vwapVector, cvd] = await Promise.all([
    Promise.resolve(computeGuss(base)),
    computeVwapVector(base),
    computeCvdFootprint(base),
  ]);
  return { guss, vwapVector, cvd };
}
