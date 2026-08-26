"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  MarketCommentary,
  MarketSeriesPoint,
  MarketSnapshot,
  OiChangeByExchange,
} from "@/lib/types";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PriceOiComparisonChart from "@/components/PriceOiComparisonChart";
import PanelInfo from "@/components/PanelInfo";
import {
  btcPriceInfo,
  oiChangeInfo,
  btcOiChartInfo,
  kurznotizInfo,
  exchangeComparisonInfo,
  exchangeDivergenceInfo,
  fundingRateInfo,
} from "@/lib/panelInfo";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import {
  DEFAULT_SERIES_EXCHANGE,
  SERIES_EXCHANGES,
  getSeriesExchange,
  type SeriesExchangeId,
} from "@/lib/exchanges";

const REFRESH_INTERVAL_MS = 30_000;
const HISTORY_LIMIT = 180; // ~15 Std bei 5-Min-Takt
const REFERENCE_EXCHANGE = "bybit";
const SERIES_MAX_POINTS = 500;
// Referenzpunkt gilt als "kein voller Zeitraum verfuegbar", wenn er mehr als
// 15 Min spaeter liegt als angefragt -- kleine Luecken durch den 5-Min-Takt
// sind normal, ein grosser Abstand bedeutet: noch keine ausreichende Historie.
const HISTORY_GAP_TOLERANCE_MS = 15 * 60 * 1000;
const COMPARE_EXCHANGES = ["bybit", "binance", "okx", "bitget", "bitunix", "pionex"];
const EXCHANGE_LABELS: Record<string, string> = {
  bybit: "Bybit",
  binance: "Binance",
  okx: "OKX",
  bitget: "Bitget",
  bitunix: "Bitunix",
  pionex: "Pionex",
};
// Preisabweichung ab diesem Wert gilt als auffaellig (moeglicher Ausreisser).
const DEVIATION_ALERT_PCT = 0.15;

