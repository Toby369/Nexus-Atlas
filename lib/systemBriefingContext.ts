import { supabase } from "./supabase";
import { computeConfidenceBreakdown } from "./marketStateSummary";
import { getMeinSystemChecklistData, type MeinSystemChecklistData } from "./meinSystemContext";
import { getTradingIndicatorsData, type TradingIndicatorsData } from "./tradingIndicatorsContext";
import { getKnowledgeBase } from "./knowledgeBaseContext";
import { DEFAULT_TIMEFRAME, getTimeframe } from "./timeframes";
import { deriveMarketContext } from "./marketContext";
import {
  getChartStructureData,
  withConfirmationLevels,
  type ChartStructureData,
  type KeyLevel,
} from "./chartStructureContext";
import { getLevelStructureData, type LevelStructureZone } from "./levelStructureContext";
import type {
  MarketState,
  LiquidationIntelligence,
  EtfFlowDay,
  NewsEvent,
  EconomicCalendarEvent,
  DashboardPollBundle,
  SystemBriefingTrigger,
} from "./types";

// Kontext-Builder fuer das System-Briefing: fusioniert Tobys eigenes
// Regelwerk (knowledge_base) + Nexus' bereits berechnete Faktoren
// (14-Faktoren-Engine, GUSS/VWAP-Vector/CVD, Liquidations-Cluster,
// Marktkontext, ETF-Flows, Positionierung, News, Bewegungsvorrat,
// Chart-Struktur) zu EINEM Kontext -- mehrere kleine getX()-Funktionen, EIN
// Promise.all. KEIN zweiter Rechenweg: jede Quelle ist bestehender Code.
//
// Salomon-Phase und Regime Matrix sind bewusst KEINE Quellen (stehen in der
// Marktphase-Kachel, waeren hier nur eine zweite Beschreibung derselben
// Faktoren). market_state bleibt, da mein_system_checklist/Regelwerk-Gates
// darauf aufbauen. chart_structure wird mit EMA13/50/200 + VWAP-Vector-
// Konfluenz angereichert, ohne zweiten Fetch.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_BUCKET_MINUTES = 15;
// Dieselbe Kalibrierung wie components/LiquidationPanel.tsx -- keine zweite,
// abweichende Definition derselben Kennzahl.
const LIQUIDATION_PRICE_BUCKET_USD = 200;
const TOP_CLUSTERS_COUNT = 4;

// Marktkontext/ETF-Flows/Positionierung/News -- Lookback-Konstanten.
const CUMULATIVE_ETF_DAYS = 5;
const ETF_FLOW_LIMIT = 10;
const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LIMIT = 5;
const DASHBOARD_BUNDLE_MAX_POINTS = 500;

// Bewegungsvorrat: die heutige Tagesspanne relativ zum MEDIAN (nicht
// Mittelwert, ein Crash-Tag soll den Massstab nicht verzerren) der letzten 10
// abgeschlossenen Tage. Ein Markt, der bereits 200% seines ueblichen
// Tagespensums bewegt hat, ist kein guter Fortsetzungskandidat.
const BEWEGUNGSVORRAT_SYMBOL = "BTCUSDT";
const BEWEGUNGSVORRAT_EXCHANGE = "binance";
const BEWEGUNGSVORRAT_LOOKBACK_DAYS = 10;

