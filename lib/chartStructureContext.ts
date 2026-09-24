import { supabase } from "./supabase";
import { detectFractalSwings, findPivots } from "./swingDetection";

// Datenschicht fuer "Struktur: Key Levels, AVWAP, Trendlinien, Muster"
// (Nutzer-Idee 24.09.2026, Recherche siehe Chat-Verlauf: Key-Level-/AVWAP-/
// Trendlinien-/Kerzenmuster-Regelwerk). Reine, deterministische Berechnung
// bei jedem Seitenaufruf -- KEIN KI-Aufruf (bewusste Nutzer-Entscheidung
// "erstmal ohne KI-Verbindung"), gleiches Muster wie GUSS/VWAP-Vector/CVD
// in tradingIndicatorsContext.ts (eigener Candle-Fetch statt Cross-Import,
// da dessen `Candle`-Interface modul-intern ist).
//
// Umsetzungs-Entscheidung (Recherche-Ergebnis): AVWAP-Pivot-Engine und
// Kerzenmuster-Erkennung existierten bereits (research-python/
// avwap_pivot_setup/avwap_engine.py bzw. die DB-Funktion
// research_detect_candlestick_patterns()) -- hier nach TypeScript
// portiert/produktiv verdrahtet. Trendlinien-Erkennung existierte nirgends
// und ist hier komplett neu gebaut (auf Basis der bereits vorhandenen
// Swing-Erkennung aus lib/swingDetection.ts). Key Levels nutzen bewusst NUR
// Liquidations-Cluster (nicht zusaetzlich Fibonacci/Orderbook-Waende --
// beide stehen bereits in VwapVectorCard/OrderbookWallCard auf derselben
// Seite, keine Dopplung).

const CANDLE_LOOKBACK = 300; // gleiche Fenstergroesse wie GUSS_CANDLE_LOOKBACK
const CANDLESTICK_PRIOR_TREND_LOOKBACK = 6; // 1:1 wie research_detect_candlestick_patterns() (lag 6)
const CANDLESTICK_RECENT_EVENTS_LIMIT = 5;

// AVWAP-Pivot (Toby-Setup-Idee 18.09.2026, siehe research-python/
// avwap_pivot_setup/config.py::AvwapPivotParams) -- identische Werte.
const AVWAP_PIVOT_LENGTH = 3;
const AVWAP_MAX_ACTIVE_LINES_PER_SIDE = 5;

// Trendlinien (neu, 24.09.2026): dieselbe Swing-Definition wie VWAP-Vector/
// GUSS (GUSS_SWING_LOOKBACK in tradingIndicatorsContext.ts), damit alle
// "Struktur"-Kacheln auf derselben Seite dieselben Wendepunkte meinen.
const TRENDLINE_SWING_LOOKBACK = 20;
// Stefan Salomon (Web-Recherche + knowledge_base module='salomon'): "Eine
// Linie ist erst dann ein statistisch relevanter Trend, wenn sie mindestens
// drei Beruehrungspunkte hat."
const TRENDLINE_MIN_TOUCHES = 3;
// Wie nah ein weiterer Schwenkpunkt an der verlaengerten Linie liegen muss,
// um noch als "Beruehrung" zu zaehlen (relativ zum Linienwert an dieser
// Stelle) -- eigene, dokumentierte Toleranz, keine Originalquelle.
const TRENDLINE_TOUCH_TOLERANCE_PCT = 0.005;

const KEY_LEVEL_LOOKBACK_HOURS = 6; // gleiches Fenster wie LiquidationPanel/LeverageMapCard
const KEY_LEVEL_MAX_LIQUIDATION_CLUSTERS = 4;

export interface OhlcvCandle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchCandles(): Promise<OhlcvCandle[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, open, high, low, close, volume")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1h")
    .order("open_time", { ascending: false })
    .limit(CANDLE_LOOKBACK);

  if (error) {
    console.error("chartStructureContext: Fehler beim Laden der 1H-Kerzen:", error.message);
  }

  return (data ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      openTime: row.open_time as string,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
}

// --- Kerzenmuster -------------------------------------------------------
// TS-Port von research_detect_candlestick_patterns() (Postgres-Funktion,
// bislang nur Research/Backtest) -- dieselben Schwellenwerte, aber hier auf
// dem ohnehin schon geladenen, auf CANDLE_LOOKBACK begrenzten Kerzenfenster
// statt eines vollen Table-Scans ueber die komplette Historie (die DB-
// Funktion hat keinen Datums-Filter, waere fuer einen Live-Seitenaufruf zu
// teuer).

