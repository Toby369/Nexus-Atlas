// Zentraler Report-Context-Builder fuer die NEXUS AI Report Engine.
//
// WICHTIG (Vorgabe Teil Q): NEXUS sammelt, validiert und strukturiert die
// Marktdaten. Die KI interpretiert nur, was hier tatsaechlich vorhanden
// ist -- sie bekommt niemals rohe Tabellenzeilen, sondern ausschliesslich
// dieses strukturierte, bereits validierte Objekt. Fehlt ein Wert, steht
// hier null, nie eine erfundene Zahl. data_quality macht explizit, wie
// verlaesslich die Basis fuer den gewaehlten Zeitraum ist -- Report-Profile
// MUESSEN diesen Status in ihrer Interpretation beruecksichtigen (Vorgabe
// Teil T).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { getTimeframe, type TimeframeId } from "./timeframes";
import { DEFAULT_SERIES_EXCHANGE, SERIES_EXCHANGES } from "./exchanges";
import { classifyMarketContext, type MarketContextResult } from "./marketContext";
import { classifySpotPressure, type SpotPressureResult } from "./spotPressure";
import type {
  EtfFlowDay,
  LiquidationEvent,
  MarketSeriesPoint,
  MarketSnapshot,
  NewsEvent,
  OiChangeByExchange,
  PositioningSignal,
  PositioningSnapshot,
  SpotPressureSummary,
} from "./types";

const REFERENCE_EXCHANGE = "bybit";
const COMPARE_EXCHANGES = ["bybit", "binance", "okx", "bitget", "bitunix", "pionex"];
const SERIES_MAX_POINTS = 500;
const HISTORY_GAP_TOLERANCE_MS = 15 * 60 * 1000;
// Liquidationen/News/ETF haben eigene, etablierte Betrachtungsfenster
// (siehe app/page.tsx) -- ein 6h-Liquidationsfenster oder ein 72h-News-
// Fenster bleiben auch bei "15M" oder "1W" Preis-Zeitraum sinnvoll, sie
// wuerden bei strikter Kopplung an den Preis-Zeitraum ihren Zweck
// verlieren (bei "15M" waeren praktisch nie Liquidationen/News vorhanden).
const LIQUIDATION_LOOKBACK_HOURS = 6;
const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LIMIT = 10;
const ETF_FLOW_LIMIT = 5;

export interface DataQualityReport {
  overall: "OK" | "PRELIMINARY" | "INSUFFICIENT_DATA";
  oi_history_complete: boolean;
  spot_coverage_candles: number;
  spot_coverage_expected: number;
  spot_status: "OK" | "PRELIMINARY" | "INSUFFICIENT";
  notes: string[];
}

export interface FullMarketContext {
  timeframe: TimeframeId;
  generated_at: string;

  btc_price: {
    current: number | null;
    change_pct: number | null;
    reference_timestamp_utc: string | null;
  };

  oi: {
    aggregated_change_pct: number | null;
    by_exchange: Array<{
      exchange: string;
      change_pct: number | null;
      status: "OK" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY";
    }>;
  };

  funding: {
    bybit_rate: number | null;
    by_exchange: Array<{ exchange: string; funding_rate: number | null }>;
  };

  spot_pressure: {
    net_flow_pct: number | null;
    verdict: SpotPressureResult["verdict"];
    verdict_label: string;
    taker_buy_vol: number | null;
    taker_sell_vol: number | null;
    candle_count: number;
    expected_candles: number;
  };

  liquidations: {
    window_hours: number;
    count: number;
    long_notional_usd: number | null;
    short_notional_usd: number | null;
  };

  positioning: {
    binance: PositioningSnapshot | null;
    bybit: PositioningSnapshot | null;
    okx: PositioningSnapshot | null;
    signal: PositioningSignal | null;
  };

  exchange_comparison: Array<{
    exchange: string;
    price: number | null;
    deviation_pct: number | null;
    funding_rate: number | null;
  }>;

  news_macro: {
    window_hours: number;
    high_impact_count: number;
    items: Array<{
      title_de: string | null;
      title: string;
      category: string;
      market_direction: string;
      impact_score: number;
      published_at: string;
    }>;
  };

  etf_flows: {
    latest_day: { flow_date: string; total_flow_usd_m: number | null } | null;
    recent: Array<{ flow_date: string; total_flow_usd_m: number | null }>;
  };

  assessment: MarketContextResult;

  data_quality: DataQualityReport;
}

async function getOiSeries(exchange: string, sinceIso: string): Promise<MarketSeriesPoint[]> {
  const { data, error } = await supabase.rpc("get_market_series", {
    p_exchange: exchange,
    p_since: sinceIso,
    p_max_points: SERIES_MAX_POINTS,
  });
  if (error) {
    console.error("reportContext: Fehler bei get_market_series:", error.message);
    return [];
  }
  return data ?? [];
}

