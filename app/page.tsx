import { Suspense } from "react";
import { NEWS_TILE_CATEGORIES } from "@/lib/newsCategories";
import { supabase } from "@/lib/supabase";
import { fetchPriceReferences } from "@/lib/priceChanges";
import { getChartStructureData } from "@/lib/chartStructureContext";
import { evaluateFourHourBreakout, fetchLastClosed4h } from "@/lib/fourHourBreakout";
import { dailyTrendFromMtf } from "@/lib/zones";
import ZonesCard from "@/components/ZonesCard";
import { fetchRegimeMatrix, regimeIntervalFor } from "@/lib/regimeTimeframe";
import type {
  DashboardPollBundle,
  EconomicCalendarEvent,
  EscalationSnapshot,
  EtfFlowDay,
  MarketSeriesPoint,
  MarketSnapshot,
  MarketState,
  MarketStateMatrix,
  SystemBriefingConfig,
  SystemBriefingSnapshot,
  NewsEvent,
  OiChangeByExchange,
  OrderbookWallSnapshot,
  SignalReviewSnapshot,
  ShortTermRangeCheck,
  TradeDebateSnapshot,
  TradingViewSignal,
  YoutubeVideoAnalysis,
} from "@/lib/types";
import { getTimeframe, parseTimeframe, type TimeframeId } from "@/lib/timeframes";
import { buildLiveLeverageMap } from "@/lib/leverageMapContext";
import { buildCycleIndicators } from "@/lib/cycleIndicatorsContext";
import { buildVolatilitySnapshot } from "@/lib/volatilityContext";
import { buildDivergenceRadar } from "@/lib/divergenceRadarContext";
import { buildConfluenceScore, buildConfluenceSignalDetail } from "@/lib/confluenceScoreContext";
import { buildRegimeScore, buildRegimeSignalDetail } from "@/lib/regimeScoreContext";
import { detectEscalationTriggers } from "@/lib/escalationContext";
import { TRADINGVIEW_SIGNAL_FRESHNESS_HOURS } from "@/lib/tradingViewSignal";
import { DEFAULT_SERIES_EXCHANGE } from "@/lib/exchanges";
import { MTF_TIMEFRAMES, buildMtfDots, type MtfTimeframeDot } from "@/lib/mtfSignal";
import LivePriceDataProvider from "@/components/LivePriceDataProvider";
import OiChangeCard from "@/components/OiChangeCard";
import FundingRateCard from "@/components/FundingRateCard";
import NewsRiskPanel from "@/components/NewsRiskPanel";
import EtfFlowPanel from "@/components/EtfFlowPanel";
import EconomicCalendarPanel from "@/components/EconomicCalendarPanel";
import MarketContextCard from "@/components/MarketContextCard";
import RegimeMatrixCard from "@/components/RegimeMatrixCard";
import QuizTile from "@/components/QuizTile";
import OrderbookWallCard from "@/components/OrderbookWallCard";
import DivergenceRadarCard from "@/components/DivergenceRadarCard";
import ConfluenceScoreCard from "@/components/ConfluenceScoreCard";
import RegimeScoreCard from "@/components/RegimeScoreCard";
import SignalReviewCard from "@/components/SignalReviewCard";
import EscalationCard from "@/components/EscalationCard";
import TradeDebateCard from "@/components/TradeDebateCard";
import SecondOpinionsCard from "@/components/SecondOpinionsCard";
import YoutubeMonitorCard from "@/components/YoutubeMonitorCard";
import { getYoutubeMonitorConfig } from "@/lib/youtubeMonitorContext";
import LeverageMapCard from "@/components/LeverageMapCard";
import CycleIndicatorsCard from "@/components/CycleIndicatorsCard";
import VolatilityCard from "@/components/VolatilityCard";
import TimeframeSelector from "@/components/TimeframeSelector";
import DashboardTabNav from "@/components/DashboardTabNav";
import DashboardPollProvider from "@/components/DashboardPollProvider";
import HeroHeader from "@/components/HeroHeader";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import RefreshButton from "@/components/RefreshButton";

