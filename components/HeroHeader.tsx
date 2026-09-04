"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EtfFlowDay,
  LiquidationEvent,
  MarketRegime,
  MarketState,
  NewsEvent,
} from "@/lib/types";
import type { TimeframeId } from "@/lib/timeframes";
import { deriveMarketContext } from "@/lib/marketContext";
import {
  isDirectionalLabelSuppressed,
  UNCLEAR_STATE_LABEL,
  buildCompactMarketStateSummary,
} from "@/lib/marketStateSummary";
import {
  regimeLabel,
  shouldSuppressRegimeDirectionalLabel,
} from "@/lib/marketRegime";
import {
  regimeDirection,
  spotPressureDirection,
  summarizeConfirmation,
  regimeArrowDirection,
  spotPressureArrowDirection,
  marketContextArrowDirection,
  signArrowDirection,
  type ConfirmationSignal,
} from "@/lib/heroSummary";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { RelativeTime } from "@/components/ClientTimestamp";
import StatusLineSummary, { type StatusLineItem } from "@/components/StatusLineSummary";
import EntryFilterBadge from "@/components/EntryFilterBadge";

const CUMULATIVE_ETF_DAYS = 5;
const LIQUIDATION_LOOKBACK_HOURS = 6;
const NEWS_LOOKBACK_HOURS = 72;

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatUsdM(value: number) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(1)}M`;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Ebene 0/1 der neuen Dashboard-Hierarchie (Nutzer-Feedback vom
// 31.08.2026, "Grundidee: kompakte App mit einem Hinweis, wohin der Kurs
// geht"). Reine Zusammenfassung bereits vorhandener Werte -- kein neuer
// Rechenweg, keine Aenderung an compute-market-state oder den einzelnen
// Kacheln (siehe lib/heroSummary.ts fuer die bewusst blend-freie
// Bestaetigungs-Logik).

const MARKET_STATE_REFRESH_MS = 60_000;
// Regime aendert sich hoechstens stuendlich (1H-Kerzen-Raster, siehe
// RegimeMatrixCard.tsx) -- gleicher Poll-Takt wie dort, damit Hero und
// Regime-Matrix-Kachel nie unterschiedliche Werte zeigen.
const REGIME_REFRESH_MS = 5 * 60_000;

const STATE_LABELS: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt",
  INSUFFICIENT_DATA: "Unzureichende Daten",
};

async function fetchLatestState(): Promise<MarketState | null> {
  const { data, error } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Market State (Hero):", error.message);
    return null;
  }
  return data;
}

async function fetchLatestRegime(): Promise<MarketRegime | null> {
  const { data, error } = await supabase
    .from("market_state_matrix")
    .select("regime")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Regimes (Hero):", error.message);
    return null;
  }
  return data?.regime ?? null;
}

export default function HeroHeader({
  initialState,
  initialRegime,
  timeframe,
  recentEtfFlows,
  recentLiquidations,
  highImpactNews,
}: {
  initialState: MarketState | null;
  initialRegime: MarketRegime | null;
  timeframe: TimeframeId;
  // Statisch pro Seitenaufruf (SSR-Props aus app/page.tsx, dieselben
  // Rohdaten wie EtfFlowPanel/LiquidationPanel/NewsRiskPanel) -- die
  // Statuszeile aktualisiert diese drei bewusst nicht per eigenem Live-Poll
  // (ETF/Liquidationen/News aendern sich langsamer als Preis/OI/Regime und
  // bekommen ohnehin nur den "nicht anzeigbar"-Pfeil, siehe unten), um
  // nicht drei zusaetzliche Polling-Schleifen fuer die Zusammenfassung
  // einzufuehren. Die jeweilige Detail-Kachel unten bleibt die live
  // aktualisierte Quelle.
  recentEtfFlows: EtfFlowDay[];
  recentLiquidations: LiquidationEvent[];
  highImpactNews: NewsEvent[];
}) {
  const [state, setState] = useState(initialState);
  const [regime, setRegime] = useState(initialRegime);
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchLatestState();
      if (data) setState(data);
    }, MARKET_STATE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchLatestRegime();
      setRegime(data);
    }, REGIME_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  if (!state) {
    return (
      <section className="rounded-lg border border-accent/25 bg-surface-raised p-5">
        <p className="text-sm text-text-faint">Noch keine Market-State-Daten vorhanden.</p>
      </section>
    );
  }

  const suppressed = isDirectionalLabelSuppressed(state);
  const displayLabel = suppressed
    ? UNCLEAR_STATE_LABEL
    : STATE_LABELS[state.overall_state] ?? state.overall_state;
  const badgeColor = suppressed
    ? "text-text-faint"
    : state.overall_state === "BULLISH"
      ? "text-up"
      : state.overall_state === "BEARISH"
        ? "text-down"
        : "text-text";

  // Marktkontext + Spot-Pressure aus demselben geteilten Poll-Bundle wie
  // MarketContextCard (dieselbe extrahierte Herleitung, kein separater
  // Fetch, kein neuer Rechenweg -- siehe lib/marketContext.ts::
  // deriveMarketContext).
  const marketContext = deriveMarketContext(bundle, timeframe, fetchedSinceIso, fetchedAtMs);
  const spotVerdict = marketContext.spotVerdict;

  const signals: ConfirmationSignal[] = [
    { name: "Marktphase", direction: regimeDirection(regime) },
    { name: "Spot Pressure", direction: spotPressureDirection(spotVerdict.verdict) },
  ];
  const confirmation = summarizeConfirmation(state.overall_state, state.confidence, signals);

  // Ebene-0-Statuszeilen: eine Zeile je Sparte mit ihrem eigenen, bereits
  // vorhandenen Wert + Pfeil (siehe lib/heroSummary.ts fuer die 4-Zustands-
  // Logik). Nur die 5 Sparten mit einer echten, dokumentierten
  // Richtungsaussage bekommen einen gerichteten Pfeil (Marktkontext,
  // Marktphase, Spot Pressure, Preis & OI, ETF-Flows) -- Positionierung,
  // Liquidationen und News haben laut ihrer eigenen Panel-Texte
  // ausdruecklich KEINE Kursprognose/Richtungsaussage und zeigen deshalb
  // immer "nicht anzeigbar", nie einen erfundenen neutralen Pfeil.
  const regimeSuppressed = regime !== null && shouldSuppressRegimeDirectionalLabel(regime, state.confidence);
  const regimeLabelText = regime === null
    ? "—"
    : regimeSuppressed
      ? UNCLEAR_STATE_LABEL
      : regimeLabel(regime);

  const positioningSignal = bundle.positioning_signal;

  const etfCumulative = recentEtfFlows.length > 0
    ? recentEtfFlows.slice(0, CUMULATIVE_ETF_DAYS).reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0)
    : null;
  const etfDays = Math.min(recentEtfFlows.length, CUMULATIVE_ETF_DAYS);

  // recentLiquidations/highImpactNews sind bereits serverseitig mit exakt
  // diesem Cutoff gefiltert (siehe getRecentLiquidations/getHighImpactNews
  // in app/page.tsx) -- kein zweites, clientseitiges Date.now()-Filtern
  // hier noetig (waere ausserdem ein unreiner Aufruf waehrend des Renders).
  const relevantLiquidations = recentLiquidations;
  const liqTotalNotional = relevantLiquidations.reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  const relevantNews = highImpactNews;

  const statusLines: StatusLineItem[] = [
    {
      key: "market-context",
      label: "Marktkontext",
      valueText: marketContext.result.label,
      arrow: marketContextArrowDirection(marketContext.result.scenario, marketContext.result.bias),
    },
    {
      key: "regime-matrix",
      label: "Marktphase",
      valueText: regimeLabelText,
      arrow: regimeArrowDirection(regime, regimeSuppressed),
    },
    {
      key: "spot-pressure",
      label: "Spot Pressure",
      valueText: spotVerdict.label,
      arrow: spotPressureArrowDirection(spotVerdict.verdict),
    },
    {
      key: "live-price",
      label: "Preis & Open Interest",
      valueText: `Preis ${formatSignedPct(marketContext.priceChangePct)} · OI ${formatSignedPct(marketContext.oiChangePct)}`,
      arrow: signArrowDirection(marketContext.priceChangePct),
    },
    {
      key: "etf-flow",
      label: "ETF-Flows & Makro",
      valueText:
        etfCumulative !== null
          ? `${formatUsdM(etfCumulative)} (${etfDays}T)`
          : "Keine Daten",
      arrow: signArrowDirection(etfCumulative),
    },
    {
      key: "positioning",
      label: "Positionierung",
      valueText:
        positioningSignal?.confidence !== null && positioningSignal?.confidence !== undefined
          ? `Confidence ${Math.round(positioningSignal.confidence)}/100`
          : "Keine Daten",
      arrow: "not_available",
    },
    {
      key: "liquidations",
      label: "Liquidationen",
      valueText:
        relevantLiquidations.length > 0
          ? `${formatUsd(liqTotalNotional)} · ${relevantLiquidations.length} Events (${LIQUIDATION_LOOKBACK_HOURS}h)`
          : `Keine (${LIQUIDATION_LOOKBACK_HOURS}h)`,
      arrow: "not_available",
    },
    {
      key: "news-risk",
      label: "News & Risiko",
      valueText:
        relevantNews.length > 0
          ? `${relevantNews.length} Ereignisse (${NEWS_LOOKBACK_HOURS}h)`
          : `Keine (${NEWS_LOOKBACK_HOURS}h)`,
      arrow: "not_available",
    },
  ];

  return (
    <section className="rounded-lg border border-accent/40 bg-surface-raised p-6 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-3xl sm:text-4xl font-bold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      <div className="flex gap-4 text-xs text-text-faint flex-wrap">
        <span>Verlässlichkeit: {Math.round(state.confidence)}/100</span>
      </div>

      <p className="text-sm text-text-muted leading-relaxed">
        {buildCompactMarketStateSummary(state)}
      </p>

      <EntryFilterBadge state={state} />

      {confirmation.primaryDirection && confirmation.totalComparable > 0 && (
        <p className="text-xs text-text-faint pt-2 border-t border-border/60">
          {confirmation.confirmingCount} von {confirmation.totalComparable} unabhängigen
          Signalen bestätigen
          {confirmation.confirming.length > 0 && ` (${confirmation.confirming.join(", ")})`}
          {confirmation.contradicting.length > 0 &&
            ` · widerspricht: ${confirmation.contradicting.join(", ")}`}
        </p>
      )}

      <StatusLineSummary items={statusLines} />
    </section>
  );
}
