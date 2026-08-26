import { Suspense } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type {
  EtfFlowDay,
  LiquidationEvent,
  MarketCommentary,
  MarketSeriesPoint,
  MarketSnapshot,
  MarketState,
  NewsEvent,
  OiChangeByExchange,
  PositioningSignal,
  PositioningSnapshot,
  SpotPressurePoint,
  SpotPressureSummary,
} from "@/lib/types";
import { getTimeframe, parseTimeframe, type TimeframeId } from "@/lib/timeframes";
import { DEFAULT_SERIES_EXCHANGE } from "@/lib/exchanges";
import LivePricePanel from "@/components/LivePricePanel";
import PositioningPanel from "@/components/PositioningPanel";
import NewsRiskPanel from "@/components/NewsRiskPanel";
import LiquidationPanel from "@/components/LiquidationPanel";
import EtfFlowPanel from "@/components/EtfFlowPanel";
import SpotPressurePanel from "@/components/SpotPressurePanel";
import MarketContextCard from "@/components/MarketContextCard";
import MarketStateCard from "@/components/MarketStateCard";
import TimeframeSelector from "@/components/TimeframeSelector";
import DashboardLayout from "@/components/DashboardLayout";

export const revalidate = 0;

const REFERENCE_EXCHANGE = "bybit";
export const COMPARE_EXCHANGES = ["bybit", "binance", "okx", "bitget", "bitunix", "pionex"];
const NEWS_LIMIT = 5;
const NEWS_LOOKBACK_HOURS = 72;
const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_LIMIT = 300;
const ETF_FLOW_LIMIT = 10;
const SERIES_MAX_POINTS = 500;

// 180 Punkte a 5 Min ~= 15 Std. Historie fuer die Zeitreihen-Charts.
// Nur die Referenzboerse (Bybit), damit sich Kurse mehrerer Boersen nicht
// in einer Zeitreihe vermischen.
async function getSnapshotHistory(limit = 180): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .eq("exchange", REFERENCE_EXCHANGE)
    .order("timestamp_utc", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Fehler beim Laden der Snapshots:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse();
}

// Letzter bekannter Datenpunkt je Boerse, fuer den Boersenvergleich.
async function getLatestPerExchange(): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .in("exchange", COMPARE_EXCHANGES)
    .order("timestamp_utc", { ascending: false })
    .limit(40);

  if (error) {
    console.error("Fehler beim Laden des Boersenvergleichs:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const latestByExchange: MarketSnapshot[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.exchange)) {
      seen.add(row.exchange);
      latestByExchange.push(row);
    }
  }
  return latestByExchange;
}

async function getLatestCommentary(): Promise<MarketCommentary | null> {
  const { data, error } = await supabase
    .from("market_commentary")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Markteinschaetzung:", error.message);
    return null;
  }

  return data;
}

async function getLatestPositioningSnapshot(
  exchange: string
): Promise<PositioningSnapshot | null> {
  const { data, error } = await supabase
    .from("positioning_snapshots")
    .select("*")
    .eq("status", "ok")
    .eq("exchange", exchange)
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `Fehler beim Laden des Positioning-Snapshots (${exchange}):`,
      error.message
    );
    return null;
  }

  return data;
}

async function getLatestMarketState(): Promise<MarketState | null> {
  const { data, error } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des Market State:", error.message);
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
    console.error("Fehler beim Laden des Positioning-Signals:", error.message);
    return null;
  }

  return data;
}