export const revalidate = 0;

const REFERENCE_EXCHANGE = "bybit";
const NEWS_LIMIT = 5;
const NEWS_LOOKBACK_HOURS = 72;
const ETF_FLOW_LIMIT = 10;

// KI-Verlaufslisten/-Snapshots aelter als 6h werden nicht angezeigt: ein
// veralteter Stand (z.B. nach einem gescheiterten Neuversuch) soll als "noch
// nichts Aktuelles" erscheinen statt als aktuell zu wirken. Nur die Anzeige
// ist gefiltert, die Zeilen bleiben in der Datenbank. Nicht auf die
// YouTube-Video-Liste angewendet: Video-Inhalt bleibt ueber Tage relevant.
const STALE_AI_RUN_CUTOFF_HOURS = 6;
function staleAiRunCutoffIso(): string {
  return new Date(Date.now() - STALE_AI_RUN_CUTOFF_HOURS * 60 * 60 * 1000).toISOString();
}
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

// Phase 4: 5-Saeulen-Regime der Market State Matrix Engine (Phase 3, siehe
// Migration add_market_state_matrix_engine). Von market_states getrennte
// Tabelle/Berechnung -- daher eigener Query statt Wiederverwendung von
// getLatestMarketState().
async function getLatestMarketStateMatrix(): Promise<MarketStateMatrix | null> {
  const { data, error } = await supabase
    .from("market_state_matrix")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Market State Matrix:", error.message);
    return null;
  }
  return data;
}

// MTF-Ampel (Klassifikation siehe lib/mtfSignal.ts) -- eine Query je
// Zeitrahmen, damit die selteneren 4H/1D-Zeilen nicht von den haeufigeren
// 15M-Zeilen bei einem gemeinsamen Limit verdraengt werden.
async function getLatestMtfDots(): Promise<MtfTimeframeDot[]> {
  const rows = await Promise.all(
    MTF_TIMEFRAMES.map(async ({ interval }) => {
      const { data, error } = await supabase
        .from("market_features")
        .select("interval, candle_open_time, structure_trend, adx_14")
        .eq("symbol", "BTCUSDT")
        .eq("interval", interval)
        .order("candle_open_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`Fehler beim Laden der MTF-Ampel (${interval}):`, error.message);
        return [interval, null] as const;
      }
      return [interval, data] as const;
    })
  );
  return buildMtfDots(Object.fromEntries(rows));
}

