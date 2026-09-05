// Datenbeschaffung fuer die Divergenz-Radar-Kachel (05.09.2026) -- reines
// Lesen, kein Schreiben, keine AI. Buendelt die in der Recherche "bei
// welchen Paaren koennen Divergenzen entstehen" identifizierten, technisch
// umsetzbaren Luecken (siehe lib/divergenceRadar.ts fuer die reine Logik).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { buildCycleIndicators } from "./cycleIndicatorsContext";
import { buildLiveLeverageMap } from "./leverageMapContext";
import { classifySpotPressure } from "./spotPressure";
import {
  computeOptionsVsSentimentDivergence,
  computeSpotVsFuturesDivergence,
  computeCycleVsMomentumDivergence,
  computeHandelslageVsStateDivergence,
  computeOnchainVsPriceDivergence,
  computeWallPersistence,
  findCorroboratingLiquidation,
  type DivergenceStatus,
  type OnchainDivergence,
  type WallPersistence,
} from "./divergenceRadar";
import type { MarketState, HandelslageSnapshot } from "./types";

const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";
// Rollierendes 1h-Fenster fuer Spot-Pressure (Nexus-weit 5-Min-Kerzen) --
// bewusst unabhaengig vom globalen Zeitraum-Filter der Seite, analog zum
// festen 48h-Fenster der Liquidations-/Hebelkarte.
const SPOT_WINDOW_MINUTES = 60;
const RECENT_LIQUIDATIONS_HOURS = 6;

export interface WallPersistenceRow {
  exchange: string;
  bidWallPersistence: WallPersistence;
  askWallPersistence: WallPersistence;
}

export interface LiquidationCorroboration {
  clusterPrice: number;
  side: "long" | "short";
  liquidationPrice: number;
  liquidationTime: string;
}

export interface DivergenceRadarResult {
  optionsVsSentiment: DivergenceStatus;
  spotVsFutures: DivergenceStatus;
  cycleVsMomentum: DivergenceStatus;
  handelslageVsState: DivergenceStatus;
  onchainVsPrice: OnchainDivergence;
  wallPersistence: WallPersistenceRow[];
  liquidationCorroborations: LiquidationCorroboration[];
}

async function getLatestMarketState(): Promise<MarketState | null> {
  const { data, error } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("divergenceRadarContext: Fehler bei market_states:", error.message);
    return null;
  }
  return data;
}

async function getLatestHandelslage(): Promise<HandelslageSnapshot | null> {
  const { data, error } = await supabase
    .from("handelslage_snapshots")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("divergenceRadarContext: Fehler bei handelslage_snapshots:", error.message);
    return null;
  }
  return data;
}

async function getSpotVerdict() {
  const sinceIso = new Date(Date.now() - SPOT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_spot_pressure_summary", { p_since: sinceIso });
  if (error) {
    console.error("divergenceRadarContext: Fehler bei get_spot_pressure_summary:", error.message);
    return null;
  }
  const summary = data?.[0] ?? null;
  if (!summary) return null;

  const sumBuy = summary.sum_taker_buy_vol;
  const sumSell = summary.sum_taker_sell_vol;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const netFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;
  const expectedCandles = Math.max(1, Math.round(SPOT_WINDOW_MINUTES / 5));

  return classifySpotPressure({ netFlowPct, candleCount: summary.candle_count, expectedCandles })
    .verdict;
}

async function getSoprAndPricePosition(): Promise<{
  sopr: number | null;
  distFromHighPct: number | null;
  distFromLowPct: number | null;
}> {
  const [{ data: soprRows }, { data: candleRows }] = await Promise.all([
    supabase
      .from("onchain_snapshots")
      .select("value, status")
      .eq("metric", "sopr")
      .order("timestamp_utc", { ascending: false })
      .limit(1),
    supabase
      .from("candles")
      .select("high, low, close")
      .eq("exchange", EXCHANGE)
      .eq("symbol", SYMBOL)
      .eq("interval", "1d")
      .order("open_time", { ascending: false })
      .limit(30),
  ]);

  const soprRow = soprRows?.[0];
  const sopr = soprRow && soprRow.status === "ok" ? Number(soprRow.value) : null;

  const candles = candleRows ?? [];
  if (candles.length === 0) return { sopr, distFromHighPct: null, distFromLowPct: null };

  const high30d = Math.max(...candles.map((c) => Number(c.high)));
  const low30d = Math.min(...candles.map((c) => Number(c.low)));
  const currentPrice = Number(candles[0].close);

  return {
    sopr,
    distFromHighPct: ((currentPrice - high30d) / high30d) * 100,
    distFromLowPct: ((currentPrice - low30d) / low30d) * 100,
  };
}

async function getWallPersistenceRows(): Promise<WallPersistenceRow[]> {
  const { data, error } = await supabase
    .from("orderbook_snapshots")
    .select("exchange, timestamp_utc, bid_wall_price, ask_wall_price")
    .eq("symbol", SYMBOL)
    .order("timestamp_utc", { ascending: false })
    .limit(30);

  if (error) {
    console.error("divergenceRadarContext: Fehler bei orderbook_snapshots (Persistenz):", error.message);
    return [];
  }

  const byExchange = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = byExchange.get(row.exchange) ?? [];
    if (list.length < 2) list.push(row);
    byExchange.set(row.exchange, list);
  }

  const rows: WallPersistenceRow[] = [];
  for (const [exchange, snapshots] of byExchange) {
    const [current, previous] = snapshots;
    rows.push({
      exchange,
      bidWallPersistence: computeWallPersistence(
        current?.bid_wall_price ?? null,
        previous?.bid_wall_price ?? null
      ),
      askWallPersistence: computeWallPersistence(
        current?.ask_wall_price ?? null,
        previous?.ask_wall_price ?? null
      ),
    });
  }
  return rows;
}

