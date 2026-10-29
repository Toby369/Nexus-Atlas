import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 6 Market-Intelligence-Engine: Market-State-Engine.
//
// Kombiniert vierzehn unabhaengige Faktoren aus den bereits bestehenden
// Datenquellen (Struktur, Momentum, CVD, OI-vs-Preis, Positioning,
// Orderbook, Options, Makro, Funding, Fear & Greed Index, Trend-Staerke
// (ADX), Trend-Regime (EMA50/EMA200), VWAP-Position, Basis/Perpetual-
// Premium) zu einem Gesamtzustand (BULLISH/BEARISH/NEUTRAL/MIXED/
// INSUFFICIENT_DATA) mit nachvollziehbarer Confidence, Data-Coverage und
// Risk (siehe Risk-Abschnitt unten).
//
// KEIN Black-Box-Score: jeder Faktor wird einzeln als -1/0/+1 klassifiziert
// und mitsamt seiner Rohbasis in "factors" gespeichert -- die Herleitung
// jeder Einordnung ist im Nachhinein pruefbar. Fehlt ein Faktor (Datenquelle
// nicht verfuegbar/zu alt), zaehlt er als "keine Daten", nicht als neutral --
// das senkt die data_coverage_pct und damit die Confidence, statt eine
// luecke zu verschleiern.
//
// Alle Schwellenwerte sind benannte Konstanten (spaeter per Backtesting
// justierbar). "Patterns" sind vorsichtig formulierte Markt-State-
// Interpretationen (Spec-Vorgabe), keine Handelssignale.

const SYMBOL = "BTCUSDT";
const INTERVAL = "1h";

// Wie alt eine Datenquelle hoechstens sein darf, um noch als "verfuegbar"
// zu zaehlen (sonst: keine Daten statt veralteter Wert).
const MAX_AGE_MS = {
  marketFeatures: 3 * 60 * 60 * 1000, // 1H-Kerzen: bis zu 3h alt tolerieren
  positioning: 30 * 60 * 1000,
  orderbook: 30 * 60 * 1000,
  options: 2 * 60 * 60 * 1000,
  sentiment: 3 * 60 * 60 * 1000, // collect-sentiment laeuft stuendlich
};

const RSI_BULL_THRESHOLD = 55;
const RSI_BEAR_THRESHOLD = 45;
const OI_DELTA_1H_THRESHOLD_PCT = 0.3;
const POSITIONING_SCORE_THRESHOLD = 10;
const IMBALANCE_THRESHOLD = 0.08;
const PUT_CALL_LOW = 0.7;
const PUT_CALL_HIGH = 1.1;
// Gleicher Schwellenwert wie describeFunding() in collect-btc ("deutlich
// positiv/negativ") -- keine doppelte Kalibrierung. Ueberhitzte Longs
// (stark positive Funding) sind ein Crowding-Risiko -> Faktor bewusst
// KONTRAER gewertet (bearisch), und umgekehrt fuer stark negative Funding.
const FUNDING_EXTREME_THRESHOLD = 0.0005;

// ADX < 20 gilt (Wilder-Konvention) als "kein/schwacher Trend" -- die
// Richtungs-DIs sind in dieser Phase unzuverlaessig und werden bewusst
// nicht gewertet (neutral statt erratischem Richtungswechsel bei Rauschen).
const ADX_TREND_THRESHOLD = 20;

// Neutralband um VWAP (in %), um Rauschen bei Preis ~= VWAP nicht als
// Richtungssignal zu werten.
const VWAP_NEUTRAL_BAND_PCT = 0.15;

// Erste Kalibrierung anhand der bisher beobachteten Basis (~-0.03 bis
// -0.06% unter Normalbedingungen) -- deutlich groesser als das Alltags-
// rauschen, aber unterhalb historischer Extremwerte. Wie alle Schwellen
// spaeter per Backtesting nachjustierbar, sobald mehr Historie vorliegt.
// Kontraer gewertet wie Funding: hohe positive Perpetual-Praemie = Crowding-
// Risiko auf der Long-Seite.
const BASIS_EXTREME_THRESHOLD_PCT = 0.15;