export interface CandlestickPatternEvent {
  candleOpenTime: string;
  patternName: string;
  direction: "BULLISH" | "BEARISH";
}

export function detectCandlestickPatterns(candles: OhlcvCandle[]): CandlestickPatternEvent[] {
  const events: CandlestickPatternEvent[] = [];
  const lb = CANDLESTICK_PRIOR_TREND_LOOKBACK;

  for (let i = 1; i < candles.length; i++) {
    const c0 = candles[i];
    const c1 = candles[i - 1];
    const c2 = i >= 2 ? candles[i - 2] : null;

    const range0 = c0.high - c0.low;
    const body0 = Math.abs(c0.close - c0.open);
    const upperWick0 = c0.high - Math.max(c0.open, c0.close);
    const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
    const body1 = Math.abs(c1.close - c1.open);

    let priorTrend: "up" | "down" | null = null;
    if (i - 1 - lb >= 0) {
      const close1Back = c1.close;
      const close6Back = candles[i - 1 - lb].close;
      if (close1Back < close6Back) priorTrend = "down";
      else if (close1Back > close6Back) priorTrend = "up";
    }

    if (range0 > 0 && body0 <= 0.1 * range0 && priorTrend !== null) {
      events.push({
        candleOpenTime: c0.openTime,
        patternName: "doji",
        direction: priorTrend === "down" ? "BULLISH" : "BEARISH",
      });
    }

    if (
      range0 > 0 &&
      body0 <= 0.3 * range0 &&
      lowerWick0 >= 2.0 * Math.max(body0, 0.0001) &&
      lowerWick0 >= 0.5 * range0 &&
      upperWick0 <= 0.15 * range0 &&
      priorTrend === "down"
    ) {
      events.push({ candleOpenTime: c0.openTime, patternName: "hammer", direction: "BULLISH" });
    }
    if (
      range0 > 0 &&
      body0 <= 0.3 * range0 &&
      lowerWick0 >= 2.0 * Math.max(body0, 0.0001) &&
      lowerWick0 >= 0.5 * range0 &&
      upperWick0 <= 0.15 * range0 &&
      priorTrend === "up"
    ) {
      events.push({ candleOpenTime: c0.openTime, patternName: "hanging_man", direction: "BEARISH" });
    }

    if (body0 > 0 && body1 > 0 && c1.close < c1.open && c0.close > c0.open && c0.open <= c1.close && c0.close >= c1.open) {
      events.push({ candleOpenTime: c0.openTime, patternName: "bullish_engulfing", direction: "BULLISH" });
    }
    if (body0 > 0 && body1 > 0 && c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open) {
      events.push({ candleOpenTime: c0.openTime, patternName: "bearish_engulfing", direction: "BEARISH" });
    }

    if (c2) {
      const range2 = c2.high - c2.low;
      const body2 = Math.abs(c2.close - c2.open);
      if (
        range2 > 0 &&
        c2.close < c2.open &&
        body2 >= 0.5 * range2 &&
        body1 <= 0.3 * range2 &&
        range0 > 0 &&
        c0.close > c0.open &&
        body0 >= 0.5 * range0 &&
        c0.close > (c2.open + c2.close) / 2
      ) {
        events.push({ candleOpenTime: c0.openTime, patternName: "morning_star", direction: "BULLISH" });
      }
      if (
        range2 > 0 &&
        c2.close > c2.open &&
        body2 >= 0.5 * range2 &&
        body1 <= 0.3 * range2 &&
        range0 > 0 &&
        c0.close < c0.open &&
        body0 >= 0.5 * range0 &&
        c0.close < (c2.open + c2.close) / 2
      ) {
        events.push({ candleOpenTime: c0.openTime, patternName: "evening_star", direction: "BEARISH" });
      }
    }
  }

  return events.slice(-CANDLESTICK_RECENT_EVENTS_LIMIT).reverse();
}

// --- AVWAP-Pivot ----------------------------------------------------------
// TS-Port von research-python/avwap_pivot_setup/avwap_engine.py, reduziert
// auf das fuer eine Live-Anzeige Notwendige: welche AVWAP-Pivot-Linien sind
// GERADE JETZT noch aktiv (nicht durch einen Schlusskurs-Durchbruch
// invalidiert)? Die Rejection-Signal-/Touch-Count-Logik des Originals
// (fuer den Backtest gebaut) wird hier bewusst weggelassen -- nur der
// Linien-Lebenszyklus (entstehen/wachsen/invalidieren) bleibt 1:1 erhalten,
// weil NUR der die aktuell gueltigen Linienwerte bestimmt.

