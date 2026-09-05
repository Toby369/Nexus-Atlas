import { Suspense } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type {
  AnchoredSummary,
  DashboardPollBundle,
  EconomicCalendarEvent,
  EtfFlowDay,
  LiquidationEvent,
  MarketSeriesPoint,
  MarketSnapshot,
  MarketState,
  MarketStateMatrix,
  NewsEvent,
  OiChangeByExchange,
  TradingViewSignal,
} from "@/lib/types";
import { getTimeframe, parseTimeframe, type TimeframeId } from "@/lib/timeframes";
import { parseAnchorParam } from "@/lib/anchor";
import { TRADINGVIEW_SIGNAL_FRESHNESS_HOURS } from "@/lib/tradingViewSignal";
import { DEFAULT_SERIES_EXCHANGE } from "@/lib/exchanges";
import LivePricePanel from "@/components/LivePricePanel";
import PositioningPanel from "@/components/PositioningPanel";
import NewsRiskPanel from "@/components/NewsRiskPanel";
import LiquidationPanel from "@/components/LiquidationPanel";
import EtfFlowPanel from "@/components/EtfFlowPanel";
import EconomicCalendarPanel from "@/components/EconomicCalendarPanel";
import InstitutionalPlaybookCard from "@/components/InstitutionalPlaybookCard";
import SpotPressurePanel from "@/components/SpotPressurePanel";
import MarketContextCard from "@/components/MarketContextCard";
import MarketStateCard from "@/components/MarketStateCard";
import RegimeMatrixCard from "@/components/RegimeMatrixCard";
import TimeframeSelector from "@/components/TimeframeSelector";
import AnchorPicker from "@/components/AnchorPicker";
import DashboardLayout from "@/components/DashboardLayout";
import DashboardPollProvider from "@/components/DashboardPollProvider";
import HeroHeader from "@/components/HeroHeader";
import DetailsToggle from "@/components/DetailsToggle";
import LogoutButton from "@/components/LogoutButton";
import RefreshButton from "@/components/RefreshButton";

export const revalidate = 0;

const REFERENCE_EXCHANGE = "bybit";
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

// ENTFERNT (Single-Source-of-Truth-Merge): fruehere, eigenstaendige,
// regelbasierte market_commentary-Abfrage. Die "Kurznotiz" in
// LivePricePanel.tsx nutzt jetzt denselben marketState-Wert wie
// MarketStateCard (siehe getLatestMarketState() unten), zusammengefasst
// ueber lib/marketStateSummary.ts::buildCompactMarketStateSummary() -- kein
// zweiter, unabhaengiger Rechenweg mehr.

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

// Phase 2 TradingView-Integration (Feasibility-Review vom 29.08.2026): das
// juengste externe Signal der letzten TRADINGVIEW_SIGNAL_FRESHNESS_HOURS,
// empfangen ueber die webhook-tradingview Edge Function
// (tradingview_signals-Tabelle). Rein informatives Kontext-Badge in
// RegimeMatrixCard -- fliesst NICHT in compute-market-state ein.
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

