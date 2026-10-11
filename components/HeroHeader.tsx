"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EconomicCalendarEvent,
  EtfFlowDay,
  MarketRegime,
  MarketState,
  SystemBriefingSnapshot,
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
  regimeDescription,
  shouldSuppressRegimeDirectionalLabel,
} from "@/lib/marketRegime";
import type { ConfluenceScoreResult } from "@/lib/confluenceScoreContext";
import type { RegimeScoreResult } from "@/lib/regimeScoreContext";
import {
  buildLagebildSentence,
  countMtfDirections,
  detectMtfStateConflict,
  regimeLean,
  setupLead,
} from "@/lib/lagebild";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import { getSalomonInterpretation } from "@/lib/salomonInterpretation";
import { detectMomentumDivergence } from "@/lib/momentumDivergence";
import { computeSystemBriefingVsStateDivergence } from "@/lib/divergenceRadar";
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
import {
  RelativeTime,
  FullDateTime,
  hoursSince,
  RELATIVE_REFRESH_MS,
} from "@/components/ClientTimestamp";
import StatusLineSummary, { type StatusLineItem } from "@/components/StatusLineSummary";
import TradingHoursBadge from "@/components/TradingHoursBadge";
import EconomicHeroBadge from "@/components/EconomicHeroBadge";
import MasterReportHeroCard from "@/components/MasterReportHeroCard";
import PanelInfo from "@/components/PanelInfo";
import { marketStateInfo, MARKET_STATE_FACTOR_INFO, momentumDivergenceInfo } from "@/lib/panelInfo";
import { fetchMtfDots, type MtfTimeframeDot } from "@/lib/mtfSignal";
import {
  PATTERN_DIRECTION,
  PATTERN_DIRECTION_LABEL,
  RISK_ELEVATING_PATTERN_NAMES,
} from "@/lib/patternDirection";
import MtfDotsRow from "@/components/MtfDotsRow";

const CUMULATIVE_ETF_DAYS = 5;

// Ab diesem Alter wird die KI-Einordnung nicht nur ausgeblendet, sondern
// automatisch EINMAL neu generiert (siehe Effect unten) -- bewusst enger als
// der allgemeine STALE_HOURS_THRESHOLD (12h, ClientTimestamp.tsx), der nur
// fuer reine Anzeige-Badges ohne eigene Aktion gilt.
const NARRATIVE_AUTO_REFRESH_HOURS = 6;

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Die KI-Einordnung zeigt das FAZIT (kernaussage) des System-Briefing-
// Snapshots -- das ist bereits die kurze 1-2-saetzige Zusammenfassung
// (siehe lib/types.ts::SystemBriefingResult), keine clientseitige Kuerzung.
const SHORT_NARRATIVE_INFO_TEXT = [
  "Was das ist: das Fazit der System-Briefing-Einordnung (Regelwerk + Nexus-Faktoren) als schneller Überblick direkt hier oben -- dieselbe Analyse wie unten in der System-Briefing-Kachel, nicht extra generiert.",
  "Andere Engine als das grosse Badge oben: das Badge ist die regelbasierte 14-Faktoren-Gesamteinschätzung, diese Box wendet dein eigenes Regelwerk (Welz/Salomon/\"Mein Trading System\") AUF diese Einschätzung an -- beide können unterschiedlicher Meinung sein. Weicht der aktuelle Stand tatsächlich ab, erscheint hier ein Warnhinweis (⚠) statt zwei stillschweigend widersprüchlichen Badges.",
  `Automatische Aktualisierung: ist der zuletzt generierte Stand älter als ${NARRATIVE_AUTO_REFRESH_HOURS} Std., löst diese Kachel automatisch EINEN neuen System-Briefing-Aufruf aus (kostenloses Gratis-Tier, wie jede andere KI-Kachel) -- bis dahin wird kein veralteter Text angezeigt. Ein manueller Klick auf "Neu generieren" auf der System-Briefing-Kachel (Reiter "KI & Tools") funktioniert weiterhin unabhängig davon.`,
  "Wichtig: Preis-/EMA-/sonstige Zahlen IM TEXT sind der Stand zum Generierungszeitpunkt (siehe Zeitstempel darunter), keine Live-Werte. Für den Live-Preis immer die BTC-Preis-Kachel nutzen.",
].join("\n\n");