export interface AvwapPivotLevel {
  anchorOpenTime: string;
  side: "resistance" | "support";
  value: number;
}

interface ActiveAvwapLine {
  anchorIdx: number;
  cumPv: number;
  cumV: number;
}

export function computeAvwapPivotLevels(candles: OhlcvCandle[]): AvwapPivotLevel[] {
  const n = candles.length;
  if (n < AVWAP_PIVOT_LENGTH * 2 + 1) return [];

  const closes = candles.map((c) => c.close);
  const typical = candles.map((c) => (c.high + c.low + c.close) / 3);
  const pv = typical.map((t, i) => t * candles[i].volume);

  // Pine-Lag: ein Pivot bei Index i wird erst bei i+PIVOT_LENGTH sichtbar
  // (symmetrisches Fenster), identisch zu avwap_engine.py.
  const pivots = findPivots(closes, AVWAP_PIVOT_LENGTH);
  const revealByIndex = new Map<number, ("high" | "low")[]>();
  for (const p of pivots) {
    const revealIdx = p.index + AVWAP_PIVOT_LENGTH;
    if (revealIdx >= n) continue;
    const arr = revealByIndex.get(revealIdx) ?? [];
    arr.push(p.kind);
    revealByIndex.set(revealIdx, arr);
  }

  let activeResistance: ActiveAvwapLine[] = [];
  let activeSupport: ActiveAvwapLine[] = [];

  for (let t = 0; t < n; t++) {
    const c = candles[t].close;

    for (const line of activeResistance) {
      line.cumPv += pv[t];
      line.cumV += candles[t].volume;
    }
    for (const line of activeSupport) {
      line.cumPv += pv[t];
      line.cumV += candles[t].volume;
    }

    activeResistance = activeResistance.filter((ln) => c <= ln.cumPv / ln.cumV);
    activeSupport = activeSupport.filter((ln) => c >= ln.cumPv / ln.cumV);

    const revealed = revealByIndex.get(t);
    if (revealed) {
      for (const kind of revealed) {
        const anchorIdx = t - AVWAP_PIVOT_LENGTH;
        let cumPv = 0;
        let cumV = 0;
        for (let k = anchorIdx; k <= t; k++) {
          cumPv += pv[k];
          cumV += candles[k].volume;
        }
        if (cumV <= 0) continue;
        const line: ActiveAvwapLine = { anchorIdx, cumPv, cumV };
        if (kind === "high") {
          activeResistance.push(line);
          activeResistance = activeResistance.slice(-AVWAP_MAX_ACTIVE_LINES_PER_SIDE);
        } else {
          activeSupport.push(line);
          activeSupport = activeSupport.slice(-AVWAP_MAX_ACTIVE_LINES_PER_SIDE);
        }
      }
    }
  }

  const toLevel = (ln: ActiveAvwapLine, side: AvwapPivotLevel["side"]): AvwapPivotLevel => ({
    anchorOpenTime: candles[ln.anchorIdx].openTime,
    side,
    value: ln.cumPv / ln.cumV,
  });

  return [
    ...activeResistance.map((ln) => toLevel(ln, "resistance")),
    ...activeSupport.map((ln) => toLevel(ln, "support")),
  ].sort((a, b) => b.value - a.value);
}

// --- Trendlinien (neu) ----------------------------------------------------
// Verbindet die zwei juengsten Swing-Tiefs (Aufwaertslinie) bzw. Swing-
// Hochs (Abwaertslinie) -- Salomons eigene Definition ("verbindet man die
// markanten Tiefpunkte/Hochpunkte"). Weitere Schwenkpunkte, die (innerhalb
// TRENDLINE_TOUCH_TOLERANCE_PCT) auf derselben verlaengerten Linie liegen,
// zaehlen als zusaetzliche Beruehrung; ab TRENDLINE_MIN_TOUCHES gilt die
// Linie als "confirmed" (Salomons Mindestwert), sonst wird sie trotzdem
// gezeigt, aber als unbestaetigt markiert -- nie stillschweigend verworfen.

export interface TrendlinePoint {
  openTime: string;
  value: number;
}