// Phase 1 "Anchored Analytics" (Feasibility-Review vom 29.08.2026): laedt
// den kumulierten Event-Driven-Kontext (Liquidationen/OI/Preis) ab einem
// frei waehlbaren Ankerpunkt -- unabhaengig vom festen "tf"-Zeitraum.
// Frueher Ausstieg ohne DB-Aufruf, wenn kein Anker gesetzt ist (haeufigster
// Fall), statt die RPC unnoetig mit einem null-Parameter aufzurufen.
async function getAnchoredSummary(anchorIso: string | null): Promise<AnchoredSummary | null> {
  if (!anchorIso) return null;

  const { data, error } = await supabase.rpc("get_anchored_summary", {
    p_anchor: anchorIso,
  });

  if (error) {
    console.error("Fehler beim Laden der Anchored Summary:", error.message);
    return null;
  }
  return data ?? null;
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

const DASHBOARD_BUNDLE_MAX_POINTS = 500;

// Serverseitig dieselbe RPC wie der Client-Poll (DashboardPollProvider,
// Phase 2 Punkt 3) -- liefert die initialen Werte fuer MarketContextCard/
// SpotPressurePanel/PositioningPanel in einem Aufruf statt fuenf
// Einzelabfragen (vorher: getOiReferenceSnapshot/getSpotPressureSummary/
// getSpotPressureSeries/getLatestPositioningSnapshot x4/
// getLatestPositioningSignal).
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
  searchParams: Promise<{ tf?: string; anchor?: string }>;
}) {
  // Einzige Zeitraum-Quelle fuer die gesamte Seite: der "tf"-URL-Query-Param,
  // gesteuert vom TimeframeSelector unten. BTC-Change, OI-Change, Chart,
  // Spot-Flow und das Marktkontext-Assessment werden alle mit demselben
  // aufgeloesten Zeitraum berechnet -- keine unabhaengigen/versteckten
  // Zeitraeume mehr (vorher: LivePricePanel, SpotPressurePanel und
  // MarketContextCard hatten je einen eigenen, nicht synchronisierten
  // Zeitraum-Zustand).
  const { tf, anchor } = await searchParams;
  const timeframe = parseTimeframe(tf);
  const timeframeSinceIsoValue = timeframeSinceIso(timeframe);

  // Event-Driven-Anker (Phase 1 "Anchored Analytics"), unabhaengig vom
  // festen Zeitraum oben -- dieselbe server-seitige Aufloesungs-/
  // Weiterreichungs-Logik wie bei "tf" (AnchorPicker schreibt den
  // Roh-Query-Param, hier wird er einmal zentral geparst/validiert und als
  // fertiger ISO-String an LiquidationPanel/LivePricePanel gereicht).
  const anchorDate = parseAnchorParam(anchor);
  const anchorIso = anchorDate ? anchorDate.toISOString() : null;

  const [
    snapshots,
    marketState,
    marketStateMatrix,
    highImpactNews,
    recentLiquidations,
    recentEtfFlows,
    upcomingEconomicEvents,
    oiSeriesData,
    oiReferenceSnapshot,
    dashboardBundle,
    oiByExchange,
    anchoredSummary,
    latestTradingViewSignal,
  ] = await Promise.all([
    getSnapshotHistory(),
    getLatestMarketState(),
    getLatestMarketStateMatrix(),
    getHighImpactNews(),
    getRecentLiquidations(),
    getRecentEtfFlows(),
    getUpcomingEconomicEvents(),
    getMarketSeries(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getOiReferenceSnapshot(DEFAULT_SERIES_EXCHANGE, timeframeSinceIsoValue),
    getDashboardPollBundle(timeframeSinceIsoValue),
    getOiChangeByExchange(timeframeSinceIsoValue),
    getAnchoredSummary(anchorIso),
    getLatestTradingViewSignal(),
  ]);

  // Fallback, falls das Bundle-RPC fehlschlaegt (z.B. kurzzeitiger DB-
  // Aussetzer) -- MarketContextCard/SpotPressurePanel/PositioningPanel
  // zeigen dann ihre jeweiligen "keine Daten"-Zustaende, statt dass die
  // ganze Seite abstuerzt. Der naechste 30s-Poll im DashboardPollProvider
  // versucht es erneut.
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
          <RefreshButton />
          <Link
            href="/reports"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            AI Reports
          </Link>
          <Link
            href="/account"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            Konto
          </Link>
          <p className="text-xs text-text-faint hidden sm:block">
            Datentakt: alle 5&nbsp;Minuten · Referenz: Bybit
          </p>
          <LogoutButton />
        </div>
      </header>

      <section className="flex-1 px-4 sm:px-6 py-8 max-w-3xl lg:max-w-[1600px] w-full mx-auto">
        <div className="space-y-4">
          <DashboardPollProvider
            timeframe={timeframe}
            initialBundle={initialDashboardBundle}
            initialFetchedSinceIso={timeframeSinceIsoValue}
          >
            <HeroHeader
              initialState={marketState}
              initialRegime={marketStateMatrix?.regime ?? null}
              timeframe={timeframe}
              recentEtfFlows={recentEtfFlows}
              recentLiquidations={recentLiquidations}
              highImpactNews={highImpactNews}
              upcomingEconomicEvents={upcomingEconomicEvents}
            />

            <DetailsToggle>
              {/* Nutzer-Feedback vom 04.09.2026: Zeitraum/Event-Anker sind
                  globale Steuerungen (wirken auf mehrere Kacheln unten,
                  siehe timeframe/anchorIso-Props), sollten also vor der
                  Gesamteinschaetzung stehen statt danach -- vorher wirkten
                  sie wie ein Anhaengsel der Gesamteinschaetzung-Kachel. */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs uppercase tracking-[0.2em] text-text-faint">
                  Zeitraum
                </p>
                <Suspense fallback={<div className="h-6" />}>
                  <TimeframeSelector current={timeframe} />
                </Suspense>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs uppercase tracking-[0.2em] text-text-faint">
                  Event-Anker
                </p>
                <Suspense fallback={<div className="h-6" />}>
                  <AnchorPicker />
                </Suspense>
              </div>

              <MarketStateCard initialState={marketState} />

              <DashboardLayout
                tiles={{
                  "market-context": <MarketContextCard timeframe={timeframe} />,
                  "regime-matrix": (
                    <RegimeMatrixCard
                      initialMatrix={marketStateMatrix}
                      marketState={marketState}
                      initialTradingViewSignal={latestTradingViewSignal}
                      anchorIso={anchorIso}
                      initialAnchoredSummary={anchoredSummary}
                    />
                  ),
                  "economic-calendar": (
                    <EconomicCalendarPanel initialEvents={upcomingEconomicEvents} />
                  ),
                  "live-price": (
                    <LivePricePanel
                      timeframe={timeframe}
                      initialSnapshots={snapshots}
                      initialMarketState={marketState}
                      initialSeriesData={oiSeriesData}
                      initialReferenceSnapshot={oiReferenceSnapshot}
                      initialFetchedSinceIso={timeframeSinceIsoValue}
                      initialOiByExchange={oiByExchange}
                      anchorIso={anchorIso}
                      initialAnchoredSummary={anchoredSummary}
                    />
                  ),
                  "spot-pressure": <SpotPressurePanel timeframe={timeframe} />,
                  positioning: <PositioningPanel />,
                  liquidations: (
                    <LiquidationPanel
                      initialEvents={recentLiquidations}
                      anchorIso={anchorIso}
                      initialAnchoredSummary={anchoredSummary}
                    />
                  ),
                  "etf-flow": (
                    <EtfFlowPanel initialFlows={recentEtfFlows} macroNews={highImpactNews} />
                  ),
                  "news-risk": <NewsRiskPanel initialNews={highImpactNews} />,
                  "institutional-playbook": <InstitutionalPlaybookCard />,
                }}
              />
            </DetailsToggle>
          </DashboardPollProvider>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
