"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EconomicCalendarEvent,
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
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
  buildCompactMarketStateSummary,
  computeConfidenceBreakdown,
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
import TradingHoursBadge from "@/components/TradingHoursBadge";
import PanelInfo from "@/components/PanelInfo";
import { marketStateInfo, MARKET_STATE_FACTOR_INFO } from "@/lib/panelInfo";

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

// Ebene 0/1 der Dashboard-Hierarchie (Nutzer-Feedback vom 31.08.2026,
// "Grundidee: kompakte App mit einem Hinweis, wohin der Kurs geht").
//
// 13.09.2026 -- verschmolzen mit der vormals separaten MarketStateCard
// ("Gesamteinschätzung"): beide zeigten dieselbe market_states-Zeile mit
// eigenem, unabhaengigem 60s-Poll -- Badge+Zeitstempel und die
// Verlaesslichkeits-Zahl standen dadurch zweimal direkt untereinander auf
// der Seite (per Screenshot entdeckt, nachdem ein erster Versuch nur den
// Kurzsatz dedupliziert hatte). Jetzt EIN Poll, EINE Sektion: oben die
// Kurzuebersicht (Badge, Kurzsatz, Handelszeiten, Bestaetigung,
// Status-Zeilen aller Sparten), unten als Fortsetzung derselben Box das
// Gesamteinschaetzung-spezifische Detail (Konfidenz-Aufschluesselung,
// Muster, Risk-Faktoren, 14-Faktoren-Aufklapper) -- kein Datenverlust,
// keine Kachel weniger nur aus Marketing-Gruenden, sondern weil es
// tatsaechlich derselbe Rechenweg war.

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
    console.error("Fehler beim Laden des Market State (Hero):", error.message);
    return { data: null, ok: false };
  }
  return { data, ok: true };
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
  upcomingEconomicEvents,
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
  // Statisch pro Seitenaufruf, dieselbe SSR-Quelle wie EconomicCalendarPanel
  // (getUpcomingEconomicEvents() in app/page.tsx) -- die Handelszeiten-Kachel
  // rechnet rein clientseitig gegen die Systemzeit weiter, braucht also
  // keinen eigenen Live-Poll dieser sich ohnehin selten aendernden Termine.
  upcomingEconomicEvents: EconomicCalendarEvent[];
}) {
  const [state, setState] = useState(initialState);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [regime, setRegime] = useState(initialRegime);
  const [expanded, setExpanded] = useState(false);
  const [expandedRiskFactor, setExpandedRiskFactor] = useState<string | null>(null);
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();

  useEffect(() => {
    const load = async () => {
      const { data, ok } = await fetchLatestState();
      setLastSyncOk(ok);
      if (ok && data) setState(data);
    };
    const interval = setInterval(load, MARKET_STATE_REFRESH_MS);
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
      <section className="rounded-lg border border-accent/40 bg-surface-raised p-6">
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
        : state.overall_state === "INSUFFICIENT_DATA"
          ? "text-text-faint"
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

  const patterns = state.patterns ?? [];
  const mtf = state.mtf_alignment;
  const confidenceBreakdown = computeConfidenceBreakdown(state);

  return (
    <section className="rounded-lg border border-accent/40 bg-surface-raised p-6 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-3xl sm:text-4xl font-bold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Gesamteinschätzung wird angezeigt.
        </p>
      )}

      {suppressed && (
        <p className="text-xs text-text-faint">
          Berechneter Zustand war {STATE_LABELS[state.overall_state]}, aber Verlässlichkeit liegt unter{" "}
          {DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 — für eine Richtungsaussage zu unsicher, daher
          hier als &bdquo;{UNCLEAR_STATE_LABEL}&ldquo; angezeigt. Faktoren-Detail unten unverändert
          einsehbar.
        </p>
      )}

      <p className="text-sm text-text-muted leading-relaxed">
        {buildCompactMarketStateSummary(state)}
      </p>

      <TradingHoursBadge events={upcomingEconomicEvents} />

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

      {/* Gesamteinschaetzung-spezifisches Detail (vormals eigene
          MarketStateCard) -- Fortsetzung derselben Box statt zweiter
          Kachel, da derselbe state-Wert oben schon vollstaendig geladen
          ist. */}
      <div className="pt-3 border-t border-border/60 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-xs uppercase tracking-[0.15em] text-text-muted">
              Gesamteinschätzung im Detail
            </h3>
            <span className="text-[10px] text-text-faint border border-border rounded px-1">
              wird neu validiert
            </span>
          </span>
          <PanelInfo title="Gesamteinschätzung" content={marketStateInfo} />
        </div>

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
      </div>
    </section>
  );
}