export interface TrendlineLevel {
  direction: "up" | "down";
  touchCount: number;
  confirmed: boolean;
  currentValue: number;
  points: TrendlinePoint[];
}

interface SwingPoint {
  index: number;
  value: number;
}

export function fitTrendline(
  points: SwingPoint[],
  direction: TrendlineLevel["direction"],
  candles: OhlcvCandle[]
): TrendlineLevel | null {
  if (points.length < 2) return null;
  const p1 = points[points.length - 2];
  const p2 = points[points.length - 1];
  if (p2.index === p1.index) return null;

  const slope = (p2.value - p1.value) / (p2.index - p1.index);
  const lineValueAt = (idx: number) => p1.value + slope * (idx - p1.index);

  let touchCount = 0;
  for (const pt of points) {
    const expected = lineValueAt(pt.index);
    if (expected <= 0) continue;
    if (Math.abs(pt.value - expected) / expected <= TRENDLINE_TOUCH_TOLERANCE_PCT) touchCount++;
  }

  return {
    direction,
    touchCount,
    confirmed: touchCount >= TRENDLINE_MIN_TOUCHES,
    currentValue: lineValueAt(candles.length - 1),
    points: [p1, p2].map((p) => ({ openTime: candles[p.index].openTime, value: p.value })),
  };
}

export function computeTrendlines(candles: OhlcvCandle[]): TrendlineLevel[] {
  if (candles.length < TRENDLINE_SWING_LOOKBACK * 2 + 1) return [];

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const swings = detectFractalSwings(highs, lows, TRENDLINE_SWING_LOOKBACK);

  const lowPoints: SwingPoint[] = [];
  const highPoints: SwingPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (swings.isSwingLow[i]) lowPoints.push({ index: i, value: lows[i] });
    if (swings.isSwingHigh[i]) highPoints.push({ index: i, value: highs[i] });
  }

  const results: TrendlineLevel[] = [];
  const up = fitTrendline(lowPoints, "up", candles);
  if (up) results.push(up);
  const down = fitTrendline(highPoints, "down", candles);
  if (down) results.push(down);
  return results;
}

// --- Key Levels (Liquidations-Cluster) -------------------------------------
// Bewusst NUR Liquidations-Cluster -- Fibonacci-Retracement steht bereits in
// VwapVectorCard direkt oberhalb auf derselben Seite (keine Dopplung).

export interface KeyLevel {
  price: number;
  label: string;
  eventCount: number;
}

async function computeKeyLevels(): Promise<KeyLevel[]> {
  const since = new Date(Date.now() - KEY_LEVEL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_liquidation_intelligence", {
    p_since: since,
    p_bucket_minutes: 15,
    p_price_bucket_usd: 200,
  });

  if (error) {
    console.error("chartStructureContext: Fehler bei get_liquidation_intelligence:", error.message);
    return [];
  }

  const clusters =
    ((data as Record<string, unknown> | null)?.price_clusters as
      | { price_bucket: number; notional_usd: number; event_count: number }[]
      | undefined) ?? [];

  return clusters
    .slice()
    .sort((a, b) => b.notional_usd - a.notional_usd)
    .slice(0, KEY_LEVEL_MAX_LIQUIDATION_CLUSTERS)
    .map((c) => ({
      price: c.price_bucket,
      label: `Liquidations-Cluster (${KEY_LEVEL_LOOKBACK_HOURS}h)`,
      eventCount: c.event_count,
    }))
    .sort((a, b) => b.price - a.price);
}

// --- Kombinierter Einstiegspunkt -------------------------------------------

export interface ChartStructureData {
  interval: "1h";
  candlestickPatterns: CandlestickPatternEvent[];
  avwapPivotLevels: AvwapPivotLevel[];
  trendlines: TrendlineLevel[];
  keyLevels: KeyLevel[];
  currentPrice: number | null;
  dataAsOf: string | null;
}

export async function getChartStructureData(): Promise<ChartStructureData> {
  const [candles, keyLevels] = await Promise.all([fetchCandles(), computeKeyLevels()]);
  const lastCandle = candles[candles.length - 1] ?? null;

  return {
    interval: "1h",
    candlestickPatterns: detectCandlestickPatterns(candles),
    avwapPivotLevels: computeAvwapPivotLevels(candles),
    trendlines: computeTrendlines(candles),
    keyLevels,
    currentPrice: lastCandle?.close ?? null,
    dataAsOf: lastCandle?.openTime ?? null,
  };
}
