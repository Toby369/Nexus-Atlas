import { supabase } from "./supabase";
import { detectFractalSwings, emaSeries, type FractalSwingResult } from "./swingDetection";
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

interface Candle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
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

export async function getGussSignalData(): Promise<GussSignalData> {
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
    console.error("tradingIndicatorsContext: Fehler beim Laden der Kerzen fuer GUSS:", candleError.message);
  }
  if (regimeError) {
    console.error("tradingIndicatorsContext: Fehler beim Laden des Regimes fuer GUSS:", regimeError.message);
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
