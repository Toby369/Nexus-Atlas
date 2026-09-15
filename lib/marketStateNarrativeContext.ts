// Kontext-Builder fuer die Gesamteinschaetzung-Zusammenfassung-KI-Kachel
// (Nutzer-Wunsch 15.09.2026: "text zusammenfassung, wie einzelne signale
// gedeutet werden, inkl. salomon"). Bewusst KEIN zweiter Rechenweg fuer die
// bereits angezeigten Werte -- dieselben Funktionen/Queries wie HeroHeader.tsx
// (Ebene 0/1), nur serverseitig fuer den Kontext eines einzelnen, per Klick
// ausgeloesten AI-Aufrufs zusammengefuehrt. Der Prompt selbst (siehe
// lib/ai/promptProfiles.ts, Profil "market-state-narrative") verbietet dem
// Modell ausdruecklich, diese Werte nur nachzuerzaehlen -- sie sind hier nur
// die Grundlage fuer die Deutung von Widerspruechen/Zusammenhaengen.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import type { MarketState, MarketRegime, EtfFlowDay, LiquidationEvent, NewsEvent, DashboardPollBundle } from "./types";
import { DEFAULT_TIMEFRAME, getTimeframe } from "./timeframes";
import { deriveMarketContext } from "./marketContext";
import { computeConfidenceBreakdown, computeEngineDivergence } from "./marketStateSummary";
import { getSalomonInterpretation } from "./salomonInterpretation";

const CUMULATIVE_ETF_DAYS = 5;
const ETF_FLOW_LIMIT = 10;
const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_LIMIT = 300;
const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LIMIT = 5;
const DASHBOARD_BUNDLE_MAX_POINTS = 500;

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

async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const cutoff = new Date(Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(LIQUIDATION_LIMIT);
  if (error) return [];
  return data ?? [];
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

export interface MarketStateNarrativeContext {
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
  liquidations: { count: number; total_notional_usd: number; lookback_hours: number };
  news: { count: number; lookback_hours: number };
}

export async function buildMarketStateNarrativeContext(): Promise<MarketStateNarrativeContext> {
  const tf = getTimeframe(DEFAULT_TIMEFRAME);
  const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
  const fetchedAtMs = Date.now();

  const [state, regimeRow, bundle, recentEtfFlows, recentLiquidations, highImpactNews] = await Promise.all([
    getLatestMarketState(),
    getLatestRegime(),
    getDashboardPollBundle(sinceIso),
    getRecentEtfFlows(),
    getRecentLiquidations(),
    getHighImpactNews(),
  ]);

  const marketContextDerived = bundle
    ? deriveMarketContext(bundle, DEFAULT_TIMEFRAME, sinceIso, fetchedAtMs)
    : null;

  const etfCumulative = recentEtfFlows.length > 0
    ? recentEtfFlows.slice(0, CUMULATIVE_ETF_DAYS).reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0)
    : null;
  const etfDays = Math.min(recentEtfFlows.length, CUMULATIVE_ETF_DAYS);

  const liqTotalNotional = recentLiquidations.reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);

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
    liquidations: {
      count: recentLiquidations.length,
      total_notional_usd: liqTotalNotional,
      lookback_hours: LIQUIDATION_LOOKBACK_HOURS,
    },
    news: { count: highImpactNews.length, lookback_hours: NEWS_LOOKBACK_HOURS },
  };
}