// Kurzfristiger Seitwaerts-Check (Herleitung siehe lib/types.ts::
// ShortTermRangeCheck) -- RPC statt Tabellen-Query, da nur der aktuelle Wert
// gebraucht wird.
async function getShortTermRangeCheck(): Promise<ShortTermRangeCheck | null> {
  const { data, error } = await supabase.rpc("get_short_term_range_check");

  if (error) {
    console.error("Fehler beim Laden des kurzfristigen Seitwaerts-Checks:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

// Juengstes TradingView-Signal der letzten TRADINGVIEW_SIGNAL_FRESHNESS_HOURS
// (webhook-tradingview Edge Function, Tabelle tradingview_signals). Rein
// informatives Kontext-Badge in RegimeMatrixCard -- fliesst NICHT in
// compute-market-state ein.
async function getLatestTradingViewSignal(): Promise<TradingViewSignal | null> {
  const cutoff = new Date(
    Date.now() - TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("tradingview_signals")
    .select("*")
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des TradingView-Signals:", error.message);
    return null;
  }
  return data;
}

// Nur markbewegende Fed-/CPI-News der letzten 72h, max. 5 - bewusst kompakt statt
// einer Rohdaten-Flut.
async function getHighImpactNews(): Promise<NewsEvent[]> {
  const cutoff = new Date(
    Date.now() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("news_events")
    .select("*")
    .eq("is_market_moving", true)
    .in("category", NEWS_TILE_CATEGORIES)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(NEWS_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der News:", error.message);
    return [];
  }

  return data ?? [];
}

// Periodischer KI-Rueckblick: letzter gespeicherter Stand. Reines Lesen --
// neue Laeufe ueber POST /api/signal-review/generate (primaer woechentlich
// vom signal-review-scheduler-Cron).
async function getLatestSignalReview(): Promise<SignalReviewSnapshot | null> {
  const { data, error } = await supabase
    .from("signal_review_snapshots")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des periodischen Rueckblicks:", error.message);
    return null;
  }
  return data;
}

// Eskalation (Teil der Kachel "Zweitmeinungen"): letzter gespeicherter
// Stand. Reines Lesen -- ein neuer Lauf nur ueber POST /api/escalation/generate.
async function getLatestEscalation(): Promise<EscalationSnapshot | null> {
  const { data, error } = await supabase
    .from("escalation_snapshots")
    .select("*")
    .gte("generated_at", staleAiRunCutoffIso())
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Eskalations-Auswertung:", error.message);
    return null;
  }
  return data;
}

// Trade-Debate (Teil der Kachel "Zweitmeinungen"): letzter gespeicherter
// Stand. Reines Lesen -- ein neuer Lauf nur ueber POST /api/trade-debate/generate.
async function getLatestTradeDebate(): Promise<TradeDebateSnapshot | null> {
  const { data, error } = await supabase
    .from("trade_debate_snapshots")
    .select("*")
    .gte("generated_at", staleAiRunCutoffIso())
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Trade-Debate-Auswertung:", error.message);
    return null;
  }
  return data;
}

// Krypto-YouTube-Monitor: letzte gespeicherte Analysen. Reines Lesen --
// neue Laeufe nur ueber POST /api/youtube-monitor/generate.
async function getLatestYoutubeAnalyses(): Promise<YoutubeVideoAnalysis[]> {
  // 40 statt 8: der Kanal-Vergleich (lib/youtubeConsensus.ts) braucht von
  // JEDEM konfigurierten Kanal die neueste Analyse -- bei 8 wuerde ein
  // besonders aktiver Kanal die anderen verdraengen. Die sichtbare Liste in
  // YoutubeMonitorCard bleibt auf die juengsten 8 begrenzt. Zusaetzlich auf
  // die letzten 2 Tage begrenzt, damit alte Videos nicht auftauchen.
  const twoDaysAgoIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("youtube_video_analyses")
    .select("*")
    .gte("published_at", twoDaysAgoIso)
    .order("published_at", { ascending: false })
    .limit(40);

  if (error) {
    console.error("Fehler beim Laden der YouTube-Analysen:", error.message);
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

async function getUpcomingEconomicEvents(): Promise<EconomicCalendarEvent[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("economic_calendar_events")
    .select("*")
    .gte("event_date", todayIso)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden des Wirtschaftskalenders:", error.message);
    return [];
  }
  return data ?? [];
}

// System-Briefing (Kontext siehe lib/systemBriefingContext.ts): letzter
// ERFOLGREICHER Stand, angezeigt im Lagebild (HeroHeader). Ein
// fehlgeschlagener juengerer Lauf soll das letzte gute Fazit nicht
// verdraengen -- das Lagebild markiert es ohnehin als veraltet und stoesst
// neu an. Reines Lesen -- ein neuer Lauf nur ueber POST
// /api/system-briefing/generate.
async function getLatestSystemBriefing(): Promise<SystemBriefingSnapshot | null> {
  const { data, error } = await supabase
    .from("system_briefings")
    .select("*")
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des System-Briefings:", error.message);
    return null;
  }
  return data;
}

// Zeitplan/E-Mail/Push des Briefings (eine Zeile, siehe
// app/api/system-briefing/config/route.ts).
async function getSystemBriefingConfig(): Promise<SystemBriefingConfig | null> {
  const { data, error } = await supabase.from("system_briefing_config").select("*").eq("id", 1).maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Briefing-Zeitplans:", error.message);
    return null;
  }
  return data;
}