async function getOiReference(exchange: string, cutoffIso: string): Promise<{
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
} | null> {
  const { data, error } = await supabase.rpc("get_market_reference_snapshot", {
    p_exchange: exchange,
    p_cutoff: cutoffIso,
  });
  if (error) {
    console.error("reportContext: Fehler bei get_market_reference_snapshot:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

async function getOiByExchange(sinceIso: string): Promise<OiChangeByExchange[]> {
  const { data, error } = await supabase.rpc("get_oi_change_by_exchange", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("reportContext: Fehler bei get_oi_change_by_exchange:", error.message);
    return [];
  }
  return data ?? [];
}

async function getSpotSummary(sinceIso: string): Promise<SpotPressureSummary | null> {
  const { data, error } = await supabase.rpc("get_spot_pressure_summary", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("reportContext: Fehler bei get_spot_pressure_summary:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

async function getLatestPerExchange(): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .in("exchange", COMPARE_EXCHANGES)
    .order("timestamp_utc", { ascending: false })
    .limit(40);
  if (error) {
    console.error("reportContext: Fehler beim Laden des Boersenvergleichs:", error.message);
    return [];
  }
  const seen = new Set<string>();
  const latest: MarketSnapshot[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.exchange)) {
      seen.add(row.exchange);
      latest.push(row);
    }
  }
  return latest;
}

async function getLatestPositioning(exchange: string): Promise<PositioningSnapshot | null> {
  const { data, error } = await supabase
    .from("positioning_snapshots")
    .select("*")
    .eq("status", "ok")
    .eq("exchange", exchange)
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`reportContext: Fehler beim Laden des Positioning-Snapshots (${exchange}):`, error.message);
    return null;
  }
  return data;
}

async function getLatestPositioningSignal(): Promise<PositioningSignal | null> {
  const { data, error } = await supabase
    .from("positioning_signals")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("reportContext: Fehler beim Laden des Positioning-Signals:", error.message);
    return null;
  }
  return data;
}

async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const cutoff = new Date(Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(300);
  if (error) {
    console.error("reportContext: Fehler beim Laden der Liquidationen:", error.message);
    return [];
  }
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
  if (error) {
    console.error("reportContext: Fehler beim Laden der News:", error.message);
    return [];
  }
  return data ?? [];
}