async function getLiquidationCorroborations(
  clusters: { price: number; side: "long" | "short" }[]
): Promise<LiquidationCorroboration[]> {
  if (clusters.length === 0) return [];

  const sinceIso = new Date(Date.now() - RECENT_LIQUIDATIONS_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("liquidation_events")
    .select("price, event_time_utc, side")
    .eq("symbol", SYMBOL)
    .gte("event_time_utc", sinceIso)
    .order("event_time_utc", { ascending: false })
    .limit(300);

  if (error) {
    console.error("divergenceRadarContext: Fehler bei liquidation_events:", error.message);
    return [];
  }

  const events = (data ?? []).filter((e) => e.price !== null);
  const results: LiquidationCorroboration[] = [];
  for (const cluster of clusters) {
    // Longs werden bei fallendem Preis liquidiert (side="long" in
    // liquidation_events), Shorts bei steigendem -- dieselbe Konvention wie
    // lib/leverageMap.ts.
    const relevantEvents = events.filter((e) => e.side === cluster.side);
    const match = findCorroboratingLiquidation(cluster.price, relevantEvents);
    if (match) {
      results.push({
        clusterPrice: cluster.price,
        side: cluster.side,
        liquidationPrice: match.price!,
        liquidationTime: match.event_time_utc,
      });
    }
  }
  return results;
}

export async function buildDivergenceRadar(): Promise<DivergenceRadarResult> {
  const [marketState, handelslage, spotVerdict, cycleIndicators, onchain, wallPersistence, leverageMap] =
    await Promise.all([
      getLatestMarketState(),
      getLatestHandelslage(),
      getSpotVerdict(),
      buildCycleIndicators(),
      getSoprAndPricePosition(),
      getWallPersistenceRows(),
      buildLiveLeverageMap(),
    ]);

  const clusters = (leverageMap?.clusters ?? []).map((c) => ({ price: c.price, side: c.side }));
  const liquidationCorroborations = await getLiquidationCorroborations(clusters);

  return {
    optionsVsSentiment: marketState ? computeOptionsVsSentimentDivergence(marketState) : "NOT_COMPARABLE",
    spotVsFutures:
      marketState && spotVerdict ? computeSpotVsFuturesDivergence(spotVerdict, marketState) : "NOT_COMPARABLE",
    cycleVsMomentum:
      marketState && cycleIndicators.logPriceChannel
        ? computeCycleVsMomentumDivergence(cycleIndicators.logPriceChannel.currentBandLabel, marketState)
        : "NOT_COMPARABLE",
    handelslageVsState: computeHandelslageVsStateDivergence(
      handelslage?.status === "ok" ? handelslage.result?.bias : undefined,
      marketState?.overall_state ?? null
    ),
    onchainVsPrice: computeOnchainVsPriceDivergence(
      onchain.sopr,
      onchain.distFromHighPct,
      onchain.distFromLowPct
    ),
    wallPersistence,
    liquidationCorroborations,
  };
}
