import { supabase } from "./supabase";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { computeConfidenceBreakdown, computeEngineDivergence } from "./marketStateSummary";
import { getSalomonInterpretation } from "./salomonInterpretation";
import { getMeinSystemChecklistData, type MeinSystemChecklistData } from "./meinSystemContext";
import { getTradingIndicatorsData, type TradingIndicatorsData } from "./tradingIndicatorsContext";
import { getKnowledgeBase } from "./knowledgeBaseContext";
import type { ChartVisionResult } from "./ai/chartVisionAnalysis";
import type { MarketState, MarketRegime, LiquidationIntelligence } from "./types";

// Kontext-Builder fuer die System-Briefing-Kachel (Umsetzungsplan Phase 4,
// 18.09.2026: "kombinierte Entscheidungsunterstuetzungs-Kachel"). Fusioniert
// Tobys eigenes Regelwerk (knowledge_base) + Salomon-Phase + Nexus' bereits
// berechnete Faktoren (14-Faktoren-Engine, Regime Matrix, GUSS/VWAP-Vector/
// CVD, Liquidations-Cluster) + den Chart-Vision-Screenshot-Read (Phase 3) zu
// EINEM Kontext -- gleiches Grundmuster wie lib/marketStateNarrativeContext.ts
// (mehrere kleine getX()-Funktionen, EIN Promise.all), aber deutlich breiter.
// KEIN zweiter Rechenweg: jede Quelle hier ist bereits bestehender Code.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_BUCKET_MINUTES = 15;
// Dieselbe Kalibrierung wie components/LiquidationPanel.tsx -- keine zweite,
// abweichende Definition derselben Kennzahl.
const LIQUIDATION_PRICE_BUCKET_USD = 200;
const TOP_CLUSTERS_COUNT = 4;

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
}

export async function buildSystemBriefingContext(): Promise<SystemBriefingContext> {
  const [state, regimeRow, meinSystemChecklist, tradingIndicators, liquidationIntelligence, chartVision, regelwerk] =
    await Promise.all([
      getLatestMarketState(),
      getLatestRegime(),
      getMeinSystemChecklistData(),
      getTradingIndicatorsData(),
      getLiquidationIntelligence(),
      getRecentChartVision(),
      getRegelwerk(),
    ]);

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
  };
}