const ORDERBOOK_EXCHANGES = ["binance", "bybit", "okx"] as const;

// Nutzer-Wunsch nach einer "Bookmap"-Ansicht: kein Live-L2-Feed (siehe
// Kommentar in OrderbookWallCard.tsx), aber die bereits erfasste groesste
// Wand je Seite/Boerse -- reines Lesen, kein Live-Feed, alle 5 Min neu von
// collect-orderbook geschrieben.
async function getLatestOrderbookWalls(): Promise<OrderbookWallSnapshot[]> {
  const { data, error } = await supabase
    .from("orderbook_snapshots")
    .select(
      "exchange, timestamp_utc, mid_price, depth_imbalance, bid_wall_price, bid_wall_usd, ask_wall_price, ask_wall_usd, bid_depth_usd, ask_depth_usd, status"
    )
    .eq("symbol", "BTCUSDT")
    .order("timestamp_utc", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Fehler beim Laden der Orderbuch-Waende:", error.message);
    return [];
  }

  // limit(20) deckt mehrere Erfassungszyklen ab, falls eine Boerse
  // zwischenzeitlich fehlschlug -- pro Boerse wird nur die neueste Zeile
  // behalten.
  const latestByExchange = new Map<string, OrderbookWallSnapshot>();
  for (const row of (data ?? []) as OrderbookWallSnapshot[]) {
    if (!latestByExchange.has(row.exchange)) latestByExchange.set(row.exchange, row);
  }
  return ORDERBOOK_EXCHANGES.map((ex) => latestByExchange.get(ex)).filter(
    (row): row is OrderbookWallSnapshot => Boolean(row)
  );
}

// Serverseitig heruntergesamplete Preis/OI-Zeitreihe fuer den Standard-
// Zeitraum, ueber dieselbe RPC wie der Client-Poll in LivePriceDataProvider.tsx
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
// wie der Client-Poll in LivePriceDataProvider.tsx -- versteht auch "aggregated"
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

const DASHBOARD_BUNDLE_MAX_POINTS = 500;

// Serverseitig dieselbe RPC wie der Client-Poll (DashboardPollProvider) --
// liefert die initialen Werte fuer MarketContextCard/SpotPressurePanel und
// den "Positionierung"-Faktor in HeroHeader in einem Aufruf.
async function getDashboardPollBundle(
  sinceIso: string
): Promise<DashboardPollBundle | null> {
  const { data, error } = await supabase.rpc("get_dashboard_poll_bundle", {
    p_since: sinceIso,
    p_max_points: DASHBOARD_BUNDLE_MAX_POINTS,
  });
  if (error) {
    console.error("Fehler beim Laden des Dashboard-Poll-Bundles:", error.message);
    return null;
  }
  return (data as DashboardPollBundle | null) ?? null;
}

