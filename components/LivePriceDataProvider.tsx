"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import type {
  AnchoredSummary,
  MarketSeriesPoint,
  MarketSnapshot,
  MarketState,
  OiChangeByExchange,
} from "@/lib/types";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import {
  DEFAULT_SERIES_EXCHANGE,
  getSeriesExchange,
  type SeriesExchangeId,
} from "@/lib/exchanges";

// Gemeinsamer State/Polling fuer die aus der ehemaligen LivePricePanel.tsx
// hervorgegangenen Kacheln (BtcPriceCard, OiChangeCard, KurznotizCard,
// OiByExchangeCard, FundingRateCard) -- Nutzer-Feedback 05.09.2026: "ich
// kann noch nicht alle Kacheln individuell Groesse einstellen und
// verschieben", konkret die vormals als EINE fullWidth-Kachel gebuendelten
// Preis-/OI-/Funding-Abschnitte. Diese Datei traegt exakt dieselbe Logik
// wie die alte LivePricePanel (unveraendert uebernommen), nur als Context
// statt als eine einzelne Komponente -- jede der 5 Kacheln liest per
// useLivePriceData() nur den Ausschnitt, den sie braucht, bleibt dabei aber
// unabhaengig verschieb-/groessenbar (siehe DashboardLayout.tsx).
//
// Gleiches Prinzip wie DashboardPollProvider.tsx, absichtlich ein EIGENER
// Provider statt Anbindung an dessen 30s-Bundle: die Boersen-Auswahl hier
// ist Nutzer-gesteuert (nicht immer DEFAULT_SERIES_EXCHANGE), siehe
// DashboardPollProvider.tsx-Kommentar zur selben Abwaegung.

const REFRESH_INTERVAL_MS = 30_000;
const HISTORY_LIMIT = 180; // ~15 Std bei 5-Min-Takt
const REFERENCE_EXCHANGE = "bybit";
const SERIES_MAX_POINTS = 500;
// Referenzpunkt gilt als "kein voller Zeitraum verfuegbar", wenn er mehr als
// 15 Min spaeter liegt als angefragt -- kleine Luecken durch den 5-Min-Takt
// sind normal, ein grosser Abstand bedeutet: noch keine ausreichende Historie.
const HISTORY_GAP_TOLERANCE_MS = 15 * 60 * 1000;

