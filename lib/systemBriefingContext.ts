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
  DashboardPollBundle,
} from "./types";

// Kontext-Builder fuer die System-Briefing-Kachel (Umsetzungsplan Phase 4,
// 18.09.2026: "kombinierte Entscheidungsunterstuetzungs-Kachel"; erweitert
// 22.09.2026 um Marktkontext/ETF-Flows/Positionierung/News). Fusioniert
// Tobys eigenes Regelwerk (knowledge_base) + Salomon-Phase + Nexus' bereits
// berechnete Faktoren (14-Faktoren-Engine, Regime Matrix, GUSS/VWAP-Vector/
// CVD, Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News)
// zu EINEM Kontext -- mehrere kleine getX()-Funktionen, EIN Promise.all.
// KEIN zweiter Rechenweg: jede Quelle hier ist bereits bestehender Code.
// Chart-Vision (Phase 3) wurde 25.09.2026 als eigenstaendige Kachel
// entfernt (Nutzer-Entscheidung: durch die neue, algorithmische
// "Struktur"-Kachel weitgehend ueberholt) -- damit auch hier als Quelle
// entfernt.
//
// 30.09.2026 -- Toby: "brauche nicht weitere Kacheln, moechte vorhandenes
// komprimieren". Handelslage (eigene Kachel) wurde in dieses Briefing
// aufgenommen statt daneben zu bestehen -- deren Kernkennzahl
// (bewegungsvorrat) ist jetzt Teil dieses Kontexts. Gleichzeitig wurden
// Salomon-Phase (salomonInterpretation.ts) und Regime Matrix als eigene
// Quellen HIER entfernt -- beide sind bereits in der Marktphase-Kachel
// (RegimeMatrixCard) sichtbar bzw. werden von deren eigener Engine
// abgeleitet, waren hier nur eine zweite Beschreibung derselben Faktoren
// (siehe Chat-Verlauf, Redundanz-Analyse). market_state (14-Faktoren-
// Engine) bleibt, da mein_system_checklist/Regelwerk-Gates direkt darauf
// aufbauen.
//
// 06.10.2026 -- Zusammengelegt mit der vormals eigenstaendigen Chart-
// Narrativ-Kachel (Nutzer-Audit "welche Reports sind sehr aehnlich?" --
// beide nutzten bereits denselben breiten Signal-Satz, siehe ehemalige
// lib/chartNarrativeContext.ts, jetzt hier aufgegangen). chart_structure
// liefert die algorithmisch berechneten Formationen/Key Levels/Level-
// Struktur direkt mit -- dieselbe Anreicherung (EMA13/50/200 + VWAP-
// Vector-Konfluenz), die vormals app/lernen/page.tsx separat durchfuehrte,
// jetzt EINMAL hier, da mein_system_checklist/trading_indicators ohnehin
// schon oben geladen werden (kein zweiter Fetch).
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

// Bewegungsvorrat (30.09.2026, aus lib/handelslageContext.ts uebernommen):
// die heutige Tagesspanne relativ zum MEDIAN (nicht Mittelwert, ein
// einzelner Crash-Tag soll den Massstab nicht dauerhaft verzerren) der
// letzten 10 abgeschlossenen Tage. Ein Markt, der bereits 200% seines
// ueblichen Tagespensums bewegt hat, ist kein guter Fortsetzungskandidat,
// wie sauber der Trend auch aussieht.
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
    // Die einzelnen Faktor-Werte der 14-Faktoren-Engine (nicht nur deren
    // Aggregat) -- seit 02.10.2026 hier aufgenommen, um die vormals
    // eigenstaendige "Signal-Engine"-Kachel zu ersetzen (Nutzer: "braucht
    // es alle Kacheln so wie sie sind?", Audit ergab: 13 Tage ungenutzt).
    // Zweck bleibt derselbe wie dort: pruefen, ob overall_state/score/
    // confidence/risk_level/patterns tatsaechlich zu den einzelnen
    // Faktoren passen -- jetzt als Teil DIESES KI-Aufrufs (kontextCheck),
    // kein zusaetzlicher separater Call noetig.
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
  // Chart-Strukturdaten (06.10.2026, aus der zusammengelegten Chart-
  // Narrativ-Kachel) -- algorithmisch berechnet, nicht vision-basiert.
  triangle: ChartStructureData["triangle"];
  continuationFormation: ChartStructureData["continuationFormation"];
  swingFormations: ChartStructureData["swingFormations"];
  // Nur die juengsten 3 (07.10.2026, vorher 5) -- Teil der Prompt-
  // Verschlankung gegen das Vercel-60s-Limit, siehe Kommentar bei
  // nearestKeyLevels unten.
  recentCandlestickPatterns: ChartStructureData["candlestickPatterns"];
  // Nur die 2 naechstgelegenen je Seite (07.10.2026, vorher bis zu 4) --
  // deckungsgleich mit levelStruktur, siehe nearestKeyLevels in
  // buildSystemBriefingContext().
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

  // 07.10.2026 -- fuer den KI-Kontext auf die 2 naechstgelegenen Key Levels
  // je Seite begrenzt (deckungsgleich mit levelStruktur, die ohnehin nur
  // diese narrativ beschreibt) statt aller bis zu KEY_LEVEL_MAX_ZONES_PER_SIDE
  // (4) -- weniger Daten je Aufruf, Teil der Prompt-Verschlankung gegen das
  // Vercel-60s-Limit (siehe promptProfiles.ts "system-briefing"). Die volle
  // Liste bleibt fuer getLevelStructureData oben unveraendert.
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
    etf_flows: { cumulative_usd_m: etfCumulative, days: etfDays },
    positioning: { confidence: bundle?.positioning_signal?.confidence ?? null },
    news: { count: highImpactNews.length, lookback_hours: NEWS_LOOKBACK_HOURS },
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
