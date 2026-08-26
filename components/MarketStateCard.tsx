"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketState } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { marketStateInfo } from "@/lib/panelInfo";

const REFRESH_INTERVAL_MS = 60_000;

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  return `vor ${hours} Std`;
}

const STATE_LABELS: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt",
  INSUFFICIENT_DATA: "Unzureichende Daten",
};

const FACTOR_LABELS: Record<string, string> = {
  structure: "Struktur (1H)",
  momentum: "Momentum (RSI+MACD)",
  cvd: "Orderflow (CVD)",
  oi_price: "OI vs. Preis",
  positioning: "Positioning",
  orderbook: "Orderbuch-Imbalance",
  options: "Options (Put/Call)",
  macro: "Makro-Regime",
  funding: "Funding-Rate",
  sentiment: "Fear & Greed Index",
  trend_strength: "Trend-Stärke (ADX)",
  trend_regime: "Trend-Regime (EMA50/200)",
  vwap_position: "Preis vs. VWAP",
  basis: "Basis (Perpetual Premium)",
};

// Feste Reihenfolge statt Objekt-Iterationsreihenfolge der DB/JSON-Antwort,
// damit die Faktoren-Liste bei jedem Reload stabil sortiert erscheint.
const FACTOR_ORDER = [
  "structure",
  "momentum",
  "cvd",
  "oi_price",
  "positioning",
  "orderbook",
  "options",
  "macro",
  "funding",
  "sentiment",
  "trend_strength",
  "trend_regime",
  "vwap_position",
  "basis",
];

function factorLabel(value: -1 | 0 | 1 | null): string {
  if (value === 1) return "bullisch";
  if (value === -1) return "bärisch";
  if (value === 0) return "neutral";
  return "keine Daten";
}

function factorColor(value: -1 | 0 | 1 | null): string {
  if (value === 1) return "text-up";
  if (value === -1) return "text-down";
  return "text-text-faint";
}

async function fetchLatestState(): Promise<{ data: MarketState | null; ok: boolean }> {
  const { data, error } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des Market State:", error.message);
    return { data: null, ok: false };
  }
  return { data, ok: true };
}

export default function MarketStateCard({
  initialState,
}: {
  initialState: MarketState | null;
}) {
  const [state, setState] = useState(initialState);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data, ok } = await fetchLatestState();
      setLastSyncOk(ok);
      if (ok && data) setState(data);
    };
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!state) {
    return (
      <div className="rounded-lg border border-accent/25 bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Market State
          </p>
          <PanelInfo title="Market State" content={marketStateInfo} />
        </div>
        <p className="text-sm text-text-faint mt-3">
          Noch keine Market-State-Daten vorhanden.
        </p>
      </div>
    );
  }

  const badgeColor =
    state.overall_state === "BULLISH"
      ? "text-up"
      : state.overall_state === "BEARISH"
      ? "text-down"
      : state.overall_state === "INSUFFICIENT_DATA"
      ? "text-text-faint"
      : "text-text";

  const patterns = state.patterns ?? [];
  const mtf = state.mtf_alignment;

  return (
    <div className="rounded-lg border border-accent/25 bg-surface-raised p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Market State
        </p>
        <PanelInfo title="Market State" content={marketStateInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannter Market State wird angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>
          {STATE_LABELS[state.overall_state] ?? state.overall_state}
        </p>
        <span className="text-xs text-text-faint">{timeAgo(state.timestamp_utc)}</span>
      </div>

      <div className="flex gap-4 text-xs text-text-faint flex-wrap">
        <span>Confidence: {Math.round(state.confidence)}/100</span>
        <span>Datenabdeckung: {Math.round(state.data_coverage_pct)}%</span>
        {mtf && (
          <span>
            MTF-Alignment: {mtf.alignment_pct}%{" "}
            (
            {mtf.dominant_direction === "bullish"
              ? "bullisch"
              : mtf.dominant_direction === "bearish"
              ? "bärisch"
              : "range-gebunden"}
            )
          </span>
        )}
      </div>

      {patterns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patterns.map((p) => (
            <span
              key={p.name}
              title={p.note}
              className="text-[11px] px-2 py-0.5 rounded-full border border-accent/30 text-text-muted"
            >
              {p.name}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
      >
        {expanded ? "Faktoren ausblenden" : "Faktoren anzeigen"}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-border/60">
          {FACTOR_ORDER.map((key) => {
            const factor = state.factors?.[key];
            if (!factor) return null;
            return (
              <div key={key} className="text-xs">
                <span className="text-text-muted">{FACTOR_LABELS[key] ?? key}: </span>
                <span className={factorColor(factor.value)}>{factorLabel(factor.value)}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Kombiniert 14 unabhängige Datenquellen zu einem Gesamtzustand — Rohmaterial für eine
        Einordnung, kein Handelssignal.
      </p>
    </div>
  );
}
