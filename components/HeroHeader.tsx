"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EconomicCalendarEvent,
  EtfFlowDay,
  MarketRegime,
  MarketState,
  SystemBriefingConfig,
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
import BriefingScheduleSettings from "@/components/BriefingScheduleSettings";
import PanelInfo from "@/components/PanelInfo";
import SystemBriefingDetails, { isValidSystemBriefingResult } from "@/components/SystemBriefingDetails";
import { marketStateInfo, MARKET_STATE_FACTOR_INFO, momentumDivergenceInfo } from "@/lib/panelInfo";
import { fetchMtfDots, type MtfTimeframeDot } from "@/lib/mtfSignal";
import { computePriceChanges, fetchPriceReferences, type PriceReference } from "@/lib/priceChanges";
import { formatUsd } from "@/lib/livePriceFormat";
import { RISK_ELEVATING_PATTERN_NAMES } from "@/lib/patternDirection";
import MtfDotsRow from "@/components/MtfDotsRow";
import {
  FACTOR_GROUPS,
  FACTOR_LABELS,
  RISK_FACTOR_EXPLANATIONS,
  RISK_LABELS,
  factorColor,
  factorLabel,
  factorRawValueLabel,
  riskColor,
  riskFactorLabel,
} from "@/lib/marketStateFactors";
import { setVisibleInterval } from "@/lib/visibleInterval";

const CUMULATIVE_ETF_DAYS = 5;