function dedupeEtfByDate(rows: EtfFlowDay[], limit: number): EtfFlowDay[] {
  const byDate = new Map<string, EtfFlowDay>();
  for (const row of rows) {
    const existing = byDate.get(row.flow_date);
    if (!existing || row.source === "sosovalue") byDate.set(row.flow_date, row);
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
  if (error) {
    console.error("reportContext: Fehler beim Laden der ETF-Flows:", error.message);
    return [];
  }
  return dedupeEtfByDate(data ?? [], ETF_FLOW_LIMIT);
}

export async function buildMarketContext(timeframe: TimeframeId): Promise<FullMarketContext> {
  const tf = getTimeframe(timeframe);
  const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
  const generatedAt = new Date().toISOString();

  const [
    oiSeries,
    oiReference,
    oiByExchange,
    spotSummary,
    exchangeComparison,
    positioningBinance,
    positioningBybit,
    positioningOkx,
    positioningSignal,
    liquidations,
    news,
    etfFlows,
  ] = await Promise.all([
    getOiSeries(DEFAULT_SERIES_EXCHANGE, sinceIso),
    getOiReference(DEFAULT_SERIES_EXCHANGE, sinceIso),
    getOiByExchange(sinceIso),
    getSpotSummary(sinceIso),
    getLatestPerExchange(),
    getLatestPositioning("binance"),
    getLatestPositioning("bybit"),
    getLatestPositioning("okx"),
    getLatestPositioningSignal(),
    getRecentLiquidations(),
    getHighImpactNews(),
    getRecentEtfFlows(),
  ]);

  const latestOiPoint = oiSeries.length > 0 ? oiSeries[oiSeries.length - 1] : null;
  const oiChangePct =
    latestOiPoint?.open_interest != null && oiReference?.open_interest != null
      ? ((latestOiPoint.open_interest - oiReference.open_interest) / oiReference.open_interest) * 100
      : null;
  const priceChangePct =
    latestOiPoint?.last_price != null && oiReference?.last_price != null
      ? ((latestOiPoint.last_price - oiReference.last_price) / oiReference.last_price) * 100
      : null;

  const requestedSinceMs = new Date(sinceIso).getTime();
  const oiReferenceMs = oiReference ? new Date(oiReference.timestamp_utc).getTime() : null;
  const hasFullOiHistory =
    oiReferenceMs !== null ? oiReferenceMs <= requestedSinceMs + HISTORY_GAP_TOLERANCE_MS : false;

  const sumBuy = spotSummary?.sum_taker_buy_vol ?? null;
  const sumSell = spotSummary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const spotNetFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;
  const expectedSpotCandles = Math.max(1, Math.round(tf.minutes / 5));
  const spotCandleCount = spotSummary?.candle_count ?? 0;
  const spotVerdict = classifySpotPressure({
    netFlowPct: spotNetFlowPct,
    candleCount: spotCandleCount,
    expectedCandles: expectedSpotCandles,
  });

  const assessment = classifyMarketContext({
    priceChangePct,
    oiChangePct,
    spotNetFlowPct,
    hasFullOiHistory,
    spotDataQuality: spotVerdict.dataQuality,
  });

  // Boersen ohne jemals gemeldetes OI (Bitunix) sind strukturell
  // UNAVAILABLE, nicht bloss "keine Daten in diesem Fenster" -- die KI soll
  // diesen Unterschied kennen statt beides gleich zu behandeln.
  const oiReportingExchanges = new Set(oiByExchange.map((e) => e.exchange));
  const oiByExchangeReport = SERIES_EXCHANGES.filter((e) => e.id !== "aggregated").map((ex) => {
    if (!oiReportingExchanges.has(ex.id)) {
      return { exchange: ex.id, change_pct: null, status: "UNAVAILABLE" as const };
    }
    const entry = oiByExchange.find((e) => e.exchange === ex.id)!;
    return {
      exchange: ex.id,
      change_pct: entry.oi_change_pct,
      status: entry.has_full_history ? ("OK" as const) : ("INSUFFICIENT_HISTORY" as const),
    };
  });

  const bybitSnapshot = exchangeComparison.find((s) => s.exchange === REFERENCE_EXCHANGE) ?? null;
  const refPrice = bybitSnapshot?.last_price ?? null;

  const longLiquidations = liquidations.filter((l) => l.side === "long");
  const shortLiquidations = liquidations.filter((l) => l.side === "short");
  const sumNotional = (events: LiquidationEvent[]) => {
    const withNotional = events.filter((e) => e.notional_usd !== null);
    if (withNotional.length === 0) return null;
    return withNotional.reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  };

  const dataQualityNotes: string[] = [];
  if (!hasFullOiHistory) {
    dataQualityNotes.push(
      `OI-Referenzpunkt faellt ausserhalb der ${tf.label}-Toleranz zurueck (Historie fuer diesen Zeitraum noch nicht vollstaendig).`
    );
  }
  if (spotVerdict.dataQuality !== "OK") {
    dataQualityNotes.push(
      `Spot-Datenbasis fuer ${tf.label}: ${spotCandleCount}/${expectedSpotCandles} Kerzen (${spotVerdict.dataQuality}).`
    );
  }
  const overallQuality: DataQualityReport["overall"] =
    priceChangePct === null || oiChangePct === null
      ? "INSUFFICIENT_DATA"
      : !hasFullOiHistory || spotVerdict.dataQuality !== "OK"
      ? "PRELIMINARY"
      : "OK";

  return {
    timeframe,
    generated_at: generatedAt,
    btc_price: {
      current: latestOiPoint?.last_price ?? null,
      change_pct: priceChangePct,
      reference_timestamp_utc: oiReference?.timestamp_utc ?? null,
    },
    oi: {
      aggregated_change_pct: oiChangePct,
      by_exchange: oiByExchangeReport,
    },
    funding: {
      bybit_rate: bybitSnapshot?.funding_rate ?? null,
      by_exchange: exchangeComparison.map((s) => ({
        exchange: s.exchange,
        funding_rate: s.funding_rate,
      })),
    },
    spot_pressure: {
      net_flow_pct: spotNetFlowPct,
      verdict: spotVerdict.verdict,
      verdict_label: spotVerdict.label,
      taker_buy_vol: sumBuy,
      taker_sell_vol: sumSell,
      candle_count: spotCandleCount,
      expected_candles: expectedSpotCandles,
    },
    liquidations: {
      window_hours: LIQUIDATION_LOOKBACK_HOURS,
      count: liquidations.length,
      long_notional_usd: sumNotional(longLiquidations),
      short_notional_usd: sumNotional(shortLiquidations),
    },
    positioning: {
      binance: positioningBinance,
      bybit: positioningBybit,
      okx: positioningOkx,
      signal: positioningSignal,
    },
    exchange_comparison: exchangeComparison.map((s) => ({
      exchange: s.exchange,
      price: s.last_price,
      deviation_pct:
        refPrice && s.last_price !== null && s.exchange !== REFERENCE_EXCHANGE
          ? ((s.last_price - refPrice) / refPrice) * 100
          : null,
      funding_rate: s.funding_rate,
    })),
    news_macro: {
      window_hours: NEWS_LOOKBACK_HOURS,
      high_impact_count: news.length,
      items: news.map((n) => ({
        title_de: n.title_de,
        title: n.title,
        category: n.category,
        market_direction: n.market_direction,
        impact_score: n.impact_score,
        published_at: n.published_at,
      })),
    },
    etf_flows: {
      latest_day: etfFlows[0]
        ? { flow_date: etfFlows[0].flow_date, total_flow_usd_m: etfFlows[0].total_flow_usd_m }
        : null,
      recent: etfFlows.map((f) => ({ flow_date: f.flow_date, total_flow_usd_m: f.total_flow_usd_m })),
    },
    assessment,
    data_quality: {
      overall: overallQuality,
      oi_history_complete: hasFullOiHistory,
      spot_coverage_candles: spotCandleCount,
      spot_coverage_expected: expectedSpotCandles,
      spot_status: spotVerdict.dataQuality,
      notes: dataQualityNotes,
    },
  };
}
