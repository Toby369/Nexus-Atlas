"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketState } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { marketStateInfo } from "@/lib/panelInfo";
import {
  isDirectionalLabelSuppressed,
  UNCLEAR_STATE_LABEL,
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
} from "@/lib/marketStateSummary";
import { RelativeTime } from "@/components/ClientTimestamp";

const REFRESH_INTERVAL_MS = 60_000;

const STATE_LABELS: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt",
  INSUFFICIENT_DATA: "Unzureichende Daten",
};

const RISK_LABELS: Record<string, string> = {
  LOW: "Niedrig",
  MEDIUM: "Mittel",
  HIGH: "Hoch",
  UNKNOWN: "Unbekannt",
};

// Risk ist bewusst von Confidence getrennt (siehe compute-market-state):
// Confidence misst die Einigkeit der verfuegbaren Faktoren, Risk misst die
// Fragilitaet/Gefahr der aktuellen Lage unabhaengig von der Richtung.
function riskColor(level: string | null): string {
  if (level === "HIGH") return "text-down";
  if (level === "LOW") return "text-up";
  if (level === "MEDIUM") return "text-text";
  return "text-text-faint";
}

const RISK_FACTOR_LABELS: Record<string, string> = {
  warning_pattern: "Warn-Muster erkannt",
  low_mtf_alignment: "Zeitrahmen uneins",
  funding_crowding: "Funding-Crowding",
  basis_crowding: "Basis-Crowding",
  elevated_volatility: "erhöhte Volatilität",
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
      <section className="rounded-lg border border-accent/25 bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Market State
          </h2>
          <PanelInfo title="Market State" content={marketStateInfo} />
        </div>
        <p className="text-sm text-text-faint mt-3">
          Noch keine Market-State-Daten vorhanden.
        </p>
      </section>
    );
  }

  // Confidence-Gate (Phase 1, Punkt 3.1 -- Q3: "Option A, nur Anzeige-
  // Ebene"): state.overall_state selbst bleibt unveraendert (Ground-Truth
  // fuer die Backtest-/Modell-Pipeline, siehe lib/marketStateSummary.ts),
  // nur das angezeigte Label/Badge wird bei niedriger Confidence auf
  // "Unklar / kein Zustand" umgestellt statt Bullish/Bearish zu zeigen.
  const suppressDirectionalLabel = isDirectionalLabelSuppressed(state);
  const displayLabel = suppressDirectionalLabel
    ? UNCLEAR_STATE_LABEL
    : STATE_LABELS[state.overall_state] ?? state.overall_state;

  const badgeColor = suppressDirectionalLabel
    ? "text-text-faint"
    : state.overall_state === "BULLISH"
      ? "text-up"
      : state.overall_state === "BEARISH"
      ? "text-down"
      : state.overall_state === "INSUFFICIENT_DATA"
      ? "text-text-faint"
      : "text-text";

  const patterns = state.patterns ?? [];
  const mtf = state.mtf_alignment;

  return (
    <section className="rounded-lg border border-accent/25 bg-surface-raised p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Market State
        </h2>
        <PanelInfo title="Market State" content={marketStateInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannter Market State wird angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      {suppressDirectionalLabel && (
        <p className="text-xs text-text-faint">
          Berechneter Zustand war {STATE_LABELS[state.overall_state]}, aber Confidence liegt unter{" "}
          {DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 — für eine Richtungsaussage zu unsicher, daher
          hier als &bdquo;{UNCLEAR_STATE_LABEL}&ldquo; angezeigt. Faktoren-Detail unten unverändert
          einsehbar.
        </p>
      )}

      <div className="flex gap-4 text-xs text-text-faint flex-wrap">
        <span>Confidence: {Math.round(state.confidence)}/100</span>
        <span>Datenabdeckung: {Math.round(state.data_coverage_pct)}%</span>
        {state.risk_level && (
          <span>
            Risk: <span className={riskColor(state.risk_level)}>{RISK_LABELS[state.risk_level] ?? state.risk_level}</span>
          </span>
        )}
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

      {state.risk_factors && state.risk_factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {state.risk_factors.map((f) => (
            <span
              key={f}
              className="text-[11px] px-2 py-0.5 rounded-full border border-down/30 text-down/90"
            >
              {RISK_FACTOR_LABELS[f] ?? f}
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
    </section>
  );
}
