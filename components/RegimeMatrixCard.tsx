"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AnchoredSummary, MarketState, MarketStateMatrix, TradingViewSignal } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { marketStateMatrixInfo } from "@/lib/panelInfo";
import { formatAnchorBadge } from "@/lib/anchor";
import {
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
  UNCLEAR_STATE_LABEL,
  engineDivergenceStatusLabel,
} from "@/lib/marketStateSummary";
import {
  regimeLabel,
  regimeDescription,
  regimeColorClass,
  shouldSuppressRegimeDirectionalLabel,
  computeEngineDivergence,
} from "@/lib/marketRegime";
import {
  TRADINGVIEW_SIGNAL_FRESHNESS_HOURS,
  formatSignalBadge,
  isSignalFresh,
} from "@/lib/tradingViewSignal";
import { RelativeTime } from "@/components/ClientTimestamp";

// Regime-Daten aendern sich hoechstens stuendlich (1H-Kerzen-Raster, siehe
// compute_market_state_matrix_series) -- kein 30s-Live-Takt noetig wie bei
// Preis/Positioning, aehnliche Ueberlegung wie EtfFlowPanel.tsx.
const REFRESH_INTERVAL_MS = 5 * 60_000;

const QUADRANT_LABELS: Record<string, string> = {
  long_buildup: "Long-Aufbau",
  short_buildup: "Short-Aufbau",
  short_covering: "Short-Covering",
  long_unwind: "Long-Abbau",
  neutral: "neutral",
};

function fmtNum(v: number | null, decimals = 2): string {
  return v !== null ? v.toFixed(decimals) : "—";
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

async function fetchLatestMatrix(): Promise<{ data: MarketStateMatrix | null; ok: boolean }> {
  const { data, error } = await supabase
    .from("market_state_matrix")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Market State Matrix:", error.message);
    return { data: null, ok: false };
  }
  return { data, ok: true };
}