// Ab diesem Alter wird die KI-Einordnung nicht nur ausgeblendet, sondern
// automatisch EINMAL neu generiert (siehe Effect unten) -- bewusst enger als
// der allgemeine STALE_HOURS_THRESHOLD (12h, ClientTimestamp.tsx), der nur
// fuer reine Anzeige-Badges ohne eigene Aktion gilt. 8h: etwas mehr als
// die groesste Luecke im geplanten Zeitplan (system_briefing_config), damit
// der Nachlauf nur bei einem ausgefallenen geplanten Lauf einspringt statt
// zusaetzliche Gratis-Kontingente zu verbrauchen.
const NARRATIVE_AUTO_REFRESH_HOURS = 8;

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Die KI-Einordnung zeigt das FAZIT (kernaussage) des System-Briefing-
// Snapshots -- das ist bereits die kurze 1-2-saetzige Zusammenfassung
// (siehe lib/types.ts::SystemBriefingResult), keine clientseitige Kuerzung.
const SHORT_NARRATIVE_INFO_TEXT = [
  "Was das ist: das Fazit des System-Briefings -- eine KI-Synthese, die dein eigenes Regelwerk (Welz/Salomon-Methodik + \"Mein Trading System\"-Checkliste) und die berechnete Chart-Struktur auf den aktuellen Stand von Nexus' Faktoren anwendet (Bewegungsvorrat, 14-Faktoren-Engine, VWAP-Vector/CVD, Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News).",
  "Im Aufklapper darunter der ganze BTC-Marktbericht: Marktupdate, Momentum (RSI), Bitcoin Chart mit beiden Szenarien, Liquidationen, ETF-Flows, Wirtschaftskalender und dein Regelwerk-Check -- jedes Kursziel entspricht einem echten Key Level, nie einer frei geschätzten Zahl. Entscheidungsunterstützung, keine Anlageberatung.",
  "Andere Engine als das grosse Badge oben: das Badge ist die regelbasierte 14-Faktoren-Gesamteinschätzung, diese Box wendet dein eigenes Regelwerk (Welz/Salomon/\"Mein Trading System\") AUF diese Einschätzung an -- beide können unterschiedlicher Meinung sein. Weicht der aktuelle Stand tatsächlich ab, erscheint hier ein Warnhinweis (⚠) statt zwei stillschweigend widersprüchlichen Badges.",
  `Automatische Aktualisierung: ist der zuletzt generierte Stand älter als ${NARRATIVE_AUTO_REFRESH_HOURS} Std., löst das Lagebild automatisch EINEN neuen System-Briefing-Aufruf aus -- bis dahin wird kein veralteter Text angezeigt. Normalerweise läuft das Briefing aber zu den Uhrzeiten unter "Zeitplan & Benachrichtigungen" (dort auch E-Mail/Push), "Neu generieren" stösst jederzeit manuell einen neuen Lauf an.`,
  "Seit dem letzten Lauf: vergleicht das Fazit mit dem vorherigen Briefing (Richtung, Überzeugungsgrad, Kernaussage) -- übernommen vom früheren Master-Report.",
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
// Weitere (Statuszeilen, 14 Faktoren, Muster, Risikofaktoren, vollstaendige
// Score-Karten) liegt im Aufklapper "Warum?".
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
  initialBriefingConfig,
  initialMtfDots,
  initialPriceReferences,
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
  // Zeitplan/E-Mail/Push des Briefings (system_briefing_config).
  initialBriefingConfig: SystemBriefingConfig | null;
  // MTF-Ampel (lib/mtfSignal.ts) -- 15M/1H/4H/1D/1W mit Trend-vs-
  // Trendbildung-Unterscheidung, unabhaengig vom mtf_alignment-Feld in state.
  initialMtfDots: MtfTimeframeDot[];
  // Kurs vor 1H/4H/1D/1W (lib/priceChanges.ts), die Veraenderung rechnet
  // gegen den Live-Preis.
  initialPriceReferences: PriceReference[];
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
  const [priceReferences, setPriceReferences] = useState(initialPriceReferences);
  const [expandedRiskFactor, setExpandedRiskFactor] = useState<string | null>(null);
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();
  const { latest: latestSnapshot } = useLivePriceData();

  useEffect(() => {
    const load = async () => {
      const { data, ok } = await fetchLatestState();
      setLastSyncOk(ok);
      if (ok && data) setState(data);
    };
    const stopPolling = setVisibleInterval(load, MARKET_STATE_REFRESH_MS);
    return () => stopPolling();
  }, []);

  useEffect(() => {
    const stopPolling = setVisibleInterval(async () => {
      const data = await fetchLatestRegime();
      setRegime(data);
    }, REGIME_REFRESH_MS);
    return () => stopPolling();
  }, []);

  useEffect(() => {
    const stopPolling = setVisibleInterval(async () => {
      setMtfDots(await fetchMtfDots());
    }, MARKET_STATE_REFRESH_MS);
    return () => stopPolling();
  }, []);

  useEffect(() => {
    const stopPolling = setVisibleInterval(async () => {
      setPriceReferences(await fetchPriceReferences());
    }, MARKET_STATE_REFRESH_MS);
    return () => stopPolling();
  }, []);

  // Eine veraltete KI-Einordnung darf nie als aktueller Zustand lesbar sein
  // (Preise im Fliesstext stammen vom Generierungszeitpunkt). Ab
  // NARRATIVE_AUTO_REFRESH_HOURS wird automatisch EIN neuer Snapshot
  // angefordert (dieselbe Route wie "Neu generieren" unten, inkl. deren
  // Rate-Limit); narrativeAutoRefreshAttemptedRef begrenzt das
  // auf einen Versuch pro Mount. Start bei "unknown" (kein Text), damit vor
  // der ersten Date.now()-abhaengigen Berechnung nie ein potenziell
  // veralteter Text aufblitzt (Hydration, vgl. ClientTimestamp.tsx).
  const [narrativeSnapshot, setNarrativeSnapshot] = useState(initialSystemBriefing);
  const [narrativeFreshness, setNarrativeFreshness] = useState<"unknown" | "fresh" | "stale">("unknown");
  const [narrativeHoursOld, setNarrativeHoursOld] = useState<number | null>(null);
  const [narrativeRefreshing, setNarrativeRefreshing] = useState(false);
  const [narrativeRefreshError, setNarrativeRefreshError] = useState<string | null>(null);
  const narrativeAutoRefreshAttemptedRef = useRef(false);

  async function generateBriefing() {
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
  }

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
      await generateBriefing();
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
  // Aeltere Snapshot-Formate (vor der Zusammenlegung mit Chart-Narrativ)
  // haben kein vollstaendiges Ergebnis -- dann nur das Fazit, keine Details.
  const briefingDetails =
    narrativeSnapshot?.result && isValidSystemBriefingResult(narrativeSnapshot.result)
      ? narrativeSnapshot.result
      : null;
  const livePrice = latestSnapshot?.last_price ?? null;
  const priceChanges = computePriceChanges(livePrice, priceReferences);

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
          {priceChanges.length > 0 && (
            <dl className="grid grid-cols-4 gap-x-3 mt-1 text-xs tabular font-mono">
              {priceChanges.map(({ label, abs, pct }) => (
                <div key={label} className="sm:text-right">
                  <dt className="text-text-faint font-sans">{label}</dt>
                  <dd className={abs >= 0 ? "text-up" : "text-down"}>
                    {abs >= 0 ? "▲" : "▼"} {formatUsd(Math.abs(abs), 0)}
                  </dd>
                  <dd className={abs >= 0 ? "text-up" : "text-down"}>
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(1)} %
                  </dd>
                </div>
              ))}
            </dl>
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
            {mtfCounts.bullish} bullisch
            {mtfCounts.bullishForming > 0 && ` (${mtfCounts.bullishForming} in Bildung)`} · {mtfCounts.bearish} bärisch
            {mtfCounts.bearishForming > 0 && ` (${mtfCounts.bearishForming} in Bildung)`} · {mtfCounts.neutral} neutral
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
          <button
            type="button"
            onClick={generateBriefing}
            disabled={narrativeRefreshing}
            className="ml-auto px-2.5 py-1 text-[11px] rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {narrativeRefreshing ? "Generiert…" : "Neu generieren"}
          </button>
        </div>
        {briefingDivergence === "DIVERGENCE" && narrativeFreshness === "fresh" && (
          <p className="text-xs text-down">
            ⚠ Weicht von der Gesamteinschätzung ab (14-Faktoren-Engine vs. dein Regelwerk) — ein echter
            Widerspruch, kein Darstellungsfehler.
          </p>
        )}
        {!fazit?.kernaussage ? (
          narrativeRefreshError ? (
            <p className="text-xs text-down">Generierung fehlgeschlagen: {narrativeRefreshError}</p>
          ) : (
            <p className="text-xs text-text-faint">
              {narrativeRefreshing ? "Einordnung wird generiert…" : "Noch keine Einordnung generiert."}
            </p>
          )
        ) : narrativeFreshness === "stale" ? (
          narrativeRefreshError ? (
            <p className="text-xs text-down">
              Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.), Aktualisierung fehlgeschlagen (
              {narrativeRefreshError}).
            </p>
          ) : (
            <p className="text-xs text-text-faint">
              Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.) —{" "}
              {narrativeRefreshing ? "wird automatisch aktualisiert…" : "Aktualisierung wird angefordert…"}
            </p>
          )
        ) : narrativeFreshness === "fresh" ? (
          <>
            {narrativeRefreshError && (
              <p className="text-xs text-down">Neu generieren fehlgeschlagen: {narrativeRefreshError}</p>
            )}
            {narrativeSnapshot?.result?.schlagzeile && (
              <p className="text-base font-semibold text-text leading-snug">{narrativeSnapshot.result.schlagzeile}</p>
            )}
            <p className="text-sm text-text-muted leading-relaxed">{fazit.kernaussage}</p>
            {narrativeSnapshot?.result?.aenderungSeitLetztem && (
              <p className="text-xs text-text-faint italic leading-relaxed">
                Seit dem letzten Lauf: {narrativeSnapshot.result.aenderungSeitLetztem}
              </p>
            )}
          </>
        ) : null}

        {briefingDetails && narrativeFreshness === "fresh" && (
          <details className="pt-1">
            <summary className="text-xs text-text-muted hover:text-text cursor-pointer select-none">
              Ganzer Marktbericht (Chart, Szenarien, Liquidationen, ETF, Kalender, Regelwerk)
            </summary>
            <div className="pt-2">
              <SystemBriefingDetails result={briefingDetails} />
            </div>
          </details>
        )}

        <details className="pt-1">
          <summary className="text-xs text-text-muted hover:text-text cursor-pointer select-none">
            Zeitplan &amp; Benachrichtigungen
          </summary>
          <div className="pt-2">
            <BriefingScheduleSettings initialConfig={initialBriefingConfig} />
          </div>
        </details>
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

          {scoreDetails}
        </div>
      </details>
    </section>
  );
}
