import { supabase } from "./supabase";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { computeConfidenceBreakdown, computeEngineDivergence } from "./marketStateSummary";
import { getSalomonInterpretation } from "./salomonInterpretation";
import { getMeinSystemChecklistData, type MeinSystemChecklistData } from "./meinSystemContext";
import { getTradingIndicatorsData, type TradingIndicatorsData } from "./tradingIndicatorsContext";
import { getKnowledgeBase } from "./knowledgeBaseContext";
import { DEFAULT_TIMEFRAME, getTimeframe } from "./timeframes";
import { deriveMarketContext } from "./marketContext";
import type { ChartVisionResult } from "./ai/chartVisionAnalysis";
import type {
  MarketState,
  MarketRegime,
  LiquidationIntelligence,
  EtfFlowDay,
  NewsEvent,
  DashboardPollBundle,
} from "./types";

// Kontext-Builder fuer die System-Briefing-Kachel (Umsetzungsplan Phase 4,
// 18.09.2026: "kombinierte Entscheidungsunterstuetzungs-Kachel"; erweitert
// 22.09.2026 um Marktkontext/ETF-Flows/Positionierung/News -- vormals nur im
// separaten "market-state-narrative"-Kontext-Builder, siehe Git-Historie
// von lib/marketStateNarrativeContext.ts, mittlerweile entfernt). Fusioniert
// Tobys eigenes Regelwerk (knowledge_base) + Salomon-Phase + Nexus' bereits
// berechnete Faktoren (14-Faktoren-Engine, Regime Matrix, GUSS/VWAP-Vector/
// CVD, Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News)
// + den Chart-Vision-Screenshot-Read (Phase 3) zu EINEM Kontext -- mehrere
// kleine getX()-Funktionen, EIN Promise.all. KEIN zweiter Rechenweg: jede
// Quelle hier ist bereits bestehender Code.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_BUCKET_MINUTES = 15;
// Dieselbe Kalibrierung wie components/LiquidationPanel.tsx -- keine zweite,
// abweichende Definition derselben Kennzahl.
const LIQUIDATION_PRICE_BUCKET_USD = 200;
const TOP_CLUSTERS_COUNT = 4;

// Marktkontext/ETF-Flows/Positionierung/News (22.09.2026, ergaenzt aus dem
// entfernten "market-state-narrative"-Kontext) -- dieselben Konstanten wie
// dort.
const CUMULATIVE_ETF_DAYS = 5;
const ETF_FLOW_LIMIT = 10;
const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LIMIT = 5;
const DASHBOARD_BUNDLE_MAX_POINTS = 500;

// Ein Chart-Vision-Screenshot ist eine Momentaufnahme -- aelter als dieses
// Fenster wird er NICHT als aktueller Zustand behandelt (deutlich enger als
// der 6h-Liquidations-Lookback, der auf Event-HISTORIE statt einem
// Chart-Snapshot zielt).
const CHART_VISION_MAX_AGE_HOURS = 3;