// Phase 2 TradingView-Integration: juengstes Signal der letzten
// TRADINGVIEW_SIGNAL_FRESHNESS_HOURS. Der Frische-Cutoff steckt bereits im
// Query (wie beim initialen Server-Fetch in app/page.tsx) -- kein
// zusaetzlicher isSignalFresh()-Check noetig fuer das, was diese Funktion
// zurueckgibt, isSignalFresh() bleibt aber die geteilte, getestete
// Referenz fuer die Zeitspanne (keine doppelt gepflegte Zahl).
async function fetchLatestTradingViewSignal(): Promise<TradingViewSignal | null> {
  const cutoff = new Date(Date.now() - TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
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

export default function RegimeMatrixCard({
  initialMatrix,
  marketState,
  initialTradingViewSignal,
  anchorIso,
  initialAnchoredSummary,
}: {
  initialMatrix: MarketStateMatrix | null;
  // Fuer die Confidence-Sperre (siehe unten) -- dieselbe market_states-Zeile,
  // die MarketStateCard bereits erhaelt, kein Zusatz-Query.
  marketState: MarketState | null;
  // Phase 2 TradingView-Integration: rein informatives Kontext-Badge, siehe
  // Render-Block unten. null, wenn kein frisches Signal vorliegt (haeufigster
  // Fall, solange noch kein TradingView-Alert konfiguriert ist).
  initialTradingViewSignal: TradingViewSignal | null;
  // "Seit Anker"-Regime-Vergleich (Phase 1 "Anchored Analytics" auf die
  // Regime Matrix erweitert): dieselbe get_anchored_summary-RPC wie
  // LivePricePanel/LiquidationPanel, hier nur regime_at_anchor/
  // confidence_at_anchor ausgewertet statt Preis/OI.
  anchorIso: string | null;
  initialAnchoredSummary: AnchoredSummary | null;
}) {
  const [matrix, setMatrix] = useState(initialMatrix);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [tradingViewSignal, setTradingViewSignal] = useState(initialTradingViewSignal);
  const [anchoredSummary, setAnchoredSummary] = useState(initialAnchoredSummary);

  useEffect(() => {
    const load = async () => {
      const [{ data, ok }, signal] = await Promise.all([
        fetchLatestMatrix(),
        fetchLatestTradingViewSignal(),
      ]);
      setLastSyncOk(ok);
      if (ok && data) setMatrix(data);
      setTradingViewSignal(signal);
    };
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Wie LivePricePanel.tsx: eigener Effekt, nur aktiv wenn ein Anker
  // gesetzt ist. Kein synchrones setState bei fehlendem Anker (react-hooks/
  // set-state-in-effect) -- die JSX-Stelle unten ist selbst an
  // "anchorIso &&" gebunden, ein veralteter State wird also nie gerendert.
  useEffect(() => {
    if (!anchorIso) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_anchored_summary", {
        p_anchor: anchorIso,
      });
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

  if (!matrix) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Regime-Matrix
          </h2>
          <PanelInfo title="Regime-Matrix" content={marketStateMatrixInfo} />
        </div>
        <p className="text-sm text-text-faint mt-3">Noch keine Regime-Daten vorhanden.</p>
      </section>
    );
  }

  // Gleiche Confidence-Sperre wie MarketStateCard (Phase 1, Punkt 3.1 --
  // "Option A, nur Anzeige-Ebene", siehe lib/marketRegime.ts::
  // shouldSuppressRegimeDirectionalLabel).
  const suppressDirectional = shouldSuppressRegimeDirectionalLabel(
    matrix.regime,
    marketState?.confidence ?? null
  );

  const displayLabel = suppressDirectional ? UNCLEAR_STATE_LABEL : regimeLabel(matrix.regime);
  const badgeColor = suppressDirectional ? "text-text-faint" : regimeColorClass(matrix.regime);

  // Engine-Divergenz (siehe lib/marketRegime.ts::computeEngineDivergence):
  // vergleicht die Richtung von Market State (14-Faktoren-Summe) und Regime
  // Matrix (ADX/Steigungs-Klassifikation) direkt anhand ihrer Ground-Truth-
  // Werte. Nur angezeigt, wenn die Confidence-Sperre oben NICHT bereits
  // greift (suppressDirectional) -- sonst wuerde hier eine konkrete
  // Richtung genannt, obwohl die Kachel-Ueberschrift gerade "Unklar / kein
  // Zustand" zeigt, weil dieselbe Confidence zu niedrig fuer eine
  // Richtungsaussage ist. NOT_COMPARABLE wird bewusst nicht angezeigt (der
  // haeufigste Fall -- kein Befund, keine Meldung noetig, gleiche
  // Konvention wie die patterns-Liste in MarketStateCard).
  const engineDivergence = suppressDirectional
    ? "NOT_COMPARABLE"
    : computeEngineDivergence(marketState?.overall_state ?? null, matrix.regime);
  const marketStateDirectionLabel =
    marketState?.overall_state === "BULLISH"
      ? "bullisch"
      : marketState?.overall_state === "BEARISH"
        ? "bärisch"
        : null;

  // "Seit Anker"-Regime-Vergleich: dieselbe Confidence-Sperre wie oben,
  // nur mit der Confidence zum Anker-Zeitpunkt statt der aktuellen --
  // verhindert, dass hier eine Richtungsaussage auftaucht, die zu diesem
  // historischen Zeitpunkt eigentlich als "Unklar / kein Zustand" gegolten
  // haette.
  const anchorRegime = anchoredSummary?.regime_at_anchor ?? null;
  const anchorRegimeLabel = anchorRegime
    ? shouldSuppressRegimeDirectionalLabel(anchorRegime, anchoredSummary?.confidence_at_anchor ?? null)
      ? UNCLEAR_STATE_LABEL
      : regimeLabel(anchorRegime)
    : null;
  const anchorRegimeChanged = anchorRegimeLabel !== null && anchorRegimeLabel !== displayLabel;

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Regime-Matrix
          </h2>
          {anchorIso && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-accent/30 text-accent"
              title="Zeigt weiter unten zusätzlich das Regime seit dem gesetzten Event-Anker."
            >
              ⚓ Anker
            </span>
          )}
        </div>
        <PanelInfo title="Regime-Matrix" content={marketStateMatrixInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekanntes Regime wird angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={matrix.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      {suppressDirectional ? (
        <p className="text-xs text-text-faint">
          Berechnetes Regime war {regimeLabel(matrix.regime)}, aber die Confidence des NEXUS
          Assessment liegt unter {DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 — für eine
          Richtungsaussage zu unsicher, daher hier als &bdquo;{UNCLEAR_STATE_LABEL}&ldquo;
          angezeigt. Säulen-Detail unten unverändert einsehbar.
        </p>
      ) : (
        <p className="text-xs text-text-muted leading-relaxed">
          {regimeDescription(matrix.regime)}
        </p>
      )}

      {anchorIso && (
        <div className="space-y-0.5">
          <p className="text-xs text-text-faint">
            Seit Anker ({formatAnchorBadge(new Date(anchorIso))}):
          </p>
          {anchorRegimeLabel ? (
            <p className="text-xs text-text-muted">
              Regime beim Anker: {anchorRegimeLabel} → jetzt: {displayLabel}
              {anchorRegimeChanged && (
                <span className="ml-1.5 text-[11px] uppercase tracking-wide text-accent">
                  geändert
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-text-faint">
              Keine Regime-Daten für diesen Zeitpunkt verfügbar (Anker liegt vor Beginn der
              Regime-Matrix-Historie).
            </p>
          )}
        </div>
      )}

      {engineDivergence === "DIVERGENCE" && marketStateDirectionLabel && (
        <div className="space-y-1">
          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full border border-down/40 text-down font-semibold uppercase tracking-wide">
            {engineDivergenceStatusLabel(engineDivergence)}
          </span>
          <p className="text-xs text-down">
            Gesamteinschätzung ist {marketStateDirectionLabel}, Regime-Matrix zeigt{" "}
            {regimeLabel(matrix.regime)} — zwei unabhängige Engines widersprechen sich aktuell in der
            Richtung, geringere Aussagekraft der Gesamteinschätzung.
          </p>
        </div>
      )}
      {engineDivergence === "AGREEMENT" && marketStateDirectionLabel && (
        <p className="text-xs text-up">
          Gesamteinschätzung und Regime-Matrix stimmen richtungsmäßig überein (beide{" "}
          {marketStateDirectionLabel}).
        </p>
      )}

      {tradingViewSignal && isSignalFresh(tradingViewSignal.received_at) && (
        <span
          title={`Externes Signal, empfangen ${tradingViewSignal.received_at} — rein informativ, fließt nicht in Score/Confidence/Regime ein.`}
          className="inline-block text-[11px] px-2 py-0.5 rounded-full border border-accent/30 text-text-muted"
        >
          {formatSignalBadge(tradingViewSignal)}
        </span>
      )}

      <p className="text-xs text-text-faint">
        Datenabdeckung:{" "}
        {matrix.data_coverage_pct !== null ? Math.round(matrix.data_coverage_pct) : "—"}% · 1H-Kerzen
        (Binance)
      </p>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
      >
        {expanded ? "Säulen ausblenden" : "Säulen anzeigen"}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-border/60 text-xs">
          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Trend
          </div>
          <div>
            <span className="text-text-muted">ADX (14): </span>
            <span className="text-text">{fmtNum(matrix.adx_14, 1)}</span>
          </div>
          <div>
            <span className="text-text-muted">+DI / −DI: </span>
            <span className="text-text">
              {fmtNum(matrix.plus_di, 1)} / {fmtNum(matrix.minus_di, 1)}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Regressionssteigung: </span>
            <span className="text-text">{fmtNum(matrix.linreg_slope, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">R²: </span>
            <span className="text-text">{fmtNum(matrix.linreg_r2, 2)}</span>
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Volatilität
          </div>
          <div>
            <span className="text-text-muted">Garman-Klass Vol: </span>
            <span className="text-text">{fmtNum(matrix.garman_klass_vol, 4)}</span>
          </div>
          <div>
            <span className="text-text-muted">Bollinger-Breite: </span>
            <span className="text-text">{fmtNum(matrix.bb_width, 3)}</span>
          </div>
          <div>
            <span className="text-text-muted">Bollinger %b: </span>
            <span className="text-text">{fmtNum(matrix.bb_percent_b, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">ATR-Ratio: </span>
            <span className="text-text">{fmtNum(matrix.atr_ratio, 2)}</span>
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Momentum/Mean-Reversion
          </div>
          <div>
            <span className="text-text-muted">RSI (14): </span>
            <span className="text-text">{fmtNum(matrix.rsi_14, 1)}</span>
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA20: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma20, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA50: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma50, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA200: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma200, 2)}</span>
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Mikrostruktur &amp; Derivate
          </div>
          <div>
            <span className="text-text-muted">Funding-Z-Score: </span>
            <span className="text-text">{fmtNum(matrix.funding_zscore, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">CVD-Z-Score: </span>
            <span className="text-text">{fmtNum(matrix.cvd_zscore, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">Preis-Δ (6h): </span>
            <span className="text-text">{fmtPct(matrix.price_change_pct)}</span>
          </div>
          <div>
            <span className="text-text-muted">OI-Δ (6h): </span>
            <span className="text-text">{fmtPct(matrix.oi_change_pct)}</span>
          </div>
          <div className="col-span-2">
            <span className="text-text-muted">OI/Preis-Quadrant: </span>
            <span className="text-text">
              {matrix.oi_price_quadrant
                ? QUADRANT_LABELS[matrix.oi_price_quadrant] ?? matrix.oi_price_quadrant
                : "—"}
            </span>
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Makro/Sentiment
          </div>
          <div>
            <span className="text-text-muted">Liq.-Cluster-Density: </span>
            <span className="text-text">{fmtNum(matrix.liq_cluster_density, 2)}</span>
          </div>
          <div>
            <span className="text-text-muted">Net-Taker-Flow: </span>
            <span className="text-text">{fmtNum(matrix.net_taker_flow_ratio, 3)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        5-Säulen-Regime-Engine (research-python/src/regime.py-Gegenstück) — regelbasiert, kein
        Handelssignal.
      </p>
    </section>
  );
}
