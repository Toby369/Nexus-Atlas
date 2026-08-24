"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PositioningSignal, PositioningSnapshot } from "@/lib/types";

const REFRESH_INTERVAL_MS = 30_000;

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  return `vor ${hours} Std`;
}

function pct(value: number | null) {
  return value !== null ? `${(value * 100).toFixed(1)}%` : "—";
}

async function fetchLatestSnapshot(
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

async function fetchLatestSignal(): Promise<PositioningSignal | null> {
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

export default function PositioningPanel({
  initialBinance,
  initialBybit,
  initialSignal,
}: {
  initialBinance: PositioningSnapshot | null;
  initialBybit: PositioningSnapshot | null;
  initialSignal: PositioningSignal | null;
}) {
  const [binance, setBinance] = useState(initialBinance);
  const [bybit, setBybit] = useState(initialBybit);
  const [signal, setSignal] = useState(initialSignal);

  useEffect(() => {
    const fetchLatest = async () => {
      const [binanceData, bybitData, signalData] = await Promise.all([
        fetchLatestSnapshot("binance"),
        fetchLatestSnapshot("bybit"),
        fetchLatestSignal(),
      ]);

      if (binanceData) setBinance(binanceData);
      if (bybitData) setBybit(bybitData);
      if (signalData) setSignal(signalData);
    };

    const interval = setInterval(fetchLatest, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!binance && !bybit) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Positioning Intelligence
        </p>
        <p className="text-sm text-text-faint mt-3">
          Noch keine Positioning-Daten vorhanden.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
        Positioning Intelligence
      </p>

      <div className="space-y-3">
        {binance && (
          <RatioBar
            label="Retail (Binance)"
            long={binance.global_long_account_ratio}
            short={binance.global_short_account_ratio}
          />
        )}
        {binance && (
          <RatioBar
            label="Top Trader (Binance, Positionen)"
            long={binance.top_trader_long_position_ratio}
            short={binance.top_trader_short_position_ratio}
          />
        )}
        {bybit && (
          <RatioBar
            label="Retail (Bybit)"
            long={bybit.global_long_account_ratio}
            short={bybit.global_short_account_ratio}
          />
        )}
      </div>

      {binance?.taker_buy_sell_ratio != null && (
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-text-muted">Taker-Flow (Binance)</span>
          <span className="tabular font-mono text-text-faint">
            {binance.taker_buy_sell_ratio.toFixed(2)}× Buy/Sell
          </span>
        </div>
      )}

      {signal && (
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
              NEXUS Assessment
            </p>
            <span className="text-xs text-text-faint">
              {timeAgo(signal.timestamp_utc)}
            </span>
          </div>
          <p className="text-sm text-text leading-relaxed">
            {signal.explanation}
          </p>
          <p className="text-xs text-text-faint mt-2">
            Confidence:{" "}
            {signal.confidence !== null ? Math.round(signal.confidence) : "—"}
            /100 · Zeitrahmen: {signal.timeframe ?? "—"}
          </p>
        </div>
      )}
    </div>
  );
}

function RatioBar({
  label,
  long,
  short,
}: {
  label: string;
  long: number | null;
  short: number | null;
}) {
  const longWidth = long !== null ? long * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-muted">{label}</span>
        <span className="tabular font-mono text-text-faint">
          {pct(long)} long · {pct(short)} short
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-down/40 overflow-hidden relative">
        <div className="h-full bg-up" style={{ width: `${longWidth}%` }} />
      </div>
    </div>
  );
}
