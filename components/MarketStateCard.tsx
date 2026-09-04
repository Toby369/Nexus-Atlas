"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketState } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { marketStateInfo, MARKET_STATE_FACTOR_INFO } from "@/lib/panelInfo";
import {
  isDirectionalLabelSuppressed,
  UNCLEAR_STATE_LABEL,
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
  computeConfidenceBreakdown,
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

// Erklaerungstext je Risk-Factor (Nutzer-Feedback: "warn-muster erkannt:
// kann das erklaert werden? idee: wenn ich es druecke kommt erklaerung").
// Feste, allgemeine Erklaerung je Faktor-TYP (nicht pro Vorkommnis) --
// dieselben fuenf Schwellenwerte/Bedingungen wie in compute-market-state
// (Risk-Abschnitt), hier nur in Textform uebersetzt. warning_pattern ist
// bewusst ein Meta-Signal: WELCHES der vier Muster genau vorliegt, steht
// bereits in den Pattern-Badges darueber (eigener Hover-Tooltip je Muster).
const RISK_FACTOR_EXPLANATIONS: Record<string, string> = {
  warning_pattern:
    "Mindestens eines von vier Warn-Mustern wurde erkannt: „Fragile Bullish“ (Struktur bullisch, aber Orderflow bestätigt nicht), „Distribution Warning“ (Preis nahe 20-Perioden-Hoch, aber fallender Orderflow), „Capitulation“ (RSI überverkauft + fallender Orderflow + überdurchschnittliche Liquidationen) oder „Short Squeeze“ (Positionierungs-Divergenz deutet auf Squeeze-Setup). Welches genau aktiv ist, zeigen die Muster-Badges oben — Ⓘ dort antippen für Details.",
  low_mtf_alignment:
    "Die Struktur über die drei Zeitrahmen 1H/4H/1D stimmt aktuell zu weniger als 60% (gewichtet) überein — die Zeitrahmen sind sich uneins, was die Gefahr einer plötzlichen Umkehr oder von Chop (richtungslosem Hin-und-Her) erhöht.",
  funding_crowding:
    "Die durchschnittliche Funding-Rate über alle Börsen liegt über ±0.05% — ein Zeichen für überhitzte, einseitige Positionierung (Crowding). Viele gleich positionierte Trader erhöhen das Risiko einer Liquidationskaskade/eines Squeeze in die Gegenrichtung.",
  basis_crowding:
    "Die Perpetual-Prämie gegenüber dem Spot-Preis (Basis) liegt über ±0.15% — dasselbe Crowding-Signal wie extreme Funding, nur über einen anderen Derivate-Kanal gemessen.",
  elevated_volatility:
    "Die durchschnittliche wahre Handelsspanne (ATR, 14 Perioden) liegt über 1.0% des Preises — deutlich über dem bisher beobachteten Normalbereich (Median ~0.67%). Grössere Kursausschläge sind aktuell wahrscheinlicher als üblich.",
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

// Gruppierung der 14 Faktoren nach inhaltlicher Saeule statt einer flachen
// Liste (Institutional-Grade-Professionalisierung, Sprint A: "Gruppiere die
// 14 Faktoren in den Kacheln strikt nach den 5 Saeulen") -- dieselbe
// Kategorisierung, mit der die Faktoren bereits inhaltlich unterschieden
// werden (siehe compute-market-state-Kommentare je Faktor), sechs statt
// fuenf Gruppen: Market State hat keinen eigenstaendigen Volatilitaets-
// Faktor (anders als die Regime Matrix mit Bollinger/ATR) und dafuer zwei
// Gruppen, die die Regime Matrix nicht kennt (Positionierung, Optionen) --
// eine erzwungene Angleichung an das 5-Saeulen-Schema der Regime Matrix
// wuerde hier Faktoren in eine Gruppe pressen, zu der sie inhaltlich nicht
// gehoeren.
const FACTOR_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Struktur/Trend", keys: ["structure", "trend_strength", "trend_regime", "vwap_position"] },
  { title: "Momentum", keys: ["momentum"] },
  { title: "Orderflow/Derivate", keys: ["cvd", "oi_price", "orderbook", "funding", "basis"] },
  { title: "Positionierung", keys: ["positioning"] },
  { title: "Optionen", keys: ["options"] },
  { title: "Makro/Sentiment", keys: ["macro", "sentiment"] },
];

// Realer Rohwert je Faktor (aus factor.basis), zusaetzlich zum -1/0/+1-
// Ampel-Signal (Sprint A: "Zeige ... den realen Rohwert (z.B. 'RSI 37.2',
// 'ADX 35') statt nur das Ampel-Signal"). Rein additiv -- factorLabel()/
// factorColor() bleiben unveraendert die primaere Aussage, dies ist die
// Begruendung dahinter. null, wenn die Basis (noch) keine Rohdaten enthaelt
// (z. B. Faktor selbst ohne Daten) -- kein erfundener Wert.
function factorRawValueLabel(key: string, basis: Record<string, unknown>): string | null {
  const num = (v: unknown, decimals = 2): string | null =>
    typeof v === "number" ? v.toFixed(decimals) : null;

  switch (key) {
    case "structure": {
      const bos = basis.bos === true ? "ja" : basis.bos === false ? "nein" : null;
      const choch = basis.choch === true ? "ja" : basis.choch === false ? "nein" : null;
      return bos !== null && choch !== null ? `BOS ${bos} · CHoCH ${choch}` : null;
    }
    case "momentum": {
      const rsi = num(basis.rsi_14, 1);
      return rsi !== null ? `RSI ${rsi}` : null;
    }
    case "cvd": {
      const delta = num(basis.cvd_delta, 1);
      return delta !== null ? `CVD-Δ ${Number(basis.cvd_delta) >= 0 ? "+" : ""}${delta}` : null;
    }
    case "oi_price": {
      const pct = num(basis.oi_delta_pct, 2);
      return pct !== null ? `OI-Δ ${Number(basis.oi_delta_pct) >= 0 ? "+" : ""}${pct}%` : null;
    }
    case "positioning": {
      const score = num(basis.score, 0);
      return score !== null ? `Score ${score}` : null;
    }
    case "orderbook": {
      const imb = num(basis.avg_depth_imbalance, 3);
      return imb !== null ? `Imbalance ${imb}` : null;
    }
    case "options": {
      const ratio = num(basis.put_call_oi_ratio, 2);
      return ratio !== null ? `P/C ${ratio}` : null;
    }
    case "macro": {
      return typeof basis.regime === "string" ? basis.regime : null;
    }
    case "funding": {
      const rate = num(basis.avg_current_rate !== undefined ? Number(basis.avg_current_rate) * 100 : null, 4);
      return rate !== null ? `${rate}%` : null;
    }
    case "sentiment": {
      const value = num(basis.value, 0);
      return value !== null ? `F&G ${value}` : null;
    }
    case "trend_strength": {
      const adx = num(basis.adx_14, 1);
      return adx !== null ? `ADX ${adx}` : null;
    }
    case "trend_regime": {
      if (typeof basis.close_price !== "number" || typeof basis.ema_50 !== "number" || basis.ema_50 === 0) {
        return null;
      }
      const diffPct = ((basis.close_price - basis.ema_50) / basis.ema_50) * 100;
      return `Preis vs. EMA50 ${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%`;
    }
    case "vwap_position": {
      const pct = num(basis.pct_diff, 2);
      return pct !== null ? `${Number(basis.pct_diff) >= 0 ? "+" : ""}${pct}%` : null;
    }
    case "basis": {
      const pct = num(basis.basis_pct, 3);
      return pct !== null ? `${Number(basis.basis_pct) >= 0 ? "+" : ""}${pct}%` : null;
    }
    default:
      return null;
  }
}

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
  const [expandedRiskFactor, setExpandedRiskFactor] = useState<string | null>(null);

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
            Gesamteinschätzung
          </h2>
          <PanelInfo title="Gesamteinschätzung" content={marketStateInfo} />
        </div>
        <p className="text-sm text-text-faint mt-3">
          Noch keine Daten vorhanden.
        </p>
      </section>
    );
  }

  // Confidence-Gate (Phase 1, Punkt 3.1 -- Q3: "Option A, nur Anzeige-
  // Ebene"): state.overall_state selbst bleibt unveraendert (Ground-Truth
  // fuer die Backtest-/Modell-Pipeline, siehe lib/marketStateSummary.ts),
  // nur das angezeigte Label/Badge wird bei niedriger Verlaesslichkeit auf
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
  const confidenceBreakdown = computeConfidenceBreakdown(state);

  return (
    <section className="rounded-lg border border-accent/25 bg-surface-raised p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Gesamteinschätzung
        </h2>
        <PanelInfo title="Gesamteinschätzung" content={marketStateInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Gesamteinschätzung wird angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      {suppressDirectionalLabel && (
        <p className="text-xs text-text-faint">
          Berechneter Zustand war {STATE_LABELS[state.overall_state]}, aber Verlässlichkeit liegt unter{" "}
          {DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 — für eine Richtungsaussage zu unsicher, daher
          hier als &bdquo;{UNCLEAR_STATE_LABEL}&ldquo; angezeigt. Faktoren-Detail unten unverändert
          einsehbar.
        </p>
      )}

      <div className="flex gap-4 text-xs text-text-faint flex-wrap">
        <span>Verlässlichkeit: {Math.round(state.confidence)}/100</span>
        <span>Datenabdeckung: {Math.round(state.data_coverage_pct)}%</span>
        <span>Signal-Stärke: {Math.round(confidenceBreakdown.signalStrengthPct)}%</span>
        <span>
          Konsens:{" "}
          {confidenceBreakdown.consensusPct !== null
            ? `${Math.round(confidenceBreakdown.consensusPct)}%`
            : "—"}
        </span>
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
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-accent/30 text-text-muted"
            >
              {p.name}
              <PanelInfo title={p.name} content={p.note} />
            </span>
          ))}
        </div>
      )}

      {state.risk_factors && state.risk_factors.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {state.risk_factors.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setExpandedRiskFactor((current) => (current === f ? null : f))}
                aria-expanded={expandedRiskFactor === f}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  expandedRiskFactor === f
                    ? "border-down/60 bg-down/10 text-down"
                    : "border-down/30 text-down/90 hover:border-down/50"
                }`}
              >
                {RISK_FACTOR_LABELS[f] ?? f}
              </button>
            ))}
          </div>
          {expandedRiskFactor && state.risk_factors.includes(expandedRiskFactor) && (
            <p className="text-xs text-text-muted leading-relaxed pl-0.5">
              {RISK_FACTOR_EXPLANATIONS[expandedRiskFactor] ?? "Keine Erklärung verfügbar."}
            </p>
          )}
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
          {FACTOR_GROUPS.map((group) => {
            const rows = group.keys
              .map((key) => ({ key, factor: state.factors?.[key] }))
              .filter((r): r is { key: string; factor: MarketState["factors"][string] } => !!r.factor);
            if (rows.length === 0) return null;
            return (
              <div key={group.title} className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
                  {group.title}
                </div>
                {rows.map(({ key, factor }) => {
                  const rawValue = factorRawValueLabel(key, factor.basis);
                  return (
                    <div key={key} className="text-xs">
                      <span className="text-text-muted">{FACTOR_LABELS[key] ?? key}: </span>
                      <span className={factorColor(factor.value)}>{factorLabel(factor.value)}</span>
                      {rawValue && <span className="text-text-faint"> ({rawValue})</span>}
                      {MARKET_STATE_FACTOR_INFO[key] && (
                        <PanelInfo title={FACTOR_LABELS[key] ?? key} content={MARKET_STATE_FACTOR_INFO[key]} className="ml-1" />
                      )}
                    </div>
                  );
                })}
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