function formatUsd(value: number | null, decimals = 2) {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("de-CH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(4)}%`;
}

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  return `vor ${hours} Std`;
}

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Heruntergesamplete Zeitreihe fuer den Price/OI-Chart -- ueber die
// get_market_series-RPC statt einer direkten Tabellenabfrage, weil
// PostgREST auf diesem Projekt Antworten hart bei 1000 Zeilen kappt und ein
// 1W/1M-Fenster im 5-Min-Takt das ueberschreiten wuerde (siehe RPC-Kommentar
// in der Migration fuer Details/Beleg).
async function fetchSeries(
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

// Naechstgelegener Datenpunkt VOR dem Zeitraumbeginn, fuer die exakte
// Change%-Berechnung (current vs. historical). Ueber die
// get_market_reference_snapshot-RPC, die auch den Pseudo-Wert "aggregated"
// versteht (OI-Summe ueber alle Boersen zum selben Zeitstempel) und intern
// auf den aeltesten verfuegbaren Punkt zurueckfaellt, falls die Historie
// noch nicht so weit zurueckreicht -- keine Approximation.
async function fetchReferenceSnapshot(
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

interface ReferenceSnapshot {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

// OI-Change% je Boerse fuer denselben Zeitraum, in einer RPC statt N
// Einzelabfragen -- Basis fuer die "OI je Boerse"-Karte (Exchange
// Divergence + UNAVAILABLE-Kennzeichnung fuer Boersen ohne OI-Route).
async function fetchOiChangeByExchange(sinceIso: string): Promise<OiChangeByExchange[]> {
  const { data, error } = await supabase.rpc("get_oi_change_by_exchange", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden der Boersen-OI-Aenderung:", error.message);
    return [];
  }
  return data ?? [];
}

export default function LivePricePanel({
  timeframe,
  initialSnapshots,
  initialCommentary,
  initialExchangeComparison,
  initialSeriesData,
  initialReferenceSnapshot,
  initialFetchedSinceIso,
  initialOiByExchange,
}: {
  // Geteilter Zeitraum, gesteuert vom TimeframeSelector in app/page.tsx (URL-
  // Query-Param "tf") -- kein lokaler Timeframe-State mehr in dieser
  // Komponente, damit OI Change/BTC Change/Chart garantiert denselben
  // Zeitraum verwenden wie SpotPressurePanel und MarketContextCard.
  timeframe: TimeframeId;
  initialSnapshots: MarketSnapshot[];
  initialCommentary: MarketCommentary | null;
  initialExchangeComparison: MarketSnapshot[];
  initialSeriesData: MarketSeriesPoint[];
  initialReferenceSnapshot: ReferenceSnapshot | null;
  initialFetchedSinceIso: string;
  initialOiByExchange: OiChangeByExchange[];
}) {
  // snapshots ist chronologisch aufsteigend (aeltester zuerst) fuer die Charts,
  // ausschliesslich Bybit als Referenzboerse.
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [commentary, setCommentary] = useState(initialCommentary);
  const [exchangeComparison, setExchangeComparison] = useState(
    initialExchangeComparison
  );
  const [isStale, setIsStale] = useState(false);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [seriesExchange, setSeriesExchange] = useState<SeriesExchangeId>(
    DEFAULT_SERIES_EXCHANGE
  );
  const [seriesData, setSeriesData] = useState(initialSeriesData);
  const [referenceSnapshot, setReferenceSnapshot] = useState(
    initialReferenceSnapshot
  );
  const [seriesLoading, setSeriesLoading] = useState(false);
  // Tatsaechlich abgefragte Fensteruntergrenze (nicht mit Date.now() im
  // Render neu berechnet -- render muss pur bleiben). Wird zusammen mit den
  // Daten im Effekt gesetzt und spiegelt exakt das Fenster wider, das
  // wirklich geladen wurde.
  const [fetchedSinceIso, setFetchedSinceIso] = useState(initialFetchedSinceIso);
  const [oiByExchange, setOiByExchange] = useState(initialOiByExchange);
  // Erster Render nutzt die serverseitig vorab geladenen Daten fuer den
  // Standard-Zeitraum (kein Ladeflackern beim initialen Seitenaufruf) --
  // nur ein tatsaechlicher Zeitraum-Wechsel durch den Nutzer loest sofort
  // einen Client-Fetch aus.
  const isFirstRun = useRef(true);
  const isFirstOiByExchangeRun = useRef(true);

  // Eigener, von der Boersen-Auswahl unabhaengiger Effekt: die "OI je
  // Boerse"-Karte zeigt IMMER alle Boersen gleichzeitig, unabhaengig davon,
  // welche im OI-Change-Dropdown ausgewaehlt ist -- haengt daher nur an
  // timeframe, nicht an seriesExchange.
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

  // Eigener Effekt pro Zeitraum+Boerse: aendert sich timeframe (von aussen
  // ueber die URL) oder seriesExchange (lokal), wird die alte Polling-
  // Schleife sauber beendet und eine neue fuer das neue Fenster gestartet
  // (OI Change %, BTC Change % und der Chart haengen alle am selben
  // Zeitraum+Boerse, siehe Vorgabe Punkt 2+3+4). Beim allerersten Mount
  // passen initialSeriesData/initialReferenceSnapshot immer bereits zum
  // aktuellen timeframe-Prop (serverseitig fuer genau diesen Zeitraum
  // geladen) -- nur die Boerse ist rein clientseitiger Zustand, daher der
  // Default-Exchange-Check.
  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);
    const skipImmediateLoad =
      isFirstRun.current && seriesExchange === DEFAULT_SERIES_EXCHANGE;
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
      const [snapshotRes, commentaryRes, comparisonRes] = await Promise.all([
        supabase
          .from("market_snapshots")
          .select("*")
          .eq("status", "ok")
          .eq("exchange", REFERENCE_EXCHANGE)
          .order("timestamp_utc", { ascending: false })
          .limit(HISTORY_LIMIT),
        supabase
          .from("market_commentary")
          .select("*")
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("market_snapshots")
          .select("*")
          .eq("status", "ok")
          .in("exchange", COMPARE_EXCHANGES)
          .order("timestamp_utc", { ascending: false })
          .limit(40),
      ]);

      if (!snapshotRes.error && snapshotRes.data && snapshotRes.data.length > 0) {
        setSnapshots(snapshotRes.data.slice().reverse());
        setLastSyncOk(true);
      } else if (snapshotRes.error) {
        setLastSyncOk(false);
      }

      if (!commentaryRes.error && commentaryRes.data) {
        setCommentary(commentaryRes.data);
      }

      if (!comparisonRes.error && comparisonRes.data) {
        const seen = new Set<string>();
        const latest: MarketSnapshot[] = [];
        for (const row of comparisonRes.data) {
          if (!seen.has(row.exchange)) {
            seen.add(row.exchange);
            latest.push(row);
          }
        }
        setExchangeComparison(latest);
      }
    };

    const interval = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (snapshots.length === 0) return;
    const check = () => {
      const latestMs = new Date(
        snapshots[snapshots.length - 1].timestamp_utc
      ).getTime();
      setIsStale(Date.now() - latestMs > 15 * 60 * 1000);
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [snapshots]);

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];

  if (!latest) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-muted">
        Noch keine Daten vorhanden. Die Pipeline sammelt alle 5 Minuten einen
        neuen BTC-Datenpunkt — schau in Kürze wieder vorbei.
      </div>
    );
  }

  const priceChange =
    previous?.last_price != null && latest.last_price != null
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
  // Wert gegen den echten historischen Referenzpunkt -- niemals approximiert
  // (Vorgabe Punkt 1+10). Der aktuelle Wert kommt bewusst aus dem letzten
  // Punkt von seriesData (nicht aus der oben stehenden Bybit-"latest") --
  // seriesData/referenceSnapshot stammen aus demselben Fetch fuer dieselbe
  // Boerse (auch "aggregated"), so werden nie Werte verschiedener Boersen
  // gemischt. Die RPC liefert bei jedem Downsampling immer den wirklich
  // letzten Datenpunkt (rn = total), daher ist dies exakt der aktuellste Wert.
  const latestSeriesPoint =
    seriesData.length > 0 ? seriesData[seriesData.length - 1] : null;

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
  const referenceMs = referenceSnapshot
    ? new Date(referenceSnapshot.timestamp_utc).getTime()
    : null;
  const hasFullHistory =
    referenceMs !== null && requestedSinceMs !== null
      ? referenceMs <= requestedSinceMs + HISTORY_GAP_TOLERANCE_MS
      : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isStale || !lastSyncOk ? "bg-down" : "bg-up live-dot"
            }`}
            aria-hidden
          />
          <span className={isStale || !lastSyncOk ? "text-down" : "text-text-muted"}>
            {!lastSyncOk
              ? "Sync-Problem — letzte bekannte Daten werden angezeigt"
              : isStale
              ? "Daten veraltet — Pipeline prüfen"
              : "Live"}
          </span>
        </div>
        <span className="text-text-faint">
          Datenpunkt {clockTime(latest.timestamp_utc)} Uhr · {timeAgo(latest.timestamp_utc)}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span
              className="live-dot inline-block h-2 w-2 rounded-full bg-accent"
              aria-hidden
            />
            <span className="text-xs uppercase tracking-[0.15em] text-text-muted">
              {latest.symbol} · {latest.exchange} Perpetual
            </span>
          </div>
          <PanelInfo title="BTC Preis" content={btcPriceInfo} />
        </div>

        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="tabular font-mono text-4xl sm:text-5xl font-semibold text-text">
            ${formatUsd(latest.last_price)}
          </span>
          {priceChange !== null && (
            <span
              className={`tabular text-sm font-medium ${
                isUp ? "text-up font-mono" : "text-down font-mono"
              }`}
            >
              {isUp ? "▲" : "▼"} ${formatUsd(Math.abs(priceChange))}
            </span>
          )}
        </div>

        <p className="text-xs text-text-faint mt-2">
          Aktualisiert {timeAgo(latest.timestamp_utc)}
        </p>

        <div className="mt-5 pt-5 border-t border-border">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-1">
            Preis · letzte {Math.round((priceSeries.length * 5) / 60)} Std
          </p>
          <TimeSeriesChart
            data={priceSeries}
            color="#c99a5b"
            formatValue={(v) => `$${formatUsd(v)}`}
            formatTooltipTime={clockTime}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-1.5">
            <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
              OI Change
            </p>
            <PanelInfo title="OI Change" content={oiChangeInfo(selectedTf.label)} />
          </div>
          <select
            value={seriesExchange}
            onChange={(e) => setSeriesExchange(e.target.value as SeriesExchangeId)}
            className="text-xs rounded-md border border-border bg-surface-raised text-text-muted px-2 py-1 focus:outline-none focus:border-accent/40"
          >
            {SERIES_EXCHANGES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-6 flex-wrap mb-1">
          <div>
            <span
              className={`tabular font-mono text-3xl sm:text-4xl font-semibold ${
                oiChangePct === null
                  ? "text-text-faint"
                  : oiChangePct >= 0
                  ? "text-up"
                  : "text-down"
              }`}
            >
              {formatSignedPct(oiChangePct)}
            </span>
            <p className="text-xs text-text-faint mt-1">
              Open Interest · {selectedExchange.label} · {selectedTf.label}
            </p>
          </div>
          <div>
            <span
              className={`tabular font-mono text-lg font-medium ${
                btcChangePct === null
                  ? "text-text-faint"
                  : btcChangePct >= 0
                  ? "text-up"
                  : "text-down"
              }`}
            >
              {formatSignedPct(btcChangePct)}
            </span>
            <p className="text-xs text-text-faint mt-1">
              BTC Preis · {selectedTf.label}
            </p>
          </div>
        </div>

        {!hasFullHistory && referenceSnapshot && (
          <p className="text-xs text-text-faint mb-3">
            Noch keine volle {selectedTf.label}-Historie — Basis ist der
            älteste verfügbare Datenpunkt ({clockTime(referenceSnapshot.timestamp_utc)}
            {", "}
            {new Date(referenceSnapshot.timestamp_utc).toLocaleDateString("de-CH", {
              day: "2-digit",
              month: "short",
            })}
            ).
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-text-muted uppercase tracking-wide">
              Preis/OI-Vergleich
            </p>
            <PanelInfo title="BTC/OI Chart" content={btcOiChartInfo(selectedTf.label)} />
          </div>
          {seriesLoading ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-text-faint">
              Lade Zeitreihe…
            </div>
          ) : (
            <PriceOiComparisonChart data={seriesData} />
          )}
        </div>
      </div>

      {commentary && (
        <div className="rounded-lg border border-border bg-surface-raised p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
                Kurznotiz (automatisch, Bybit)
              </p>
              <PanelInfo title="Kurznotiz" content={kurznotizInfo} />
            </div>
            <span className="text-xs text-text-faint">
              {timeAgo(commentary.generated_at)}
            </span>
          </div>
          <p className="text-sm text-text leading-relaxed">
            {commentary.summary_text}
          </p>
          <p className="text-xs text-text-faint mt-2">
            Unabhängig vom oben gewählten Zeitraum — feste, rollierende
            Kurzbetrachtung, alle 5 Minuten neu generiert. Für eine
            zeitraum-synchrone Einordnung siehe &bdquo;Marktkontext&ldquo; oben.
          </p>
        </div>
      )}

      {exchangeComparison.length > 1 && (
        <ExchangeComparisonCard snapshots={exchangeComparison} />
      )}

      <ExchangeOiDivergenceCard entries={oiByExchange} tfLabel={selectedTf.label} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Mark Price" value={`$${formatUsd(latest.mark_price)}`} />
        <Stat
          label="Index Price"
          value={`$${formatUsd(latest.index_price)}`}
        />
        <Stat
          label="Funding Rate"
          value={formatPercent(latest.funding_rate)}
        />
        <Stat
          label="Open Interest"
          value={`${formatUsd(latest.open_interest, 2)} BTC`}
        />
        <Stat
          label="Open Interest (USD)"
          value={`$${formatUsd(latest.open_interest_usd, 0)}`}
        />
        <Stat
          label="Nächstes Funding"
          value={
            latest.next_funding_time_utc
              ? clockTime(latest.next_funding_time_utc)
              : "—"
          }
        />
      </div>

      <div className="grid gap-3">
        <ChartCard
          title="Funding Rate (%)"
          info={<PanelInfo title="Funding Rate" content={fundingRateInfo} />}
        >
          <TimeSeriesChart
            data={fundingSeries}
            color="#4fae7c"
            formatValue={(v) => `${v.toFixed(4)}%`}
            formatTooltipTime={clockTime}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function ExchangeComparisonCard({ snapshots }: { snapshots: MarketSnapshot[] }) {
  const reference = snapshots.find((s) => s.exchange === REFERENCE_EXCHANGE);
  const refPrice = reference?.last_price ?? null;

  // In fester Reihenfolge anzeigen, unabhaengig davon in welcher Reihenfolge
  // die Zeilen aus der DB kamen.
  const ordered = COMPARE_EXCHANGES.map((ex) =>
    snapshots.find((s) => s.exchange === ex)
  ).filter((s): s is MarketSnapshot => Boolean(s));

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Börsenvergleich
        </p>
        <PanelInfo title="Börsenvergleich" content={exchangeComparisonInfo} />
      </div>
      <div className="space-y-2">
        {ordered.map((s) => {
          const deviationPct =
            refPrice && s.last_price !== null && s.exchange !== REFERENCE_EXCHANGE
              ? ((s.last_price - refPrice) / refPrice) * 100
              : null;
          const isOutlier =
            deviationPct !== null && Math.abs(deviationPct) >= DEVIATION_ALERT_PCT;

          return (
            <div
              key={s.exchange}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-text-muted w-20 flex-shrink-0">
                {EXCHANGE_LABELS[s.exchange] ?? s.exchange}
              </span>
              <span className="tabular font-mono text-text flex-1 text-right">
                {s.last_price !== null ? `$${formatUsd(s.last_price)}` : "—"}
              </span>
              <span
                className={`tabular font-mono text-xs w-20 text-right ${
                  isOutlier ? "text-down" : "text-text-faint"
                }`}
              >
                {deviationPct !== null
                  ? `${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(2)}%`
                  : s.exchange === REFERENCE_EXCHANGE
                  ? "Referenz"
                  : "—"}
              </span>
              <span className="tabular font-mono text-xs text-text-faint w-16 text-right">
                {s.funding_rate !== null
                  ? `${(s.funding_rate * 100).toFixed(3)}%`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-faint mt-3">
        Abweichung vs. Bybit (Referenz) · rechts: Funding Rate je Börse. Bitunix
        liefert öffentlich kein Open Interest.
      </p>
    </div>
  );
}

// Zeigt OI-Change% je Boerse fuer denselben Zeitraum wie der Rest der
// Seite -- macht sichtbar, welche Boersen tatsaechlich zur "Aggregiert"-
// Summe im OI-Change-Kachel oben beitragen (Vorgabe: Exchange Divergence,
// "welche Boerse treibt eine Bewegung"). Bitunix wird explizit als
// "UNAVAILABLE" gefuehrt statt stillschweigend zu fehlen, da diese Boerse
// nachweislich keine oeffentliche OI-Route hat (siehe collect-btc).
function ExchangeOiDivergenceCard({
  entries,
  tfLabel,
}: {
  entries: OiChangeByExchange[];
  tfLabel: string;
}) {
  const byExchange = new Map(entries.map((e) => [e.exchange, e]));
  const anyIncomplete = entries.some((e) => !e.has_full_history);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          OI je Börse · {tfLabel}
        </p>
        <PanelInfo title="OI je Börse" content={exchangeDivergenceInfo(tfLabel)} />
      </div>
      <div className="space-y-2">
        {COMPARE_EXCHANGES.map((ex) => {
          const data = byExchange.get(ex);
          const isUnavailable = ex === "bitunix";

          return (
            <div key={ex} className="flex items-center justify-between text-sm">
              <span className="text-text-muted w-20 flex-shrink-0">
                {EXCHANGE_LABELS[ex] ?? ex}
              </span>
              {isUnavailable ? (
                <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                  UNAVAILABLE
                </span>
              ) : data && data.oi_change_pct !== null ? (
                <span
                  className={`tabular font-mono flex-1 text-right ${
                    data.oi_change_pct >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {formatSignedPct(data.oi_change_pct)}
                  {!data.has_full_history && " *"}
                </span>
              ) : (
                <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                  —
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-faint mt-3">
        Diese Börsen fliessen in &quot;Aggregiert&quot; ein. UNAVAILABLE = Börse
        bietet öffentlich kein Open Interest.
        {anyIncomplete && " * Historie für diesen Zeitraum noch unvollständig."}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">
        {label}
      </p>
      <p className="tabular font-mono text-lg font-medium text-text mt-1">{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  info,
  children,
}: {
  title: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-text-muted uppercase tracking-wide">
          {title}
        </p>
        {info}
      </div>
      {children}
    </div>
  );
}