const SCORE_BULLISH_THRESHOLD = 3;
const SCORE_BEARISH_THRESHOLD = -3;
const MIN_COVERAGE_PCT = 40;

// Pattern-Schwellenwerte
const DISTRIBUTION_PROXIMITY_PCT = 0.5; // Fallback in % falls kein ATR verfuegbar
// ATR-relative Naehe zum Range-High (Spec-Vorgabe: keine willkuerlichen
// ATR-unabhaengigen %-Schwellen). 0.5x ATR ist ein erster, dokumentierter
// Wert -- spaeter per Backtesting justierbar.
const DISTRIBUTION_PROXIMITY_ATR_MULT = 0.5;
const RSI_OVERSOLD = 30;
const CAPITULATION_LIQ_VS_OI_PCT = 0.03;

// MTF-Alignment: Gewichtung je Zeitrahmen -- bewusst NICHT gleichgewichtet
// (Spec-Vorgabe), hoehere Zeitrahmen zaehlen staerker, da ihre Struktur
// langlebiger/aussagekraeftiger ist als die des 1H-Rahmens.
const MTF_WEIGHTS: Record<string, number> = { "1h": 0.2, "4h": 0.35, "1d": 0.45 };
const MTF_MAX_AGE_MS: Record<string, number> = {
  "1h": 3 * 60 * 60 * 1000,
  "4h": 8 * 60 * 60 * 1000,
  "1d": 36 * 60 * 60 * 1000,
};

// --- Risk-Schwellenwerte ---------------------------------------------------
// Risk ist bewusst von Confidence getrennt (Spec-Vorgabe: State/Confidence/
// Data Coverage/RISK). Confidence misst, wie einig sich die VERFUEGBAREN
// Faktoren sind. Risk misst, wie fragil/gefaehrlich die aktuelle Lage ist --
// unabhaengig von der Richtung des Zustands. Ausschliesslich aus bereits
// vorhandenen, live berechneten Werten (keine neue Datenquelle):
//   - Warnende Patterns (Fragile Bullish/Distribution Warning/Capitulation/
//     Short Squeeze) -- Divergenzen bzw. gehaeufte Squeeze-Gefahr.
//   - Niedriges MTF-Alignment -- Zeitrahmen sind uneins, erhoehte
//     Umkehr-/Chop-Gefahr.
//   - Extreme Funding/Basis (dieselben Schwellen wie die jeweiligen
//     Faktoren oben) -- Crowding = Liquidations-/Squeeze-Risiko.
//   - Erhoehte Volatilitaet: ATR relativ zum Preis ueber dem beobachteten
//     P90 (kalibriert an n=260 1H-Kerzen, 26.08.2026: Median 0.67%,
//     P90 1.04%) -- spaeter per Backtesting/laufender Neuberechnung
//     nachjustierbar.
const ATR_ELEVATED_PCT_THRESHOLD = 1.0;
const MTF_LOW_ALIGNMENT_THRESHOLD = 60;
const RISK_ELEVATING_PATTERNS = new Set(["Fragile Bullish", "Distribution Warning", "Capitulation", "Short Squeeze"]);
const RISK_HIGH_FACTOR_COUNT = 3;

type FactorValue = -1 | 0 | 1;
interface Factor {
  name: string;
  value: FactorValue | null; // null = keine Daten
  basis: Record<string, unknown>;
}