// Heruntergesamplete Zeitreihe fuer den Price/OI-Chart -- ueber die
// get_market_series-RPC statt einer direkten Tabellenabfrage, weil
// PostgREST auf diesem Projekt Antworten hart bei 1000 Zeilen kappt und ein
// 1W/1M-Fenster im 5-Min-Takt das ueberschreiten wuerde.
async function fetchSeries(exchange: string, sinceIso: string): Promise<MarketSeriesPoint[]> {
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

interface ReferenceSnapshot {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

// Naechstgelegener Datenpunkt VOR dem Zeitraumbeginn, fuer die exakte
// Change%-Berechnung (current vs. historical). Ueber die
// get_market_reference_snapshot-RPC, die auch den Pseudo-Wert "aggregated"
// versteht und intern auf den aeltesten verfuegbaren Punkt zurueckfaellt,
// falls die Historie noch nicht so weit zurueckreicht -- keine Approximation.
async function fetchReferenceSnapshot(
  exchange: string,
  cutoffIso: string
): Promise<ReferenceSnapshot | null> {
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

// OI-Change% je Boerse fuer denselben Zeitraum, in einer RPC statt N
// Einzelabfragen -- Basis fuer OiByExchangeCard (Exchange Divergence +
// UNAVAILABLE-Kennzeichnung fuer Boersen ohne OI-Route).
async function fetchOiChangeByExchange(sinceIso: string): Promise<OiChangeByExchange[]> {
  const { data, error } = await supabase.rpc("get_oi_change_by_exchange", { p_since: sinceIso });
  if (error) {
    console.error("Fehler beim Laden der Boersen-OI-Aenderung:", error.message);
    return [];
  }
  return data ?? [];
}

export interface LivePriceData {
  hasData: boolean;
  latest: MarketSnapshot | undefined;
  priceChange: number | null;
  isUp: boolean;
  priceSeries: { t: string; v: number }[];
  fundingSeries: { t: string; v: number }[];
  isStale: boolean;
  lastSyncOk: boolean;
  marketState: MarketState | null;

  seriesExchange: SeriesExchangeId;
  setSeriesExchange: (id: SeriesExchangeId) => void;
  seriesData: MarketSeriesPoint[];
  seriesLoading: boolean;
  referenceSnapshot: ReferenceSnapshot | null;
  oiChangePct: number | null;
  btcChangePct: number | null;
  selectedTf: ReturnType<typeof getTimeframe>;
  selectedExchange: ReturnType<typeof getSeriesExchange>;
  hasFullHistory: boolean;

  oiByExchange: OiChangeByExchange[];

  anchorIso: string | null;
  anchoredSummary: AnchoredSummary | null;
}

const LivePriceDataContext = createContext<LivePriceData | null>(null);

export function useLivePriceData(): LivePriceData {
  const ctx = useContext(LivePriceDataContext);
  if (!ctx) {
    throw new Error(
      "useLivePriceData() muss innerhalb von <LivePriceDataProvider> aufgerufen werden."
    );
  }
  return ctx;
}

export default function LivePriceDataProvider({
  timeframe,
  initialSnapshots,
  initialMarketState,
  initialSeriesData,
  initialReferenceSnapshot,
  initialFetchedSinceIso,
  initialOiByExchange,
  anchorIso,
  initialAnchoredSummary,
  children,
}: {
  timeframe: TimeframeId;
  initialSnapshots: MarketSnapshot[];
  // Dieselbe market_states-Zeile wie MarketStateCard (app/page.tsx laedt sie
  // einmal, beide bekommen denselben Wert) -- Kurznotiz ist nur noch eine
  // kompakte Textdarstellung dieser einen Quelle, siehe lib/marketStateSummary.ts.
  initialMarketState: MarketState | null;
  initialSeriesData: MarketSeriesPoint[];
  initialReferenceSnapshot: ReferenceSnapshot | null;
  initialFetchedSinceIso: string;
  initialOiByExchange: OiChangeByExchange[];
  // Phase 1 "Anchored Analytics": null, solange kein Event-Anker gesetzt ist.
  anchorIso: string | null;
  initialAnchoredSummary: AnchoredSummary | null;
  children: ReactNode;
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [marketState, setMarketState] = useState(initialMarketState);
  const [isStale, setIsStale] = useState(false);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [seriesExchange, setSeriesExchange] = useState<SeriesExchangeId>(DEFAULT_SERIES_EXCHANGE);
  const [seriesData, setSeriesData] = useState(initialSeriesData);
  const [referenceSnapshot, setReferenceSnapshot] = useState(initialReferenceSnapshot);
  const [seriesLoading, setSeriesLoading] = useState(false);
  // Tatsaechlich abgefragte Fensteruntergrenze (nicht mit Date.now() im
  // Render neu berechnet -- render muss pur bleiben).
  const [fetchedSinceIso, setFetchedSinceIso] = useState(initialFetchedSinceIso);
  const [oiByExchange, setOiByExchange] = useState(initialOiByExchange);
  const [anchoredSummary, setAnchoredSummary] = useState(initialAnchoredSummary);
  const isFirstRun = useRef(true);
  const isFirstOiByExchangeRun = useRef(true);

  // Eigener, von der Boersen-Auswahl unabhaengiger Effekt: OiByExchangeCard
  // zeigt IMMER alle Boersen gleichzeitig, unabhaengig davon, welche im
  // OI-Change-Dropdown ausgewaehlt ist -- haengt daher nur an timeframe.
  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);
    const skipImmediateLoad = isFirstOiByExchangeRun.current;
    isFirstOiByExchangeRun.current = false;

    const load = async () => {
      const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
      const entries = await fetchOiChangeByExchange(sinceIso);
      if (cancelled) return;
      setOiByExchange(entries);
    };

    if (!skipImmediateLoad) load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [timeframe]);

  // Phase 1 "Anchored Analytics": voellig unabhaengig vom timeframe-Effekt
  // oben -- laedt/aktualisiert den Event-Driven-Kontext nur, wenn ein Anker
  // gesetzt ist.
  useEffect(() => {
    if (!anchorIso) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_anchored_summary", { p_anchor: anchorIso });
      if (cancelled) return;
      if (error) {
        console.error("Fehler beim Laden der Anchored Summary:", error.message);
        return;
      }
      setAnchoredSummary(data ?? null);
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [anchorIso]);

  // Eigener Effekt pro Zeitraum+Boerse: aendert sich timeframe (von aussen
  // ueber die URL) oder seriesExchange (lokal), wird die alte Polling-
  // Schleife sauber beendet und eine neue fuer das neue Fenster gestartet.
  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);
    const skipImmediateLoad = isFirstRun.current && seriesExchange === DEFAULT_SERIES_EXCHANGE;
    isFirstRun.current = false;

    // showLoading nur beim allerersten Laden eines Zeitraums true -- sonst
    // wuerde jeder 30s-Hintergrund-Refresh den Chart kurz durch den
    // "Lade..."-Platzhalter ersetzen (Flackern).
    const load = async (showLoading: boolean) => {
      if (showLoading) setSeriesLoading(true);
      const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
      const [series, reference] = await Promise.all([
        fetchSeries(seriesExchange, sinceIso),
        fetchReferenceSnapshot(seriesExchange, sinceIso),
      ]);
      if (cancelled) return;
      setSeriesData(series);
      setReferenceSnapshot(reference);
      setFetchedSinceIso(sinceIso);
      setSeriesLoading(false);
    };

    if (!skipImmediateLoad) load(true);
    const interval = setInterval(() => load(false), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [timeframe, seriesExchange]);

  useEffect(() => {
    const fetchLatest = async () => {
      const [snapshotRes, marketStateRes] = await Promise.all([
        supabase
          .from("market_snapshots")
          .select("*")
          .eq("status", "ok")
          .eq("exchange", REFERENCE_EXCHANGE)
          .order("timestamp_utc", { ascending: false })
          .limit(HISTORY_LIMIT),
        supabase
          .from("market_states")
          .select("*")
          .order("timestamp_utc", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!snapshotRes.error && snapshotRes.data && snapshotRes.data.length > 0) {
        setSnapshots(snapshotRes.data.slice().reverse());
        setLastSyncOk(true);
      } else if (snapshotRes.error) {
        setLastSyncOk(false);
      }

      if (!marketStateRes.error && marketStateRes.data) {
        setMarketState(marketStateRes.data);
      }
    };

    const interval = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (snapshots.length === 0) return;
    const check = () => {
      const latestMs = new Date(snapshots[snapshots.length - 1].timestamp_utc).getTime();
      setIsStale(Date.now() - latestMs > 15 * 60 * 1000);
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [snapshots]);

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];

  const priceChange =
    previous?.last_price != null && latest?.last_price != null
      ? latest.last_price - previous.last_price
      : null;
  const isUp = priceChange !== null && priceChange >= 0;

  const priceSeries = snapshots
    .filter((s) => s.last_price != null)
    .map((s) => ({ t: s.timestamp_utc, v: s.last_price as number }));
  const fundingSeries = snapshots
    .filter((s) => s.funding_rate != null)
    .map((s) => ({ t: s.timestamp_utc, v: (s.funding_rate as number) * 100 }));

  // OI Change % / BTC Change % ueber den gewaehlten Zeitraum+Boerse: aktueller
  // Wert gegen den echten historischen Referenzpunkt -- niemals approximiert.
  // Der aktuelle Wert kommt bewusst aus dem letzten Punkt von seriesData
  // (nicht aus der Bybit-"latest") -- seriesData/referenceSnapshot stammen
  // aus demselben Fetch fuer dieselbe Boerse, so werden nie Werte
  // verschiedener Boersen gemischt.
  const latestSeriesPoint = seriesData.length > 0 ? seriesData[seriesData.length - 1] : null;

  const oiChangePct =
    latestSeriesPoint?.open_interest !== null &&
    latestSeriesPoint?.open_interest !== undefined &&
    referenceSnapshot?.open_interest !== null &&
    referenceSnapshot?.open_interest !== undefined
      ? ((latestSeriesPoint.open_interest - referenceSnapshot.open_interest) /
          referenceSnapshot.open_interest) *
        100
      : null;

  const btcChangePct =
    latestSeriesPoint?.last_price !== null &&
    latestSeriesPoint?.last_price !== undefined &&
    referenceSnapshot?.last_price !== null &&
    referenceSnapshot?.last_price !== undefined
      ? ((latestSeriesPoint.last_price - referenceSnapshot.last_price) /
          referenceSnapshot.last_price) *
        100
      : null;

  const selectedTf = getTimeframe(timeframe);
  const selectedExchange = getSeriesExchange(seriesExchange);
  const requestedSinceMs = fetchedSinceIso ? new Date(fetchedSinceIso).getTime() : null;
  const referenceMs = referenceSnapshot ? new Date(referenceSnapshot.timestamp_utc).getTime() : null;
  const hasFullHistory =
    referenceMs !== null && requestedSinceMs !== null
      ? referenceMs <= requestedSinceMs + HISTORY_GAP_TOLERANCE_MS
      : false;

  const value: LivePriceData = {
    hasData: !!latest,
    latest,
    priceChange,
    isUp,
    priceSeries,
    fundingSeries,
    isStale,
    lastSyncOk,
    marketState,
    seriesExchange,
    setSeriesExchange,
    seriesData,
    seriesLoading,
    referenceSnapshot,
    oiChangePct,
    btcChangePct,
    selectedTf,
    selectedExchange,
    hasFullHistory,
    oiByExchange,
    anchorIso,
    anchoredSummary,
  };

  return <LivePriceDataContext.Provider value={value}>{children}</LivePriceDataContext.Provider>;
}

// Gemeinsamer Platzhalter, bevor der allererste Datenpunkt eintrifft --
// jede der 5 Kacheln zeigt das unabhaengig statt wie frueher die gesamte
// (damals eine) Kachel durch einen einzigen fruehen Return zu ersetzen.
export function LivePriceEmptyState() {
  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-muted">
      Noch keine Daten vorhanden. Die Pipeline sammelt alle 5 Minuten einen
      neuen BTC-Datenpunkt — schau in Kürze wieder vorbei.
    </div>
  );
}