function formatUsdM(value: number) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(1)}M`;
}

// Lagebild: fest platzierte Synthese ganz oben auf dem Dashboard. Ein Poll
// auf market_states liefert Zustand, Fazit-Satz und Detail; Setup-/Regime-
// Score, MTF-Ampel und Marktphase stehen als Kennzahlen daneben. Alles
// Weitere (Statuszeilen, 14 Faktoren, Muster, Risikofaktoren, Master-Report,
// vollstaendige Score-Karten) liegt im Aufklapper "Warum?".
//
// Die MTF-Ampel (5 Zeitrahmen, mit ADX-Nuance) ist die einzige Quelle fuer
// die Zeitrahmen-Lage -- die alte MTF-Alignment-% (nur 1H/4H/1D) konnte einen
// echten 15M-Gegentrend verdecken. Die KI-Einordnung stammt aus einer
// anderen Engine (dein Regelwerk) und wird bei Abweichung explizit gewarnt
// (briefingDivergence) statt stillschweigend widerspruechlich zu wirken.

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

// Der Warn-Muster-Badge nennt Muster und Richtung direkt im Text (aus
// state.patterns, Richtung aus lib/patternDirection.ts). Muster, die den
// "warning_pattern"-Risk-Factor ausloesen (RISK_ELEVATING_PATTERN_NAMES,
// identisch zu compute-market-state), werden deshalb aus der allgemeinen
// Muster-Reihe herausgefiltert, damit sie nicht doppelt erscheinen.
// "Bullish Confirmation" ist kein Risk-Factor und bleibt in der Muster-Reihe.

function riskFactorLabel(factor: string, patterns: { name: string }[]): string {
  if (factor === "warning_pattern" && patterns.length > 0) {
    const named = patterns
      .map((p) => {
        const direction = PATTERN_DIRECTION[p.name];
        return direction ? `${p.name} (${PATTERN_DIRECTION_LABEL[direction]})` : p.name;
      })
      .join(", ");
    return `Warn-Muster: ${named}`;
  }
  return RISK_FACTOR_LABELS[factor] ?? factor;
}

// Erklaerungstext je Risk-Factor (Nutzer-Feedback: "warn-muster erkannt:
// kann das erklaert werden? idee: wenn ich es druecke kommt erklaerung").
// Feste, allgemeine Erklaerung je Faktor-TYP (nicht pro Vorkommnis) --
// dieselben fuenf Schwellenwerte/Bedingungen wie in compute-market-state
// (Risk-Abschnitt), hier nur in Textform uebersetzt.
const RISK_FACTOR_EXPLANATIONS: Record<string, string> = {
  warning_pattern:
    "Mindestens eines von vier Warn-Mustern wurde erkannt: „Fragile Bullish“ — bärisch (Struktur bullisch, aber Orderflow bestätigt nicht), „Distribution Warning“ — bärisch (Preis nahe 20-Perioden-Hoch, aber fallender Orderflow), „Capitulation“ — bärisch (RSI überverkauft + fallender Orderflow + überdurchschnittliche Liquidationen) oder „Short Squeeze“ — bullisch (Positionierungs-Divergenz deutet auf Squeeze-Setup). Muster, Richtung und Begründung stehen bereits hier vollständig beisammen — bewusst keine zusätzliche, inhaltsgleiche Pattern-Badge mehr oben, um dieselbe Information nicht doppelt zu zeigen.",
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
  upcomingEconomicEvents,
  initialSystemBriefing,
  initialMtfDots,
  setupScore,
  regimeScore,
  scoreDetails,
}: {
  initialState: MarketState | null;
  initialRegime: MarketRegime | null;
  timeframe: TimeframeId;
  // Statisch pro Seitenaufruf (SSR-Prop aus app/page.tsx, dieselben
  // Rohdaten wie EtfFlowPanel) -- die Statuszeile aktualisiert dies bewusst
  // nicht per eigenem Live-Poll (ETF-Flows aendern sich langsamer als
  // Preis/OI/Regime), um keine zusaetzliche Polling-Schleife fuer die
  // Zusammenfassung einzufuehren. Die EtfFlowPanel-Kachel unten bleibt die
  // live aktualisierte Quelle.
  recentEtfFlows: EtfFlowDay[];
  // Statisch pro Seitenaufruf, dieselbe SSR-Quelle wie EconomicCalendarPanel
  // (getUpcomingEconomicEvents() in app/page.tsx) -- die Handelszeiten-Kachel
  // rechnet rein clientseitig gegen die Systemzeit weiter, braucht also
  // keinen eigenen Live-Poll dieser sich ohnehin selten aendernden Termine.
  upcomingEconomicEvents: EconomicCalendarEvent[];
  // Auszug des ohnehin vorhandenen System-Briefing-Snapshots fuer die
  // KI-Einordnung, kein eigener Fetch/Poll/Button hier.
  initialSystemBriefing: SystemBriefingSnapshot | null;
  // MTF-Ampel (lib/mtfSignal.ts) -- 15M/1H/4H/1D/1W mit Trend-vs-
  // Trendbildung-Unterscheidung, unabhaengig vom mtf_alignment-Feld in state.
  initialMtfDots: MtfTimeframeDot[];
  // Setup-/Regime-Score als Kennzahlen oben, die vollstaendigen Karten
  // (scoreDetails) im Aufklapper "Warum?".
  setupScore: ConfluenceScoreResult;
  regimeScore: RegimeScoreResult;
  scoreDetails: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [regime, setRegime] = useState(initialRegime);
  const [mtfDots, setMtfDots] = useState(initialMtfDots);
  const [expandedRiskFactor, setExpandedRiskFactor] = useState<string | null>(null);
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();
  const { latest: latestSnapshot } = useLivePriceData();

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

  useEffect(() => {
    const interval = setInterval(async () => {
      setMtfDots(await fetchMtfDots());
    }, MARKET_STATE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Eine veraltete KI-Einordnung darf nie als aktueller Zustand lesbar sein
  // (Preise im Fliesstext stammen vom Generierungszeitpunkt). Ab
  // NARRATIVE_AUTO_REFRESH_HOURS wird automatisch EIN neuer Snapshot
  // angefordert (dieselbe Route wie "Neu generieren" in SystemBriefingCard,
  // inkl. deren Rate-Limit); narrativeAutoRefreshAttemptedRef begrenzt das
  // auf einen Versuch pro Mount. Start bei "unknown" (kein Text), damit vor
  // der ersten Date.now()-abhaengigen Berechnung nie ein potenziell
  // veralteter Text aufblitzt (Hydration, vgl. ClientTimestamp.tsx).
  const [narrativeSnapshot, setNarrativeSnapshot] = useState(initialSystemBriefing);
  const [narrativeFreshness, setNarrativeFreshness] = useState<"unknown" | "fresh" | "stale">("unknown");
  const [narrativeHoursOld, setNarrativeHoursOld] = useState<number | null>(null);
  const [narrativeRefreshing, setNarrativeRefreshing] = useState(false);
  const [narrativeRefreshError, setNarrativeRefreshError] = useState<string | null>(null);
  const narrativeAutoRefreshAttemptedRef = useRef(false);

  useEffect(() => {
    if (!narrativeSnapshot?.result?.fazit?.kernaussage) return;
    const update = async () => {
      const hours = hoursSince(narrativeSnapshot.generated_at, Date.now());
      setNarrativeHoursOld(hours);
      if (hours < NARRATIVE_AUTO_REFRESH_HOURS) {
        setNarrativeFreshness("fresh");
        return;
      }
      setNarrativeFreshness("stale");
      if (narrativeAutoRefreshAttemptedRef.current) return;
      narrativeAutoRefreshAttemptedRef.current = true;
      setNarrativeRefreshing(true);
      setNarrativeRefreshError(null);
      try {
        const res = await fetch("/api/system-briefing/generate", { method: "POST" });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
        setNarrativeSnapshot(json.snapshot as SystemBriefingSnapshot);
      } catch (err) {
        setNarrativeRefreshError(err instanceof Error ? err.message : String(err));
      } finally {
        setNarrativeRefreshing(false);
      }
    };
    update();
    const interval = setInterval(update, RELATIVE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [narrativeSnapshot]);

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
  // Siehe StatusLineSummary.tsx: true/false markiert die beiden Zeilen, die
  // tatsaechlich Teil der Vergleichslogik oben sind (Marktphase, Spot
  // Pressure) -- die uebrigen Status-Zeilen bleiben unmarkiert (undefined),
  // da sie nie Teil von `signals` waren.
  function confirmsFor(signalName: string): boolean | undefined {
    if (!confirmation.primaryDirection) return undefined;
    if (confirmation.confirming.includes(signalName)) return true;
    if (confirmation.contradicting.includes(signalName)) return false;
    return undefined;
  }

  // Statuszeilen: eine Zeile je Sparte mit eigenem Wert + Pfeil (4-Zustands-
  // Logik siehe lib/heroSummary.ts). Nur Sparten mit einer echten,
  // dokumentierten Richtungsaussage -- Positionierung, Liquidationen und News
  // haben laut eigener Panel-Texte keine und stehen nur in ihren Kacheln.
  const regimeSuppressed = regime !== null && shouldSuppressRegimeDirectionalLabel(regime, state.confidence);
  const regimeLabelText = regime === null
    ? "—"
    : regimeSuppressed
      ? UNCLEAR_STATE_LABEL
      : regimeLabel(regime);

  const etfCumulative = recentEtfFlows.length > 0
    ? recentEtfFlows.slice(0, CUMULATIVE_ETF_DAYS).reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0)
    : null;
  const etfDays = Math.min(recentEtfFlows.length, CUMULATIVE_ETF_DAYS);

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
      confirms: confirmsFor("Marktphase"),
    },
    {
      key: "spot-pressure",
      label: "Spot Pressure",
      valueText: spotVerdict.label,
      arrow: spotPressureArrowDirection(spotVerdict.verdict),
      confirms: confirmsFor("Spot Pressure"),
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
  ];

  const patterns = state.patterns ?? [];
  const mtf = state.mtf_alignment;
  const confidenceBreakdown = computeConfidenceBreakdown(state);
  const salomonInterpretation = getSalomonInterpretation(patterns, mtf);
  const momentumDivergence = detectMomentumDivergence(state);
  // Zwei unabhaengige Einschaetzungen: Zustand oben (14-Faktoren-Engine) und
  // KI-Einordnung (System-Briefing, wendet Tobys Regelwerk an). Gleiche
  // Berechnung wie Divergenz-Radar (systemBriefingVsState), direkt aus den
  // bereits geladenen state/narrativeSnapshot-Werten.
  const briefingDivergence = computeSystemBriefingVsStateDivergence(
    narrativeSnapshot?.result?.fazit?.bias,
    state.overall_state
  );

  const mtfCounts = countMtfDirections(mtfDots);
  const mtfConflict = detectMtfStateConflict(state.overall_state, suppressed, mtfDots);
  const lead = setupLead(setupScore);
  const lean = regimeLean(regimeScore);
  const sentence = buildLagebildSentence({
    overallState: state.overall_state,
    directionSuppressed: suppressed,
    conflict: mtfConflict,
    dots: mtfDots,
    setup: lead,
    regime: lean,
  });
  const fazit = narrativeSnapshot?.result?.fazit;
  const livePrice = latestSnapshot?.last_price ?? null;

  return (
    <section className="rounded-lg border border-accent/40 bg-surface-raised p-5 sm:p-6 space-y-4">
      {/* Oben Aussage + vier Kennzahlen, alles Weitere im Aufklapper "Warum?"
          (siehe NEXUS-STRUKTUR-KONZEPT Abschnitt 8). */}
      <div className="flex items-start justify-between flex-wrap gap-x-6 gap-y-2">
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-faint">Lagebild BTC/USDT</p>
            <PanelInfo title="Gesamteinschätzung" content={marketStateInfo} />
          </span>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className={`text-3xl sm:text-4xl font-bold ${badgeColor}`}>
              {suppressed ? "Unklar" : displayLabel}
            </p>
            <p className="text-xs text-text-faint">
              {suppressed
                ? `berechnet ${STATE_LABELS[state.overall_state]}, Verlässlichkeit ${Math.round(state.confidence)}/100 (für eine Richtung nötig: ${DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD})`
                : `Verlässlichkeit ${Math.round(state.confidence)}/100`}
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          {livePrice !== null && (
            <p className="tabular font-mono text-xl text-text">
              {livePrice.toLocaleString("de-CH", { maximumFractionDigits: 0 })} USD
            </p>
          )}
          <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
        </div>
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Gesamteinschätzung wird angezeigt.
        </p>
      )}

      <p className="text-sm text-text leading-relaxed">{sentence}</p>

      {mtfConflict && (
        <p className="rounded-md border border-down/45 bg-down/10 px-3 py-2 text-xs text-text-muted">
          <span className="font-semibold text-down">Widerspruch zur MTF-Ampel.</span> Die
          Gesamteinschätzung zeigt {mtfConflict.direction}, aber {mtfConflict.opposing} von{" "}
          {mtfConflict.total} Zeitrahmen zeigen in die Gegenrichtung. Die Richtungsaussage ist mit
          Vorsicht zu lesen.
        </p>
      )}

      {momentumDivergence.triggered && (
        <p className="flex items-center gap-1 text-xs text-down/90">
          ⚠️ Momentum bestätigt den Trend nicht mehr (Prototyp-Hinweis)
          <PanelInfo title="Momentum-Divergenz-Hinweis" content={momentumDivergenceInfo} />
        </p>
      )}

      <TradingHoursBadge events={upcomingEconomicEvents} />
      <EconomicHeroBadge events={upcomingEconomicEvents} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-md border border-border bg-surface p-3 space-y-1">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Setup-Score</p>
          {lead ? (
            <>
              <p className="text-base font-semibold">
                <span className={lead.side === "Long" ? "text-up" : "text-down"}>{lead.side}</span>{" "}
                <span className="tabular font-mono">{lead.probability.toFixed(1)} %</span>
              </p>
              <p className="text-xs text-text-faint">
                {lead.tier}
                {lead.otherProbability !== null &&
                  ` · ${lead.otherSide} ${lead.otherProbability.toFixed(1)} %`}
              </p>
            </>
          ) : (
            <p className="text-xs text-text-faint">Keine Daten</p>
          )}
        </div>
        <div className="rounded-md border border-border bg-surface p-3 space-y-1">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Regime-Score</p>
          {lean && regimeScore.up && regimeScore.down ? (
            <>
              <p
                className={`text-base font-semibold ${
                  lean === "aufwärts" ? "text-up" : lean === "abwärts" ? "text-down" : "text-text-muted"
                }`}
              >
                {lean === "aufwärts" ? "Aufwärts" : lean === "abwärts" ? "Abwärts" : "Ausgeglichen"}
              </p>
              <p className="text-xs text-text-faint">
                Auf {regimeScore.up.probability.toFixed(1)} % · Ab {regimeScore.down.probability.toFixed(1)} % ·
                in Aufbau
              </p>
            </>
          ) : (
            <p className="text-xs text-text-faint">Keine Daten</p>
          )}
        </div>
        <div className="rounded-md border border-border bg-surface p-3 space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">MTF-Ampel</p>
          <MtfDotsRow dots={mtfDots} />
          <p className="text-xs text-text-faint">
            {mtfCounts.bullish} bullisch · {mtfCounts.bearish} bärisch · {mtfCounts.neutral} neutral
          </p>
        </div>
        <div className="rounded-md border border-border bg-surface p-3 space-y-1">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Marktphase</p>
          <p className="text-base font-semibold text-text">{regimeLabelText}</p>
          {regime !== null && !regimeSuppressed && (
            <p className="text-xs text-text-faint line-clamp-2" title={regimeDescription(regime)}>
              {regimeDescription(regime)}
            </p>
          )}
        </div>
      </div>

      {/* KI-Einordnung: Fazit des System-Briefings mit Zeitstempel. Ab
          NARRATIVE_AUTO_REFRESH_HOURS wird automatisch EIN neuer Snapshot
          angefordert (siehe Effect oben). */}
      <div className="pt-3 border-t border-border/60 space-y-1.5">
        <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap text-xs">
          <span className="text-text-muted">KI-Einordnung (System-Briefing)</span>
          <PanelInfo title="KI-Einordnung" content={SHORT_NARRATIVE_INFO_TEXT} />
          {fazit && narrativeFreshness === "fresh" && (
            <>
              <span
                className={`px-1.5 py-0.5 text-[11px] rounded-md border font-medium ${
                  fazit.bias === "bullish"
                    ? "border-up/40 bg-up/10 text-up"
                    : fazit.bias === "bearish"
                      ? "border-down/40 bg-down/10 text-down"
                      : "border-border text-text-faint"
                }`}
              >
                {fazit.bias === "bullish" ? "Bullisch" : fazit.bias === "bearish" ? "Bärisch" : "Neutral"}
              </span>
              <span className="tabular text-text-muted">Briefing-Überzeugungsgrad {fazit.confidence}/100</span>
              {narrativeSnapshot && (
                <FullDateTime iso={narrativeSnapshot.generated_at} className="text-text-faint" />
              )}
            </>
          )}
        </div>
        {briefingDivergence === "DIVERGENCE" && narrativeFreshness === "fresh" && (
          <p className="text-xs text-down">
            ⚠ Weicht von der Gesamteinschätzung ab (14-Faktoren-Engine vs. dein Regelwerk) — ein echter
            Widerspruch, kein Darstellungsfehler.
          </p>
        )}
        {!fazit?.kernaussage ? (
          <p className="text-xs text-text-faint">
            Noch keine Einordnung generiert — siehe System-Briefing (Reiter &quot;KI &amp; Tools&quot;).
          </p>
        ) : narrativeFreshness === "stale" ? (
          narrativeRefreshError ? (
            <p className="text-xs text-down">
              Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.), automatische Aktualisierung
              fehlgeschlagen ({narrativeRefreshError}) — im System-Briefing (Reiter &quot;KI &amp;
              Tools&quot;) manuell neu generieren.
            </p>
          ) : (
            <p className="text-xs text-text-faint">
              Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.) —{" "}
              {narrativeRefreshing ? "wird automatisch aktualisiert…" : "Aktualisierung wird angefordert…"}
            </p>
          )
        ) : narrativeFreshness === "fresh" ? (
          <p className="text-sm text-text-muted leading-relaxed">{fazit.kernaussage}</p>
        ) : null}
      </div>

      <details className="pt-3 border-t border-border/60">
        <summary className="text-xs text-text-muted hover:text-text cursor-pointer select-none">
          Warum? Faktoren und Signale im Detail
        </summary>

        <div className="pt-3 space-y-4">
          <StatusLineSummary
            items={statusLines}
            heading={
              confirmation.primaryDirection && confirmation.totalComparable > 0
                ? `${confirmation.confirmingCount} von ${confirmation.totalComparable} unabhängigen Signalen bestätigen (✓/✗ unten)`
                : undefined
            }
          />

          <div className="space-y-3">
            <span className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs uppercase tracking-[0.15em] text-text-muted">
                Gesamteinschätzung im Detail
              </h3>
              <span className="text-[10px] text-text-faint border border-border rounded px-1">
                wird neu validiert
              </span>
            </span>
            <p className="text-sm text-text-muted leading-relaxed">{buildCompactMarketStateSummary(state)}</p>

            <div className="flex gap-x-4 gap-y-1 flex-wrap items-baseline text-xs text-text-faint">
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
                  Risk:{" "}
                  <span className={riskColor(state.risk_level)}>
                    {RISK_LABELS[state.risk_level] ?? state.risk_level}
                  </span>
                </span>
              )}
            </div>

            {patterns.filter((p) => !RISK_ELEVATING_PATTERN_NAMES.has(p.name)).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {patterns
                  .filter((p) => !RISK_ELEVATING_PATTERN_NAMES.has(p.name))
                  .map((p) => (
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

            {salomonInterpretation && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border text-text-faint w-fit">
                Salomon: {salomonInterpretation.phase}
                <PanelInfo title={`Salomon: ${salomonInterpretation.phase}`} content={salomonInterpretation.sentence} />
              </span>
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
                      {riskFactorLabel(f, patterns)}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
              {FACTOR_GROUPS.map((group) => {
                const rows = group.keys
                  .map((key) => ({ key, factor: state.factors?.[key] }))
                  .filter((r): r is { key: string; factor: MarketState["factors"][string] } => !!r.factor);
                if (rows.length === 0) return null;
                return (
                  <div key={group.title} className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                    <div className="sm:col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
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

            <p className="text-xs text-text-faint">
              Kombiniert 14 unabhängige Datenquellen zu einem Gesamtzustand — Rohmaterial für eine
              Einordnung, kein Handelssignal.
            </p>
          </div>

          <MasterReportHeroCard
            overallState={state.overall_state}
            briefingBias={narrativeSnapshot?.result?.fazit?.bias}
          />

          {scoreDetails}
        </div>
      </details>
    </section>
  );
}