const INTERVAL_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function isFresh(timestampIso: string | null | undefined, maxAgeMs: number): boolean {
  if (!timestampIso) return false;
  const ageMs = Date.now() - new Date(timestampIso).getTime();
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

// market_features.candle_open_time ist der OEFFNUNGS-Zeitpunkt der Kerze --
// bei laengeren Intervallen (v.a. 1D) ist der damit immer "Intervalllaenge
// + seit Schluss vergangene Zeit" alt, auch fuer die aktuellste verfuegbare
// Kerze. isFresh() muss deshalb gegen den SCHLUSS-Zeitpunkt pruefen
// (open_time + Intervalllaenge), sonst faellt z.B. die 1D-Kerze fast staendig
// faelschlich aus der Frische-Pruefung.
function isFreshCandle(candleOpenTimeIso: string | null | undefined, interval: string, maxAgeMs: number): boolean {
  if (!candleOpenTimeIso) return false;
  const closeTimeMs = new Date(candleOpenTimeIso).getTime() + (INTERVAL_MS[interval] ?? 0);
  const ageMs = Date.now() - closeTimeMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();
  const factors: Factor[] = [];
  const patterns: { name: string; note: string }[] = [];

  // --- 1) Market Features (1H): Struktur, Momentum, CVD, OI-vs-Preis -----
  const { data: mfRows } = await supabase
    .from("market_features")
    .select("*")
    .eq("symbol", SYMBOL)
    .eq("interval", INTERVAL)
    .order("candle_open_time", { ascending: false })
    .limit(1);
  const mf = mfRows?.[0] ?? null;
  const mfFresh = mf && isFreshCandle(mf.candle_open_time, INTERVAL, MAX_AGE_MS.marketFeatures);

  // Faktor 1: Struktur
  factors.push({
    name: "structure",
    value: mfFresh ? (mf.structure_trend === "bullish" ? 1 : mf.structure_trend === "bearish" ? -1 : 0) : null,
    basis: mfFresh ? { structure_trend: mf.structure_trend, bos: mf.bos, choch: mf.choch } : {},
  });

  // Faktor 2: Momentum (RSI + MACD-Histogramm muessen uebereinstimmen)
  let momentum: FactorValue | null = null;
  if (mfFresh && mf.rsi_14 !== null && mf.macd_histogram !== null) {
    if (mf.rsi_14 > RSI_BULL_THRESHOLD && mf.macd_histogram > 0) momentum = 1;
    else if (mf.rsi_14 < RSI_BEAR_THRESHOLD && mf.macd_histogram < 0) momentum = -1;
    else momentum = 0;
  }
  factors.push({
    name: "momentum",
    value: momentum,
    basis: mfFresh ? { rsi_14: mf.rsi_14, macd_histogram: mf.macd_histogram } : {},
  });

  // Faktor 3: Futures-CVD-Trend
  factors.push({
    name: "cvd",
    value: mfFresh ? (mf.cvd_trend === "rising" ? 1 : mf.cvd_trend === "falling" ? -1 : 0) : null,
    basis: mfFresh ? { cvd_trend: mf.cvd_trend, cvd_delta: mf.cvd_delta } : {},
  });

  // Faktor 4: OI-Delta in Preisrichtung (frischer Positionsaufbau
  // bestaetigt die Bewegung; ohne EMA20-Referenz kein Signal). Zeigt
  // oi_volume_ratio zusaetzlich in der Basis (falls vorhanden) -- wie
  // "echt" der OI-Aufbau relativ zum Handelsvolumen ist, ohne dass diese
  // Kennzahl selbst eine Richtung hat (kein eigener Faktor).
  let oiPrice: FactorValue | null = null;
  if (mfFresh && mf.oi_delta_pct !== null && mf.close_price !== null && mf.ema_20 !== null) {
    const priceAboveEma = mf.close_price > mf.ema_20;
    if (Math.abs(mf.oi_delta_pct) > OI_DELTA_1H_THRESHOLD_PCT) {
      oiPrice = priceAboveEma ? 1 : -1;
    } else {
      oiPrice = 0;
    }
  }
  factors.push({
    name: "oi_price",
    value: oiPrice,
    basis: mfFresh
      ? {
          oi_delta_pct: mf.oi_delta_pct,
          close_price: mf.close_price,
          ema_20: mf.ema_20,
          oi_volume_ratio: mf.oi_volume_ratio,
        }
      : {},
  });

  // --- 2) Positioning Signal (Divergence Engine) --------------------------
  const { data: posRows } = await supabase
    .from("positioning_signals")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1);
  const pos = posRows?.[0] ?? null;
  const posFresh = pos && isFresh(pos.timestamp_utc, MAX_AGE_MS.positioning);
  factors.push({
    name: "positioning",
    value: posFresh
      ? pos.score > POSITIONING_SCORE_THRESHOLD
        ? 1
        : pos.score < -POSITIONING_SCORE_THRESHOLD
          ? -1
          : 0
      : null,
    basis: posFresh ? { score: pos.score, confidence: pos.confidence } : {},
  });

  // --- 3) Orderbook-Imbalance (Mittel ueber verfuegbare Boersen) ----------
  const { data: obRows } = await supabase
    .from("orderbook_snapshots")
    .select("*")
    .eq("symbol", SYMBOL)
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(9); // letzte ~3 Ticks x 3 Boersen als Sicherheitsmarge
  const latestObTimestamp = obRows?.[0]?.timestamp_utc ?? null;
  const obFresh = latestObTimestamp && isFresh(latestObTimestamp, MAX_AGE_MS.orderbook);
  const obLatestTick = obFresh ? (obRows ?? []).filter((r) => r.timestamp_utc === latestObTimestamp) : [];
  const obImbalances = obLatestTick.map((r) => r.depth_imbalance).filter((v): v is number => v !== null);
  const avgImbalance = obImbalances.length > 0 ? obImbalances.reduce((a, b) => a + b, 0) / obImbalances.length : null;
  factors.push({
    name: "orderbook",
    value:
      avgImbalance === null
        ? null
        : avgImbalance > IMBALANCE_THRESHOLD
          ? 1
          : avgImbalance < -IMBALANCE_THRESHOLD
            ? -1
            : 0,
    basis: avgImbalance !== null ? { avg_depth_imbalance: avgImbalance, exchange_count: obImbalances.length } : {},
  });

  // --- 4) Options (Put/Call-OI-Verhaeltnis) -------------------------------
  const { data: optRows } = await supabase
    .from("options_snapshots")
    .select("*")
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(1);
  const opt = optRows?.[0] ?? null;
  const optFresh = opt && isFresh(opt.timestamp_utc, MAX_AGE_MS.options);
  // IV Rank fliesst NICHT in die Faktor-Wertung ein (options_snapshots hat
  // noch keine ausreichende Historie fuer einen aussagekraeftigen Rank --
  // siehe get_options_iv_rank), wird aber transparent in der Basis
  // mitgefuehrt, sobald genug Historie vorliegt (aktiviert sich von selbst).
  const { data: ivRank } = await supabase.rpc("get_options_iv_rank");
  factors.push({
    name: "options",
    value:
      optFresh && opt.put_call_oi_ratio !== null
        ? opt.put_call_oi_ratio < PUT_CALL_LOW
          ? 1
          : opt.put_call_oi_ratio > PUT_CALL_HIGH
            ? -1
            : 0
        : null,
    basis: optFresh
      ? {
          put_call_oi_ratio: opt.put_call_oi_ratio,
          skew_proxy: opt.skew_proxy,
          iv_rank: ivRank?.iv_rank ?? null,
          iv_rank_status: ivRank?.status ?? null,
        }
      : {},
  });

  // --- MTF-Alignment (1H/4H/1D, gewichtet) --------------------------------
  // Eigener, separater Wert -- kein Bias-Faktor, sondern eine Aussage
  // darueber, WIE EINIG sich die Struktur ueber mehrere Zeitrahmen ist.
  // Je Zeitrahmen einzeln abgefragt (statt eines gemeinsamen Limits) --
  // sonst koennte der seltener aktualisierte 1D-Wert bei einem gemeinsamen
  // Limit von den viel haeufigeren 1H-Zeilen verdraengt werden.
  const mtfByInterval = new Map<string, { candle_open_time: string; structure_trend: string | null }>();
  for (const interval of Object.keys(MTF_WEIGHTS)) {
    const { data: rows } = await supabase
      .from("market_features")
      .select("candle_open_time, structure_trend")
      .eq("symbol", SYMBOL)
      .eq("interval", interval)
      .order("candle_open_time", { ascending: false })
      .limit(1);
    if (rows?.[0]) mtfByInterval.set(interval, rows[0]);
  }
  const mtfEntries: { interval: string; direction: FactorValue; weight: number }[] = [];
  for (const [interval, weight] of Object.entries(MTF_WEIGHTS)) {
    const row = mtfByInterval.get(interval);
    if (row && isFreshCandle(row.candle_open_time, interval, MTF_MAX_AGE_MS[interval])) {
      const direction: FactorValue = row.structure_trend === "bullish" ? 1 : row.structure_trend === "bearish" ? -1 : 0;
      mtfEntries.push({ interval, direction, weight });
    }
  }
  let mtfAlignment: Record<string, unknown> | null = null;
  if (mtfEntries.length > 0) {
    const totalWeight = mtfEntries.reduce((s, e) => s + e.weight, 0);
    const weightedSum = mtfEntries.reduce((s, e) => s + e.direction * e.weight, 0);
    const dominantDirection: FactorValue = weightedSum > 0 ? 1 : weightedSum < 0 ? -1 : 0;
    const agreeingWeight = mtfEntries
      .filter((e) => e.direction === dominantDirection)
      .reduce((s, e) => s + e.weight, 0);
    mtfAlignment = {
      alignment_pct: Math.round((agreeingWeight / totalWeight) * 1000) / 10,
      dominant_direction: dominantDirection === 1 ? "bullish" : dominantDirection === -1 ? "bearish" : "ranging",
      timeframes: Object.fromEntries(mtfEntries.map((e) => [e.interval, e.direction])),
      timeframe_count: mtfEntries.length,
    };
  }

  // --- 5) Makro-Regime -----------------------------------------------------
  const { data: macroRegime } = await supabase.rpc("get_macro_regime");
  const regime = macroRegime?.regime ?? null;
  factors.push({
    name: "macro",
    value: regime === "Risk-On" ? 1 : regime === "Risk-Off" ? -1 : regime ? 0 : null,
    basis: regime ? { regime, risk_on_count: macroRegime.risk_on_count, risk_off_count: macroRegime.risk_off_count } : {},
  });

  // --- 6) Funding (cross-exchange Durchschnitt, extreme Werte gelten als
  // Crowding-Risiko und werden bewusst KONTRAER gewertet) ------------------
  const { data: fundingIntel } = await supabase.rpc("get_funding_intelligence", { p_lookback_hours: 24 });
  const avgFundingRate = fundingIntel?.avg_current_rate ?? null;
  factors.push({
    name: "funding",
    value:
      avgFundingRate === null
        ? null
        : avgFundingRate > FUNDING_EXTREME_THRESHOLD
          ? -1
          : avgFundingRate < -FUNDING_EXTREME_THRESHOLD
            ? 1
            : 0,
    basis:
      avgFundingRate !== null
        ? {
            avg_current_rate: avgFundingRate,
            avg_delta: fundingIntel?.avg_delta ?? null,
            cross_exchange_spread: fundingIntel?.cross_exchange_spread ?? null,
            exchange_count: fundingIntel?.exchange_count ?? null,
          }
        : {},
  });

  // --- 7) Fear & Greed Index (alternative.me, taeglich, KONTRAER gewertet --
  // extreme Angst gilt als potenzieller Boden, extreme Gier als potenzielle
  // Spitze). Nutzt die von der API selbst gelieferte Klassifikation statt
  // eigene Zahlen-Buckets zu erfinden -- weniger Kalibrierungsaufwand, und
  // "Extreme Fear"/"Extreme Greed" ist eine etablierte, oeffentlich
  // dokumentierte Grenze dieses Index.
  const { data: sentRows } = await supabase
    .from("sentiment_snapshots")
    .select("*")
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(1);
  const sent = sentRows?.[0] ?? null;
  const sentFresh = sent && isFresh(sent.timestamp_utc, MAX_AGE_MS.sentiment);
  factors.push({
    name: "sentiment",
    value: sentFresh
      ? sent.classification === "Extreme Fear"
        ? 1
        : sent.classification === "Extreme Greed"
          ? -1
          : 0
      : null,
    basis: sentFresh ? { value: sent.value, classification: sent.classification } : {},
  });

  // --- 8) Trend-Staerke (ADX + Richtungs-DIs) -----------------------------
  // ADX misst nur die STAERKE eines Trends, keine Richtung -- die Richtung
  // kommt aus dem Vergleich +DI vs. -DI. Unterhalb ADX_TREND_THRESHOLD gilt
  // der Markt als nicht eindeutig trendend; der DI-Vergleich waere dort
  // unzuverlaessig (Rauschen), daher bewusst neutral statt einer erratischen
  // Richtung. Eigenstaendiger Blickwinkel gegenueber "structure" (swing-
  // basiert) und "momentum" (RSI/MACD) -- ein drittes, unabhaengiges Mass.
  let trendStrength: FactorValue | null = null;
  if (mfFresh && mf.adx_14 !== null && mf.plus_di !== null && mf.minus_di !== null) {
    if (mf.adx_14 < ADX_TREND_THRESHOLD) trendStrength = 0;
    else if (mf.plus_di > mf.minus_di) trendStrength = 1;
    else if (mf.minus_di > mf.plus_di) trendStrength = -1;
    else trendStrength = 0;
  }
  factors.push({
    name: "trend_strength",
    value: trendStrength,
    basis: mfFresh ? { adx_14: mf.adx_14, plus_di: mf.plus_di, minus_di: mf.minus_di } : {},
  });

  // --- 9) Trend-Regime (EMA50/EMA200-Ribbon) ------------------------------
  // Klassische Trendregime-Pruefung ueber mittel-/langfristige gleitende
  // Durchschnitte: bullisch nur, wenn Preis UND EMA50 UND EMA200 in
  // derselben Reihenfolge ausgerichtet sind (kein einzelner Crossover).
  // Eigenstaendig von "structure" (kurzfristige Swing-Struktur, EMA20) --
  // deckt die mittel-/langfristige Tendenz ab.
  let trendRegime: FactorValue | null = null;
  if (mfFresh && mf.close_price !== null && mf.ema_50 !== null && mf.ema_200 !== null) {
    if (mf.close_price > mf.ema_50 && mf.ema_50 > mf.ema_200) trendRegime = 1;
    else if (mf.close_price < mf.ema_50 && mf.ema_50 < mf.ema_200) trendRegime = -1;
    else trendRegime = 0;
  }
  factors.push({
    name: "trend_regime",
    value: trendRegime,
    basis: mfFresh ? { close_price: mf.close_price, ema_50: mf.ema_50, ema_200: mf.ema_200 } : {},
  });

  // --- 10) VWAP-Position ---------------------------------------------------
  let vwapPosition: FactorValue | null = null;
  let vwapPctDiff: number | null = null;
  if (mfFresh && mf.vwap !== null && mf.close_price !== null && mf.vwap !== 0) {
    vwapPctDiff = ((mf.close_price - mf.vwap) / mf.vwap) * 100;
    if (vwapPctDiff > VWAP_NEUTRAL_BAND_PCT) vwapPosition = 1;
    else if (vwapPctDiff < -VWAP_NEUTRAL_BAND_PCT) vwapPosition = -1;
    else vwapPosition = 0;
  }
  factors.push({
    name: "vwap_position",
    value: vwapPosition,
    basis: mfFresh ? { close_price: mf.close_price, vwap: mf.vwap, pct_diff: vwapPctDiff } : {},
  });

  // --- 11) Basis / Perpetual Premium (KONTRAER gewertet wie Funding -------
  // hohe positive Praemie = Long-Crowding-Risiko, hohe negative Praemie =
  // Short-Crowding-Risiko).
  let basisFactor: FactorValue | null = null;
  if (mfFresh && mf.basis_pct !== null) {
    if (mf.basis_pct > BASIS_EXTREME_THRESHOLD_PCT) basisFactor = -1;
    else if (mf.basis_pct < -BASIS_EXTREME_THRESHOLD_PCT) basisFactor = 1;
    else basisFactor = 0;
  }
  factors.push({
    name: "basis",
    value: basisFactor,
    basis: mfFresh ? { basis_pct: mf.basis_pct, spot_price: mf.spot_price, close_price: mf.close_price } : {},
  });

  // --- Aggregation -----------------------------------------------------
  const withData = factors.filter((f) => f.value !== null) as (Factor & { value: FactorValue })[];
  const dataCoveragePct = (withData.length / factors.length) * 100;
  const score = withData.reduce((sum, f) => sum + f.value, 0);

  let overallState: string;
  let confidence: number;
  const insufficientData = dataCoveragePct < MIN_COVERAGE_PCT || withData.length === 0;

  if (insufficientData) {
    overallState = "INSUFFICIENT_DATA";
    confidence = 0;
  } else {
    const positiveCount = withData.filter((f) => f.value === 1).length;
    const negativeCount = withData.filter((f) => f.value === -1).length;
    if (score >= SCORE_BULLISH_THRESHOLD) overallState = "BULLISH";
    else if (score <= SCORE_BEARISH_THRESHOLD) overallState = "BEARISH";
    else if (positiveCount > 0 && negativeCount > 0) overallState = "MIXED";
    else overallState = "NEUTRAL";

    // Confidence = Coverage x Einigkeit der Faktoren (|Score| relativ zur
    // Anzahl verfuegbarer Faktoren) -- ein Score von 0 aus lauter neutralen
    // Faktoren ergibt bewusst niedrige Confidence, kein erfundenes Vertrauen.
    const agreementRatio = Math.abs(score) / withData.length;
    confidence = Math.round((dataCoveragePct / 100) * agreementRatio * 100);
  }

  // --- Pattern-Erkennung (Interpretationshilfen, keine Signale) ---------
  if (mfFresh) {
    const structureFactor = factors.find((f) => f.name === "structure")?.value;
    const cvdFactor = factors.find((f) => f.name === "cvd")?.value;
    const oiPriceFactor = factors.find((f) => f.name === "oi_price")?.value;

    if (structureFactor === 1 && cvdFactor === 1 && oiPriceFactor === 1) {
      patterns.push({
        name: "Bullish Confirmation",
        note: "Struktur, Orderflow (CVD) und frischer Positionsaufbau zeigen uebereinstimmend nach oben.",
      });
    }
    if (structureFactor === 1 && cvdFactor === -1) {
      patterns.push({
        name: "Fragile Bullish",
        note: "Preis-Struktur bullisch, aber der Orderflow (CVD) bestaetigt das nicht -- moegliche Divergenz.",
      });
    }
    const nearRangeHigh =
      mf.close_price !== null && mf.range_high_20 !== null
        ? mf.atr_14 !== null
          ? mf.range_high_20 - mf.close_price < DISTRIBUTION_PROXIMITY_ATR_MULT * mf.atr_14
          : mf.range_high_20 > 0 &&
            ((mf.range_high_20 - mf.close_price) / mf.range_high_20) * 100 < DISTRIBUTION_PROXIMITY_PCT
        : false;
    if (nearRangeHigh && cvdFactor === -1) {
      patterns.push({
        name: "Distribution Warning",
        note: "Preis nahe am 20-Perioden-Hoch, aber Orderflow (CVD) faellt -- moegliche Verteilung in die Staerke.",
      });
    }
    if (
      mf.rsi_14 !== null &&
      mf.rsi_14 < RSI_OVERSOLD &&
      cvdFactor === -1
    ) {
      // Liquidations-vs-OI-Anteil optional dazuziehen, falls verfuegbar.
      const { data: liqIntel } = await supabase.rpc("get_liquidation_intelligence", {
        p_since: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        p_bucket_minutes: 15,
        p_price_bucket_usd: 200,
      });
      const liqVsOiPct =
        liqIntel?.total_oi_usd && liqIntel.total_oi_usd > 0
          ? (liqIntel.total_notional_usd / liqIntel.total_oi_usd) * 100
          : null;
      if (liqVsOiPct !== null && liqVsOiPct > CAPITULATION_LIQ_VS_OI_PCT) {
        patterns.push({
          name: "Capitulation",
          note: "RSI ueberverkauft, fallender Orderflow und ueberdurchschnittliche Liquidationen relativ zum Open Interest.",
        });
      }
    }
    if (pos?.explanation?.includes("Short-Squeeze")) {
      patterns.push({
        name: "Short Squeeze",
        note: "Die Positioning-Divergence-Engine deutet auf ein moegliches Short-Squeeze-Setup hin (Retail short, Top Trader long, OI steigend).",
      });
    }
  }

  // --- Risk-Level ----------------------------------------------------------
  // Siehe Konstanten-Kommentar oben. UNKNOWN statt erfundenem Wert, wenn
  // schon der Gesamtzustand als INSUFFICIENT_DATA gilt -- dieselbe
  // Philosophie wie bei den einzelnen Faktoren (keine Daten != neutral).
  let riskLevel: string;
  const riskFactorNames: string[] = [];
  if (insufficientData) {
    riskLevel = "UNKNOWN";
  } else {
    if (patterns.some((p) => RISK_ELEVATING_PATTERNS.has(p.name))) {
      riskFactorNames.push("warning_pattern");
    }
    if (
      mtfAlignment !== null &&
      typeof mtfAlignment.alignment_pct === "number" &&
      mtfAlignment.alignment_pct < MTF_LOW_ALIGNMENT_THRESHOLD
    ) {
      riskFactorNames.push("low_mtf_alignment");
    }
    if (avgFundingRate !== null && Math.abs(avgFundingRate) > FUNDING_EXTREME_THRESHOLD) {
      riskFactorNames.push("funding_crowding");
    }
    if (mfFresh && mf.basis_pct !== null && Math.abs(mf.basis_pct) > BASIS_EXTREME_THRESHOLD_PCT) {
      riskFactorNames.push("basis_crowding");
    }
    if (mfFresh && mf.atr_14 !== null && mf.close_price !== null && mf.close_price !== 0) {
      const atrPct = (mf.atr_14 / mf.close_price) * 100;
      if (atrPct > ATR_ELEVATED_PCT_THRESHOLD) riskFactorNames.push("elevated_volatility");
    }
    riskLevel = riskFactorNames.length >= RISK_HIGH_FACTOR_COUNT ? "HIGH" : riskFactorNames.length >= 1 ? "MEDIUM" : "LOW";
  }

  const { error: insertError } = await supabase.from("market_states").insert({
    timestamp_utc: now,
    overall_state: overallState,
    score,
    confidence,
    data_coverage_pct: Math.round(dataCoveragePct * 10) / 10,
    factors: Object.fromEntries(factors.map((f) => [f.name, { value: f.value, basis: f.basis }])),
    patterns,
    mtf_alignment: mtfAlignment,
    risk_level: riskLevel,
    risk_factors: riskFactorNames,
  });

  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      overallState,
      score,
      confidence,
      dataCoveragePct,
      patterns,
      mtfAlignment,
      riskLevel,
      riskFactorNames,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