// OI-Change% je Boerse fuer denselben Zeitraum wie die uebrige Seite --
// gleiche RPC wie der Client-Poll in LivePriceDataProvider.tsx.
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
  // Zeitraeume mehr (vorher: LivePriceDataProvider, SpotPressurePanel und
  // MarketContextCard hatten je einen eigenen, nicht synchronisierten
  // Zeitraum-Zustand).
  const { tf } = await searchParams;
  const timeframe = parseTimeframe(tf);
  const timeframeSinceIsoValue = timeframeSinceIso(timeframe);

  const [
    snapshots,
    marketState,
    marketStateMatrix,
    mtfDots,
    shortTermRangeCheck,
    highImpactNews,
    recentEtfFlows,
    upcomingEconomicEvents,
    latestLeverageMap,
    cycleIndicators,
    latestOrderbookWalls,
    divergenceRadar,
    confluenceScore,
    confluenceSignalDetail,
    regimeScore,
    regimeSignalDetail,
    latestSignalReview,
    escalationTriggers,
    latestEscalation,
    latestTradeDebate,
    latestSystemBriefing,
    systemBriefingConfig,
    latestYoutubeAnalyses,
    youtubeMonitorConfig,
    oiSeriesData,
    oiReferenceSnapshot,
    dashboardBundle,
    oiByExchange,
    latestTradingViewSignal,
    priceReferences,
    regimeMatrixForTimeframe,
    volatilitySnapshot,
    chartStructure,
    last4h,
  ] = await Promise.all([
    getSnapshotHistory(),
    getLatestMarketState(),
    getLatestMarketStateMatrix(),
    getLatestMtfDots(),
    getShortTermRangeCheck(),
    getHighImpactNews(),
    getRecentEtfFlows(),
    getUpcomingEconomicEvents(),
    buildLiveLeverageMap(),
    buildCycleIndicators(),
    getLatestOrderbookWalls(),
    buildDivergenceRadar(),
    buildConfluenceScore(),
    buildConfluenceSignalDetail(),
    buildRegimeScore(),
    buildRegimeSignalDetail(),
    getLatestSignalReview(),
    detectEscalationTriggers(),
    getLatestEscalation(),
    getLatestTradeDebate(),
    getLatestSystemBriefing(),
    getSystemBriefingConfig(),
    getLatestYoutubeAnalyses(),
    getYoutubeMonitorConfig(),
    getMarketSeries(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getOiReferenceSnapshot(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getDashboardPollBundle(timeframeSinceIsoValue),
    getOiChangeByExchange(timeframeSinceIsoValue),
    getLatestTradingViewSignal(),
    fetchPriceReferences(),
    fetchRegimeMatrix(regimeIntervalFor(timeframe)),
    buildVolatilitySnapshot(),
    getChartStructureData(),
    fetchLastClosed4h(),
  ]);

  // Fallback, falls das Bundle-RPC fehlschlaegt (z.B. kurzzeitiger DB-
  // Aussetzer) -- MarketContextCard/SpotPressurePanel und der
  // "Positionierung"-Faktor in HeroHeader zeigen dann ihre jeweiligen
  // "keine Daten"-Zustaende, statt dass die ganze Seite abstuerzt. Der
  // naechste 60s-Poll im DashboardPollProvider versucht es erneut.
  const initialDashboardBundle: DashboardPollBundle = dashboardBundle ?? {
    oi_series: [],
    oi_reference: null,
    spot_summary: null,
    spot_series: [],
    exchange_first_seen: [],
    positioning_binance: null,
    positioning_bybit: null,
    positioning_okx: null,
    positioning_bitget: null,
    positioning_signal: null,
  };

  // Lage oben und Hintergrund-Kachel im Reiter Marktkontext teilen dieselben Daten.
  const heroProps = {
    initialState: marketState,
    initialRegime: marketStateMatrix?.regime ?? null,
    timeframe,
    recentEtfFlows,
    initialSystemBriefing: latestSystemBriefing,
    initialBriefingConfig: systemBriefingConfig,
    upcomingEconomicEvents,
    initialMtfDots: mtfDots,
    initialPriceReferences: priceReferences,
    keyLevels: chartStructure.keyLevels.map(({ price, side }) => ({ price, side })),
    setupScore: confluenceScore,
    regimeScore,
    scoreDetails: (
      <div className="space-y-3">
        <ConfluenceScoreCard score={confluenceScore} signalDetail={confluenceSignalDetail} />
        <RegimeScoreCard score={regimeScore} signalDetail={regimeSignalDetail} />
      </div>
    ),
  };

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        title="BTC Marktüberwachung"
        current="dashboard"
        actions={
          <>
            <RefreshButton />
          </>
        }
      />

      <section className="flex-1 px-4 sm:px-6 pt-3 pb-8 max-w-3xl lg:max-w-[1600px] w-full mx-auto">
        <div className="space-y-3">
          <DashboardPollProvider
            timeframe={timeframe}
            initialBundle={initialDashboardBundle}
            initialFetchedSinceIso={timeframeSinceIsoValue}
          >
            {/* Zeitraum ist eine globale Steuerung (wirkt auf mehrere Kacheln
                unten) und steht deshalb vor dem Lagebild, nicht hinter einem
                Klick versteckt. */}
            <div className="flex items-center" aria-label="Zeitraum">
              <Suspense fallback={<div className="h-6" />}>
                <TimeframeSelector current={timeframe} />
              </Suspense>
            </div>

            <LivePriceDataProvider
                timeframe={timeframe}
                initialSnapshots={snapshots}
                initialMarketState={marketState}
                initialSeriesData={oiSeriesData}
                initialReferenceSnapshot={oiReferenceSnapshot}
                initialFetchedSinceIso={timeframeSinceIsoValue}
                initialOiByExchange={oiByExchange}
              >
                {/* HeroHeader rendert "1 · Lage", danach afterLage (Zonen).
                    Scores und KI-Bericht stehen als Kachel "lage-hintergrund"
                    im Reiter Marktkontext. Sitzt innerhalb von
                    LivePriceDataProvider, um den Live-Preis zu zeigen. */}
                <HeroHeader
                  {...heroProps}
                  afterLage={
                    <ZonesCard
                      keyLevels={chartStructure.keyLevels.map(({ price, side }) => ({ price, side }))}
                      breakout={evaluateFourHourBreakout(
                        chartStructure.keyLevels.map((l) => l.price),
                        last4h[0],
                        last4h[1]
                      )}
                      dailyTrend={dailyTrendFromMtf(mtfDots)}
                    />
                  }
                />

                <DashboardTabNav
                  tiles={{
                    "lage-hintergrund": <HeroHeader {...heroProps} variant="hintergrund" />,
                    "market-context": <MarketContextCard timeframe={timeframe} />,
                    "regime-matrix": (
                      <RegimeMatrixCard
                        timeframe={timeframe}
                        initialMatrix={regimeMatrixForTimeframe.data}
                        initialMtfDots={mtfDots}
                        initialShortTermRangeCheck={shortTermRangeCheck}
                        marketState={marketState}
                        initialTradingViewSignal={latestTradingViewSignal}
                      />
                    ),
                    "economic-calendar": (
                      <EconomicCalendarPanel initialEvents={upcomingEconomicEvents} />
                    ),
                    lernen: <QuizTile />,
                    "leverage-map": <LeverageMapCard map={latestLeverageMap} />,
                    "cycle-indicators": <CycleIndicatorsCard data={cycleIndicators} />,
                    volatility: <VolatilityCard data={volatilitySnapshot} />,
                    "oi-change": <OiChangeCard />,
                    "funding-rate": <FundingRateCard />,
                    "orderbook-walls": <OrderbookWallCard walls={latestOrderbookWalls} />,
                    "divergence-radar": <DivergenceRadarCard radar={divergenceRadar} />,
                    "etf-flow": (
                      <EtfFlowPanel initialFlows={recentEtfFlows} macroNews={highImpactNews} />
                    ),
                    "news-risk": (
                      <NewsRiskPanel initialNews={highImpactNews} />
                    ),
                    "signal-review": <SignalReviewCard initialSnapshot={latestSignalReview} />,
                    "second-opinions": (
                      <SecondOpinionsCard
                        tradeDebate={
                          <TradeDebateCard initialSnapshot={latestTradeDebate} initialMtfDots={mtfDots} />
                        }
                        escalation={
                          <EscalationCard initialTriggers={escalationTriggers} initialSnapshot={latestEscalation} />
                        }
                      />
                    ),
                    "youtube-monitor": (
                      <YoutubeMonitorCard
                        initialAnalyses={latestYoutubeAnalyses}
                        initialConfig={youtubeMonitorConfig}
                      />
                    ),
                  }}
                />
              </LivePriceDataProvider>
          </DashboardPollProvider>
        </div>
      </section>

      <AppFooter />
    </main>
  );
}