// Nur markbewegende News der letzten 72h, max. 5 - bewusst kompakt statt
// einer Rohdaten-Flut.
async function getHighImpactNews(): Promise<NewsEvent[]> {
  const cutoff = new Date(
    Date.now() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("news_events")
    .select("*")
    .eq("is_market_moving", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(NEWS_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der News:", error.message);
    return [];
  }

  return data ?? [];
}

// Stichprobenerfassung (~25s alle 5 Min je Boerse) -- letzte Fenster fuer
// eine aussagekraeftige Aggregation (Groesse/Richtung/Haeufung).
async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const cutoff = new Date(
    Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(LIQUIDATION_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der Liquidationen:", error.message);
    return [];
  }

  return data ?? [];
}

// Die Quelle wurde von Farside (Scraping) auf SoSoValue (offizielle API)
// umgestellt. Aeltere Farside-Zeilen bleiben als Historie stehen, ein Datum
// kann also kurzzeitig doppelt vorkommen -- pro Datum nur eine Zeile
// behalten, SoSoValue bevorzugt.
function dedupeByDate(rows: EtfFlowDay[], limit: number): EtfFlowDay[] {
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

  if (error) {
    console.error("Fehler beim Laden der ETF-Flows:", error.message);
    return [];
  }

  return dedupeByDate(data ?? [], ETF_FLOW_LIMIT);
}

// Serverseitig heruntergesamplete Preis/OI-Zeitreihe fuer den Standard-
// Zeitraum, ueber dieselbe RPC wie der Client-Poll in LivePricePanel.tsx
// (siehe dortiger Kommentar: PostgREST kappt Antworten hart bei 1000
// Zeilen, daher serverseitiges Downsampling statt einer Tabellenabfrage).
async function getMarketSeries(
  exchange: string,
  sinceIso: string
): Promise<MarketSeriesPoint[]> {
  const { data, error } = await supabase.rpc("get_market_series", {
    p_exchange: exchange,
    p_since: sinceIso,
    p_max_points: SERIES_MAX_POINTS,
  });

  if (error) {
    console.error("Fehler beim Laden der Preis/OI-Zeitreihe:", error.message);
    return [];
  }
  return data ?? [];
}

// Naechstgelegener Datenpunkt vor dem Zeitraumbeginn, fuer die OI-Change%/
// BTC-Change%-Berechnung. Ueber dieselbe get_market_reference_snapshot-RPC
// wie der Client-Poll in LivePricePanel.tsx -- versteht auch "aggregated"
// (OI-Summe ueber alle Boersen) und faellt intern auf den aeltesten
// verfuegbaren Punkt zurueck statt zu approximieren, falls die Historie
// noch nicht so weit zurueckreicht.
async function getOiReferenceSnapshot(
  exchange: string,
  cutoffIso: string
): Promise<{
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
} | null> {
  const { data, error } = await supabase.rpc("get_market_reference_snapshot", {
    p_exchange: exchange,
    p_cutoff: cutoffIso,
  });

  if (error) {
    console.error("Fehler beim Laden des Referenzpunkts:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

function timeframeSinceIso(id: TimeframeId): string {
  return new Date(Date.now() - getTimeframe(id).minutes * 60 * 1000).toISOString();
}

const SPOT_SERIES_MAX_POINTS = 300;

// Exakte Summe (kein Downsampling) fuer den Spot-Pressure-Headline-Wert,
// serverseitig fuer den Standard-Zeitraum -- gleiche RPC wie der Client-Poll
// in SpotPressurePanel.tsx.
async function getSpotPressureSummary(
  sinceIso: string
): Promise<SpotPressureSummary | null> {
  const { data, error } = await supabase.rpc("get_spot_pressure_summary", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden der Spot-Pressure-Summary:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

async function getSpotPressureSeries(sinceIso: string): Promise<SpotPressurePoint[]> {
  const { data, error } = await supabase.rpc("get_spot_pressure_series", {
    p_since: sinceIso,
    p_max_points: SPOT_SERIES_MAX_POINTS,
  });
  if (error) {
    console.error("Fehler beim Laden der Spot-Pressure-Zeitreihe:", error.message);
    return [];
  }
  return data ?? [];
}

// OI-Change% je Boerse fuer denselben Zeitraum wie die uebrige Seite --
// gleiche RPC wie der Client-Poll in LivePricePanel.tsx.
async function getOiChangeByExchange(sinceIso: string): Promise<OiChangeByExchange[]> {
  const { data, error } = await supabase.rpc("get_oi_change_by_exchange", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden der Boersen-OI-Aenderung:", error.message);
    return [];
  }
  return data ?? [];
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tf?: string }>;
}) {
  // Einzige Zeitraum-Quelle fuer die gesamte Seite: der "tf"-URL-Query-Param,
  // gesteuert vom TimeframeSelector unten. BTC-Change, OI-Change, Chart,
  // Spot-Flow und das Marktkontext-Assessment werden alle mit demselben
  // aufgeloesten Zeitraum berechnet -- keine unabhaengigen/versteckten
  // Zeitraeume mehr (vorher: LivePricePanel, SpotPressurePanel und
  // MarketContextCard hatten je einen eigenen, nicht synchronisierten
  // Zeitraum-Zustand).
  const { tf } = await searchParams;
  const timeframe = parseTimeframe(tf);
  const timeframeSinceIsoValue = timeframeSinceIso(timeframe);

  const [
    snapshots,
    commentary,
    exchangeComparison,
    marketState,
    positioningBinance,
    positioningBybit,
    positioningOkx,
    positioningBitget,
    positioningSignal,
    highImpactNews,
    recentLiquidations,
    recentEtfFlows,
    oiSeriesData,
    oiReferenceSnapshot,
    spotPressureSummary,
    spotPressureSeries,
    oiByExchange,
  ] = await Promise.all([
    getSnapshotHistory(),
    getLatestCommentary(),
    getLatestPerExchange(),
    getLatestMarketState(),
    getLatestPositioningSnapshot("binance"),
    getLatestPositioningSnapshot("bybit"),
    getLatestPositioningSnapshot("okx"),
    getLatestPositioningSnapshot("bitget"),
    getLatestPositioningSignal(),
    getHighImpactNews(),
    getRecentLiquidations(),
    getRecentEtfFlows(),
    getMarketSeries(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getOiReferenceSnapshot(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getSpotPressureSummary(timeframeSinceIsoValue),
    getSpotPressureSeries(timeframeSinceIsoValue),
    getOiChangeByExchange(timeframeSinceIsoValue),
  ]);

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-6 py-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-text-faint uppercase">
            Nexus Atlas
          </p>
          <h1 className="text-lg font-semibold text-text mt-1">
            BTC Marktüberwachung
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/reports"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            AI Reports
          </Link>
          <p className="text-xs text-text-faint hidden sm:block">
            Datentakt: alle 5&nbsp;Minuten · Referenz: Bybit
          </p>
        </div>
      </header>

      <section className="flex-1 px-4 sm:px-6 py-8 max-w-3xl w-full mx-auto">
        <div className="space-y-4">
          <MarketStateCard initialState={marketState} />

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-text-faint">
              Zeitraum
            </p>
            <Suspense fallback={<div className="h-6" />}>
              <TimeframeSelector current={timeframe} />
            </Suspense>
          </div>

          <DashboardLayout
            tiles={{
              "market-context": (
                <MarketContextCard
                  timeframe={timeframe}
                  initialOiSeries={oiSeriesData}
                  initialOiReference={oiReferenceSnapshot}
                  initialSpotSummary={spotPressureSummary}
                  initialFetchedSinceIso={timeframeSinceIsoValue}
                />
              ),
              "live-price": (
                <LivePricePanel
                  timeframe={timeframe}
                  initialSnapshots={snapshots}
                  initialCommentary={commentary}
                  initialExchangeComparison={exchangeComparison}
                  initialSeriesData={oiSeriesData}
                  initialReferenceSnapshot={oiReferenceSnapshot}
                  initialFetchedSinceIso={timeframeSinceIsoValue}
                  initialOiByExchange={oiByExchange}
                />
              ),
              "spot-pressure": (
                <SpotPressurePanel
                  timeframe={timeframe}
                  initialSummary={spotPressureSummary}
                  initialSeries={spotPressureSeries}
                />
              ),
              positioning: (
                <PositioningPanel
                  initialBinance={positioningBinance}
                  initialBybit={positioningBybit}
                  initialOkx={positioningOkx}
                  initialBitget={positioningBitget}
                  initialSignal={positioningSignal}
                />
              ),
              liquidations: <LiquidationPanel initialEvents={recentLiquidations} />,
              "etf-flow": (
                <EtfFlowPanel initialFlows={recentEtfFlows} macroNews={highImpactNews} />
              ),
              "news-risk": <NewsRiskPanel initialNews={highImpactNews} />,
            }}
          />
        </div>
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
