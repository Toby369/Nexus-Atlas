"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketSnapshot } from "@/lib/types";

const REFRESH_INTERVAL_MS = 30_000;

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

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  return `vor ${hours} Std`;
}

export default function LivePricePanel({
  initialSnapshots,
}: {
  initialSnapshots: MarketSnapshot[];
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const fetchLatest = async () => {
      const { data, error } = await supabase
        .from("market_snapshots")
        .select("*")
        .eq("status", "ok")
        .order("timestamp_utc", { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        setSnapshots(data);
      }
    };

    const interval = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (snapshots.length === 0) return;
    const check = () => {
      const latestMs = new Date(snapshots[0].timestamp_utc).getTime();
      setIsStale(Date.now() - latestMs > 15 * 60 * 1000);
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [snapshots]);

  const latest = snapshots[0];
  const previous = snapshots[1];

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

  return (
    <div className="space-y-4">
      {isStale && (
        <div className="rounded-md border border-down/40 bg-down/10 px-4 py-2 text-sm text-down">
          Letzter Datenpunkt liegt mehr als 15 Minuten zurück — Pipeline
          prüfen.
        </div>
      )}

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
      </div>

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
              ? new Date(latest.next_funding_time_utc).toLocaleTimeString(
                  "de-CH",
                  { hour: "2-digit", minute: "2-digit" }
                )
              : "—"
          }
        />
      </div>
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