async function getLatestMarketState(): Promise<MarketState | null> {
  const { data } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function getLatestRegime(): Promise<{ regime: MarketRegime; data_coverage_pct: number } | null> {
  const { data } = await supabase
    .from("market_state_matrix")
    .select("regime, data_coverage_pct")
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

interface ChartVisionRow {
  generated_at: string;
  note: string | null;
  result: ChartVisionResult | null;
}

async function getRecentChartVision(): Promise<{ generated_at: string; note: string | null; result: ChartVisionResult } | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chart_vision_analyses")
    .select("generated_at, note, result")
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<ChartVisionRow>();

  if (error || !data || !data.result) return null;

  const ageMs = Date.now() - new Date(data.generated_at).getTime();
  if (ageMs > CHART_VISION_MAX_AGE_HOURS * 60 * 60 * 1000) return null;

  return { generated_at: data.generated_at, note: data.note, result: data.result };
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
  market_state: {
    overall_state: MarketState["overall_state"];
    confidence: number;
    data_coverage_pct: number;
    risk_level: MarketState["risk_level"];
    risk_factors: string[] | null;
    patterns: { name: string; note: string }[];
    mtf_alignment: MarketState["mtf_alignment"];
  } | null;
  confidence_breakdown: {
    coveragePct: number;
    consensusPct: number | null;
    signalStrengthPct: number;
  } | null;
  regime_matrix: { regime: MarketRegime; data_coverage_pct: number } | null;
  engine_divergence: "AGREEMENT" | "DIVERGENCE" | "NOT_COMPARABLE";
  salomon: { phase: string; sentence: string } | null;
  mein_system_checklist: MeinSystemChecklistData;
  trading_indicators: TradingIndicatorsData;
  liquidations: {
    price_clusters: LiquidationIntelligence["price_clusters"];
    total_notional_usd: number;
    total_oi_usd: number | null;
    lookback_hours: number;
  } | null;
  chart_vision: { generated_at: string; note: string | null; result: ChartVisionResult } | null;
  regelwerk: RegelwerkEntry[];
  // Marktkontext/ETF-Flows/Positionierung/News (22.09.2026, ergaenzt aus dem
  // entfernten "market-state-narrative"-Kontext, siehe Kommentar oben).
  market_context: {
    label: string;
    bias: "bullish" | "bearish" | "neutral";
    explanation: string;
    price_change_pct: number | null;
    oi_change_pct: number | null;
    spot_verdict_label: string;
  } | null;
  etf_flows: { cumulative_usd_m: number | null; days: number };
  positioning: { confidence: number | null };
  news: { count: number; lookback_hours: number };
}

export async function buildSystemBriefingContext(): Promise<SystemBriefingContext> {
  const tf = getTimeframe(DEFAULT_TIMEFRAME);
  const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
  const fetchedAtMs = Date.now();

  const [
    state,
    regimeRow,
    meinSystemChecklist,
    tradingIndicators,
    liquidationIntelligence,
    chartVision,
    regelwerk,
    bundle,
    recentEtfFlows,
    highImpactNews,
  ] = await Promise.all([
    getLatestMarketState(),
    getLatestRegime(),
    getMeinSystemChecklistData(),
    getTradingIndicatorsData(),
    getLiquidationIntelligence(),
    getRecentChartVision(),
    getRegelwerk(),
    getDashboardPollBundle(sinceIso),
    getRecentEtfFlows(),
    getHighImpactNews(),
  ]);

  const marketContextDerived = bundle
    ? deriveMarketContext(bundle, DEFAULT_TIMEFRAME, sinceIso, fetchedAtMs)
    : null;

  const etfCumulative = recentEtfFlows.length > 0
    ? recentEtfFlows.slice(0, CUMULATIVE_ETF_DAYS).reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0)
    : null;
  const etfDays = Math.min(recentEtfFlows.length, CUMULATIVE_ETF_DAYS);

  return {
    generated_at: new Date().toISOString(),
    market_state: state
      ? {
          overall_state: state.overall_state,
          confidence: state.confidence,
          data_coverage_pct: state.data_coverage_pct,
          risk_level: state.risk_level,
          risk_factors: state.risk_factors,
          patterns: state.patterns ?? [],
          mtf_alignment: state.mtf_alignment,
        }
      : null,
    confidence_breakdown: state ? computeConfidenceBreakdown(state) : null,
    regime_matrix: regimeRow,
    engine_divergence: computeEngineDivergence(state?.overall_state ?? null, regimeRow?.regime ?? null),
    salomon: state ? getSalomonInterpretation(state.patterns ?? [], state.mtf_alignment) : null,
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
    chart_vision: chartVision,
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
    etf_flows: { cumulative_usd_m: etfCumulative, days: etfDays },
    positioning: { confidence: bundle?.positioning_signal?.confidence ?? null },
    news: { count: highImpactNews.length, lookback_hours: NEWS_LOOKBACK_HOURS },
  };
}
