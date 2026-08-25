"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  MarketCommentary,
  MarketSeriesPoint,
  MarketSnapshot,
} from "@/lib/types";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PriceOiComparisonChart from "@/components/PriceOiComparisonChart";
import {
  DEFAULT_TIMEFRAME,
  TIMEFRAMES,
  getTimeframe,
  type TimeframeId,
} from "@/lib/timeframes";

const REFRESH_INTERVAL_MS = 30_000;
const HISTORY_LIMIT = 180; // ~15 Std bei 5-Min-Takt
const REFERENCE_EXCHANGE = "bybit";
const SERIES_MAX_POINTS = 500;
// Referenzpunkt gilt als "kein voller Zeitraum verfuegbar", wenn er mehr als
// 15 Min spaeter liegt als angefragt -- kleine Luecken durch den 5-Min-Takt
// sind normal, ein grosser Abstand bedeutet: noch keine ausreichende Historie.
const HISTORY_GAP_TOLERANCE_MS = 15 * 60 * 1000;
const COMPARE_EXCHANGES = ["bybit", "binance", "bitunix", "pionex"];
const EXCHANGE_LABELS: Record<string, string> = {
  bybit: "Bybit",
  binance: "Binance",
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
// Change%-Berechnung (current vs. historical). Braucht nur eine Zeile, daher
// nie vom PostgREST-Row-Cap betroffen.
async function fetchReferenceSnapshot(
  exchange: string,
  cutoffIso: string
): Promise<{
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
} | null> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("timestamp_utc, last_price, open_interest")
    .eq("status", "ok")
    .eq("exchange", exchange)
    .lte("timestamp_utc", cutoffIso)
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) return data;

  // Noch keine Historie so weit zurueck (z.B. 1M kurz nach Projektstart) --
  // aeltesten tatsaechlich vorhandenen Punkt nehmen statt zu approximieren.
  // Wird im UI transparent mit dem echten Zeitstempel gekennzeichnet.
  const fallback = await supabase
    .from("market_snapshots")
    .select("timestamp_utc, last_price, open_interest")
    .eq("status", "ok")
    .eq("exchange", exchange)
    .order("timestamp_utc", { ascending: true })
    .limit(1)
    .maybeSingle();

  return fallback.data ?? null;
}

export default function LivePricePanel({
  initialSnapshots,
  initialCommentary,
  initialExchangeComparison,
}: {
  initialSnapshots: MarketSnapshot[];
  initialCommentary: MarketCommentary | null;
  initialExchangeComparison: MarketSnapshot[];
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
  const [timeframe, setTimeframe] = useState<TimeframeId>(DEFAULT_TIMEFRAME);
  const [seriesData, setSeriesData] = useState<MarketSeriesPoint[]>([]);
  const [referenceSnapshot, setReferenceSnapshot] = useState<{
    timestamp_utc: string;
    last_price: number | null;
    open_interest: number | null;
  } | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  // Tatsaechlich abgefragte Fensteruntergrenze (nicht mit Date.now() im
  // Render neu berechnet -- render muss pur bleiben). Wird zusammen mit den
  // Daten im Effekt gesetzt und spiegelt exakt das Fenster wider, das
  // wirklich geladen wurde.
  const [fetchedSinceIso, setFetchedSinceIso] = useState<string | null>(null);

  // Eigener Effekt pro Zeitraum: aendert sich timeframe, wird die alte
  // Polling-Schleife sauber beendet und eine neue fuer das neue Fenster
  // gestartet (OI Change %, BTC Change % und der Chart haengen alle am
  // selben Zeitraum, siehe Vorgabe Punkt 2+3).
  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);

    // showLoading nur beim allerersten Laden eines Zeitraums true -- sonst
    // wuerde jeder 30s-Hintergrund-Refresh den Chart kurz durch den
    // "Lade..."-Platzhalter ersetzen (Flackern).
    const load = async (showLoading: boolean) => {
      if (showLoading) setSeriesLoading(true);
      const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
      const [series, reference] = await Promise.all([
        fetchSeries(REFERENCE_EXCHANGE, sinceIso),
        fetchReferenceSnapshot(REFERENCE_EXCHANGE, sinceIso),
      ]);
      if (cancelled) return;
      setSeriesData(series);
      setReferenceSnapshot(reference);
      setFetchedSinceIso(sinceIso);
      setSeriesLoading(false);
    };

    load(true);
    const interval = setInterval(() => load(false), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [timeframe]);

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

  // OI Change % / BTC Change % ueber den gewaehlten Zeitraum: aktueller Wert
  // (latest, immer der frischeste Datenpunkt) gegen den echten historischen
  // Referenzpunkt -- niemals approximiert (Vorgabe Punkt 1+10).
  const oiChangePct =
    latest.open_interest !== null &&
    referenceSnapshot?.open_interest !== null &&
    referenceSnapshot?.open_interest !== undefined
      ? ((latest.open_interest - referenceSnapshot.open_interest) /
          referenceSnapshot.open_interest) *
        100
      : null;

  const btcChangePct =
    latest.last_price !== null &&
    referenceSnapshot?.last_price !== null &&
    referenceSnapshot?.last_price !== undefined
      ? ((latest.last_price - referenceSnapshot.last_price) /
          referenceSnapshot.last_price) *
        100
      : null;

  const selectedTf = getTimeframe(timeframe);
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
        <div className="flex items-center gap-2 mb-3">
          <span
            className="live-dot inline-block h-2 w-2 rounded-full bg-accent"
            aria-hidden
          />
          <span className="text-xs uppercase tracking-[0.15em] text-text-muted">
            {latest.symbol} · {latest.exchange} Perpetual
          </span>
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
          <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
            OI Change
          </p>
          <div className="flex gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => setTimeframe(tf.id)}
                className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                  timeframe === tf.id
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-transparent text-text-faint hover:text-text-muted"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
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
              Open Interest · {selectedTf.label}
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
            <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
              Markteinschätzung
            </p>
            <span className="text-xs text-text-faint">
              {timeAgo(commentary.generated_at)}
            </span>
          </div>
          <p className="text-sm text-text leading-relaxed">
            {commentary.summary_text}
          </p>
        </div>
      )}

      {exchangeComparison.length > 1 && (
        <ExchangeComparisonCard snapshots={exchangeComparison} />
      )}

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
        <ChartCard title="Funding Rate (%)">
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
      <p className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">
        Börsenvergleich
      </p>
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">
        {title}
      </p>
      {children}
    </div>
  );
}