async function getLatestMarketState(): Promise<MarketState | null> {
  const { data } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// Identische Dedupe-Logik wie getRecentEtfFlows() in app/page.tsx (SoSoValue
// bevorzugt vor der aelteren Farside-Historie bei gleichem Datum).
function dedupeEtfByDate(rows: EtfFlowDay[], limit: number): EtfFlowDay[] {
  const byDate = new Map<string, EtfFlowDay>();
  for (const row of rows) {
    const existing = byDate.get(row.flow_date);
    if (!existing || row.source === "sosovalue") {
      byDate.set(row.flow_date, row);
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => (a.flow_date < b.flow_date ? 1 : -1))
    .slice(0, limit);
}

async function getRecentEtfFlows(): Promise<EtfFlowDay[]> {
  const { data, error } = await supabase
    .from("etf_flows")
    .select("*")
    .order("flow_date", { ascending: false })
    .limit(ETF_FLOW_LIMIT * 2);
  if (error) return [];
  return dedupeEtfByDate(data ?? [], ETF_FLOW_LIMIT);
}

async function getHighImpactNews(): Promise<NewsEvent[]> {
  const cutoff = new Date(Date.now() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("news_events")
    .select("*")
    .eq("is_market_moving", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(NEWS_LIMIT);
  if (error) return [];
  return data ?? [];
}

async function getDashboardPollBundle(sinceIso: string): Promise<DashboardPollBundle | null> {
  const { data, error } = await supabase.rpc("get_dashboard_poll_bundle", {
    p_since: sinceIso,
    p_max_points: DASHBOARD_BUNDLE_MAX_POINTS,
  });
  if (error) return null;
  return (data as DashboardPollBundle | null) ?? null;
}

async function getLiquidationIntelligence(): Promise<LiquidationIntelligence | null> {
  const cutoff = new Date(Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_liquidation_intelligence", {
    p_since: cutoff,
    p_bucket_minutes: LIQUIDATION_BUCKET_MINUTES,
    p_price_bucket_usd: LIQUIDATION_PRICE_BUCKET_USD,
  });
  if (error) return null;
  return (data as LiquidationIntelligence | null) ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface BewegungsvorratRow {
  today_range_usd: number | null;
  median_range_10d_usd: number | null;
  ratio_pct: number | null;
}

async function getBewegungsvorrat(): Promise<BewegungsvorratRow> {
  const { data: candleRows } = await supabase
    .from("candles")
    .select("open_time, high, low")
    .eq("exchange", BEWEGUNGSVORRAT_EXCHANGE)
    .eq("symbol", BEWEGUNGSVORRAT_SYMBOL)
    .eq("interval", "1d")
    .order("open_time", { ascending: false })
    .limit(BEWEGUNGSVORRAT_LOOKBACK_DAYS + 1);

  const rows = (candleRows ?? []) as { open_time: string; high: number; low: number }[];
  const [today, ...previousDays] = rows;
  const todayRange = today ? today.high - today.low : null;
  const priorRanges = previousDays.map((c) => c.high - c.low);
  const medianRange = median(priorRanges);
  const ratioPct =
    todayRange !== null && medianRange !== null && medianRange > 0
      ? Math.round((todayRange / medianRange) * 1000) / 10
      : null;

  return { today_range_usd: todayRange, median_range_10d_usd: medianRange, ratio_pct: ratioPct };
}

// Kurs und Veraenderung fuer das Marktupdate: 24h aus 1h-Kerzen, 7 Tage
// samt Hoch/Tief aus 1d-Kerzen (dieselbe Quelle wie der Bewegungsvorrat).
interface BtcMarkt {
  kurs_usd: number | null;
  veraenderung_24h_pct: number | null;
  veraenderung_7d_pct: number | null;
  hoch_7d_usd: number | null;
  tief_7d_usd: number | null;
}

function pctChange(now: number | null | undefined, then: number | null | undefined): number | null {
  if (now == null || then == null || then === 0) return null;
  return Math.round(((now - then) / then) * 1000) / 10;
}

async function getBtcMarkt(): Promise<BtcMarkt> {
  const [hourly, daily] = await Promise.all([
    supabase
      .from("candles")
      .select("open_time, close")
      .eq("exchange", BEWEGUNGSVORRAT_EXCHANGE)
      .eq("symbol", BEWEGUNGSVORRAT_SYMBOL)
      .eq("interval", "1h")
      .order("open_time", { ascending: false })
      .limit(25),
    supabase
      .from("candles")
      .select("open_time, high, low, close")
      .eq("exchange", BEWEGUNGSVORRAT_EXCHANGE)
      .eq("symbol", BEWEGUNGSVORRAT_SYMBOL)
      .eq("interval", "1d")
      .order("open_time", { ascending: false })
      .limit(8),
  ]);
  const h = (hourly.data ?? []) as { close: number }[];
  const d = (daily.data ?? []) as { high: number; low: number; close: number }[];
  const kurs = h[0]?.close ?? d[0]?.close ?? null;
  const week = d.slice(0, 7);
  return {
    kurs_usd: kurs,
    veraenderung_24h_pct: pctChange(kurs, h[24]?.close),
    veraenderung_7d_pct: pctChange(kurs, d[7]?.close),
    hoch_7d_usd: week.length > 0 ? Math.max(...week.map((c) => c.high)) : null,
    tief_7d_usd: week.length > 0 ? Math.min(...week.map((c) => c.low)) : null,
  };
}

// RSI(14) aus market_features, aktuell und vorherige Kerze je Zeitrahmen --
// fuer den Momentum-Abschnitt ("RSI 4H von 45 auf 56 gestiegen").
interface RsiStand {
  aktuell: number | null;
  vorher: number | null;
}

async function getRsi(interval: "4h" | "1d"): Promise<RsiStand> {
  const { data } = await supabase
    .from("market_features")
    .select("rsi_14")
    .eq("symbol", BEWEGUNGSVORRAT_SYMBOL)
    .eq("interval", interval)
    .order("candle_open_time", { ascending: false })
    .limit(2);
  const rows = (data ?? []) as { rsi_14: number | null }[];
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
  return { aktuell: round(rows[0]?.rsi_14), vorher: round(rows[1]?.rsi_14) };
}

// Termine von heute und morgen (economic_calendar_events, gleiche Quelle wie
// die Wirtschaftskalender-Kachel).
async function getKalender(): Promise<Pick<EconomicCalendarEvent, "label" | "event_date" | "typical_time_et">[]> {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const { data } = await supabase
    .from("economic_calendar_events")
    .select("label, event_date, typical_time_et")
    .gte("event_date", today.toISOString().slice(0, 10))
    .lte("event_date", tomorrow.toISOString().slice(0, 10))
    .order("event_date", { ascending: true });
  return data ?? [];
}

interface RegelwerkEntry {
  module: "welz" | "salomon" | "mein_system";
  section: string;
  title: string;
  content: string;
}

async function getRegelwerk(): Promise<RegelwerkEntry[]> {
  const entries = await getKnowledgeBase();
  return entries.map((e) => ({ module: e.module, section: e.section, title: e.title, content: e.content }));
}

export interface SystemBriefingContext {
  generated_at: string;
  bewegungsvorrat: BewegungsvorratRow;
  market_state: {
    overall_state: MarketState["overall_state"];
    score: number | null;
    confidence: number;
    data_coverage_pct: number;
    risk_level: MarketState["risk_level"];
    risk_factors: string[] | null;
    patterns: { name: string; note: string }[];
    mtf_alignment: MarketState["mtf_alignment"];
    // Die einzelnen Faktor-Werte der 14-Faktoren-Engine (nicht nur das
    // Aggregat), damit der Konfluenz-Check pruefen kann, ob overall_state/
    // score/confidence/risk_level/patterns zu den Faktoren passen.
    factors: MarketState["factors"];
  } | null;
  confidence_breakdown: {
    coveragePct: number;
    consensusPct: number | null;
    signalStrengthPct: number;
  } | null;
  mein_system_checklist: MeinSystemChecklistData;
  trading_indicators: TradingIndicatorsData;
  liquidations: {
    price_clusters: LiquidationIntelligence["price_clusters"];
    total_notional_usd: number;
    total_oi_usd: number | null;
    lookback_hours: number;
  } | null;
  regelwerk: RegelwerkEntry[];
  // Marktkontext/ETF-Flows/Positionierung/News.
  market_context: {
    label: string;
    bias: "bullish" | "bearish" | "neutral";
    explanation: string;
    price_change_pct: number | null;
    oi_change_pct: number | null;
    spot_verdict_label: string;
  } | null;
  etf_flows: {
    cumulative_usd_m: number | null;
    days: number;
    // Juengster Handelstag einzeln (Netto-Zu-/Abfluss in Mio. USD).
    letzter_tag: { datum: string; usd_m: number | null } | null;
  };
  positioning: { confidence: number | null };
  news: { count: number; lookback_hours: number; schlagzeilen: string[] };
  btc_markt: BtcMarkt;
  rsi: { "4h": RsiStand; "1d": RsiStand };
  wirtschaftskalender: Pick<EconomicCalendarEvent, "label" | "event_date" | "typical_time_et">[];
  // Chart-Strukturdaten -- algorithmisch berechnet, nicht vision-basiert.
  triangle: ChartStructureData["triangle"];
  continuationFormation: ChartStructureData["continuationFormation"];
  swingFormations: ChartStructureData["swingFormations"];
  // Nur die juengsten 3 -- Prompt-Verschlankung gegen das Vercel-60s-Limit,
  // siehe nearestKeyLevels unten.
  recentCandlestickPatterns: ChartStructureData["candlestickPatterns"];
  // Nur die 2 naechstgelegenen je Seite -- deckungsgleich mit levelStruktur,
  // siehe nearestKeyLevels in buildSystemBriefingContext().
  keyLevels: KeyLevel[];
  // signalTally bewusst weggelassen -- die zugrunde liegenden Signale
  // (CVD-Trend, Warn-Muster, MTF-Ampel) stehen bereits oben in diesem
  // Kontext (market_state/trading_indicators), eine zweite Zaehlung waere
  // Dopplung.
  levelStruktur: Array<Omit<LevelStructureZone, "signalTally">>;
}

export async function buildSystemBriefingContext(): Promise<SystemBriefingContext> {
  const tf = getTimeframe(DEFAULT_TIMEFRAME);
  const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
  const fetchedAtMs = Date.now();

  const [
    state,
    bewegungsvorrat,
    meinSystemChecklist,
    tradingIndicators,
    liquidationIntelligence,
    regelwerk,
    bundle,
    recentEtfFlows,
    highImpactNews,
    chartStructure,
    btcMarkt,
    rsi4h,
    rsi1d,
    kalender,
  ] = await Promise.all([
    getLatestMarketState(),
    getBewegungsvorrat(),
    getMeinSystemChecklistData(),
    getTradingIndicatorsData(),
    getLiquidationIntelligence(),
    getRegelwerk(),
    getDashboardPollBundle(sinceIso),
    getRecentEtfFlows(),
    getHighImpactNews(),
    getChartStructureData(),
    getBtcMarkt(),
    getRsi("4h"),
    getRsi("1d"),
    getKalender(),
  ]);

  const marketContextDerived = bundle
    ? deriveMarketContext(bundle, DEFAULT_TIMEFRAME, sinceIso, fetchedAtMs)
    : null;

  const etfCumulative = recentEtfFlows.length > 0
    ? recentEtfFlows.slice(0, CUMULATIVE_ETF_DAYS).reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0)
    : null;
  const etfDays = Math.min(recentEtfFlows.length, CUMULATIVE_ETF_DAYS);

  // Dieselbe Anreicherung wie vormals app/lernen/page.tsx/lib/
  // chartNarrativeContext.ts -- EMA13/50/200 und VWAP-Vector sind oben
  // bereits geladen (meinSystemChecklist/tradingIndicators), kein zweiter
  // Fetch.
  const chartStructureEnriched = withConfirmationLevels(chartStructure, [
    { label: "ema13", price: meinSystemChecklist.ema13 },
    { label: "ema50", price: meinSystemChecklist.ema50 },
    { label: "ema200", price: meinSystemChecklist.ema200 },
    { label: "vwap_daily", price: tradingIndicators.vwapVector.dayVwap },
    { label: "vwap_weekly", price: tradingIndicators.vwapVector.weeklyVwap },
    { label: "vwap_swing_high", price: tradingIndicators.vwapVector.swingHighVwap },
    { label: "vwap_swing_low", price: tradingIndicators.vwapVector.swingLowVwap },
  ]);
  const levelStructureZones = await getLevelStructureData(
    chartStructureEnriched.keyLevels,
    tradingIndicators.cvd.trend
  );

  // Fuer den KI-Kontext auf die 2 naechstgelegenen Key Levels je Seite
  // begrenzt (deckungsgleich mit levelStruktur) statt aller bis zu
  // KEY_LEVEL_MAX_ZONES_PER_SIDE -- weniger Daten je Aufruf gegen das
  // Vercel-60s-Limit. Die volle Liste bleibt fuer getLevelStructureData.
  const currentPriceForSort = chartStructureEnriched.currentPrice ?? 0;
  const nearestKeyLevels = [
    ...chartStructureEnriched.keyLevels
      .filter((z) => z.side === "resistance")
      .sort((a, b) => a.price - b.price)
      .slice(0, 2),
    ...chartStructureEnriched.keyLevels
      .filter((z) => z.side === "support")
      .sort((a, b) => b.price - a.price)
      .slice(0, 2),
  ].sort((a, b) => Math.abs(a.price - currentPriceForSort) - Math.abs(b.price - currentPriceForSort));

  return {
    generated_at: new Date().toISOString(),
    bewegungsvorrat,
    market_state: state
      ? {
          overall_state: state.overall_state,
          score: state.score,
          confidence: state.confidence,
          data_coverage_pct: state.data_coverage_pct,
          risk_level: state.risk_level,
          risk_factors: state.risk_factors,
          patterns: state.patterns ?? [],
          mtf_alignment: state.mtf_alignment,
          factors: state.factors,
        }
      : null,
    confidence_breakdown: state ? computeConfidenceBreakdown(state) : null,
    mein_system_checklist: meinSystemChecklist,
    trading_indicators: tradingIndicators,
    liquidations: liquidationIntelligence
      ? {
          price_clusters: liquidationIntelligence.price_clusters.slice(0, TOP_CLUSTERS_COUNT),
          total_notional_usd: liquidationIntelligence.total_notional_usd,
          total_oi_usd: liquidationIntelligence.total_oi_usd,
          lookback_hours: LIQUIDATION_LOOKBACK_HOURS,
        }
      : null,
    regelwerk,
    market_context: marketContextDerived
      ? {
          label: marketContextDerived.result.label,
          bias: marketContextDerived.result.bias,
          explanation: marketContextDerived.result.explanation,
          price_change_pct: marketContextDerived.priceChangePct,
          oi_change_pct: marketContextDerived.oiChangePct,
          spot_verdict_label: marketContextDerived.spotVerdict.label,
        }
      : null,
    etf_flows: {
      cumulative_usd_m: etfCumulative,
      days: etfDays,
      letzter_tag: recentEtfFlows[0]
        ? { datum: recentEtfFlows[0].flow_date, usd_m: recentEtfFlows[0].total_flow_usd_m }
        : null,
    },
    positioning: { confidence: bundle?.positioning_signal?.confidence ?? null },
    news: {
      count: highImpactNews.length,
      lookback_hours: NEWS_LOOKBACK_HOURS,
      schlagzeilen: highImpactNews.map((n) => n.title_de ?? n.title),
    },
    btc_markt: btcMarkt,
    rsi: { "4h": rsi4h, "1d": rsi1d },
    wirtschaftskalender: kalender,
    triangle: chartStructureEnriched.triangle,
    continuationFormation: chartStructureEnriched.continuationFormation,
    swingFormations: chartStructureEnriched.swingFormations,
    recentCandlestickPatterns: chartStructureEnriched.candlestickPatterns.slice(-3),
    keyLevels: nearestKeyLevels,
    levelStruktur: levelStructureZones.map((zone) => {
      const { signalTally, ...rest } = zone;
      void signalTally;
      return rest;
    }),
  };
}

// --- Kontext-Zuschnitte je Teil-Aufruf ----------------------------------------
// buildSystemBriefingContext() laedt ALLES in einem Promise.all, der KI-Aufruf
// ist aber in vier kleine, fokussierte Calls aufgeteilt (gegen das
// Vercel-60s-Limit). Jede Funktion hier ist pure und reicht nur
// ihren Ausschnitt weiter. Prompts: lib/ai/promptProfiles.ts
// ("system-briefing-*"), Orchestrierung: app/api/system-briefing/generate.

export function sliceForRegelwerk(ctx: SystemBriefingContext) {
  const { regelwerk, bewegungsvorrat, mein_system_checklist, trading_indicators, liquidations } = ctx;
  return { regelwerk, bewegungsvorrat, mein_system_checklist, trading_indicators, liquidations };
}

export function sliceForChartStruktur(ctx: SystemBriefingContext) {
  const { triangle, continuationFormation, swingFormations, recentCandlestickPatterns, keyLevels, levelStruktur } =
    ctx;
  const { dayVwap, weeklyVwap, monthlyVwap } = ctx.trading_indicators.vwapVector;
  return {
    btc_markt: ctx.btc_markt,
    vwap: { tag: dayVwap, woche: weeklyVwap, monat: monthlyVwap },
    triangle,
    continuationFormation,
    swingFormations,
    recentCandlestickPatterns,
    keyLevels,
    levelStruktur,
  };
}

export function sliceForTrigger(ctx: SystemBriefingContext) {
  const { btc_markt, keyLevels, mein_system_checklist, trading_indicators } = ctx;
  return { btc_markt, keyLevels, mein_system_checklist, trading_indicators };
}

// Eingabe fuer sliceForSynthese: die bereits fertigen Ergebnisse der drei
// anderen Teil-Aufrufe (nicht die Rohdaten dahinter).
export interface SystemBriefingSynthesisParts {
  regelwerkCheck: { regelwerkCheck: string; leanBias: "bullish" | "bearish" | "neutral" };
  chartStruktur: { chartStruktur: string; leanBias: "bullish" | "bearish" | "neutral" };
  trigger: SystemBriefingTrigger;
}

// Fazit des vorherigen erfolgreichen Briefings fuer "aenderungSeitLetztem"
// (uebernommen vom frueheren Master-Report, dort "changeSinceLast").
export interface PreviousBriefing {
  generated_at: string;
  bias: string;
  confidence: number;
  kernaussage: string;
}

export function sliceForSynthese(
  ctx: SystemBriefingContext,
  parts: SystemBriefingSynthesisParts,
  previousBriefing: PreviousBriefing | null
) {
  const { market_state, market_context, etf_flows, positioning, news, bewegungsvorrat } = ctx;
  return {
    previousBriefing,
    btc_markt: ctx.btc_markt,
    rsi: ctx.rsi,
    liquidations: ctx.liquidations,
    wirtschaftskalender: ctx.wirtschaftskalender,
    regelwerkCheck: parts.regelwerkCheck.regelwerkCheck,
    regelwerkLeanBias: parts.regelwerkCheck.leanBias,
    chartStruktur: parts.chartStruktur.chartStruktur,
    chartLeanBias: parts.chartStruktur.leanBias,
    trigger: parts.trigger,
    market_state,
    market_context,
    etf_flows,
    positioning,
    news,
    bewegungsvorrat_ratio_pct: bewegungsvorrat.ratio_pct,
  };
}
