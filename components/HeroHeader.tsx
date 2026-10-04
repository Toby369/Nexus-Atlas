"use client";

import { useEffect, useRef, useState } from "react";
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
  shouldSuppressRegimeDirectionalLabel,
} from "@/lib/marketRegime";
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

// Nutzer-Vorgabe (23.09.2026): die "Kurze Einordnung" soll nach 6 Std. nicht
// nur ausgeblendet, sondern automatisch neu generiert werden (ein einziger
// AI-Aufruf pro veraltet erkanntem Snapshot, siehe Effect weiter unten) --
// bewusst enger als der allgemeine STALE_HOURS_THRESHOLD (12h,
// ClientTimestamp.tsx), der nur fuer reine Anzeige-Badges ohne eigene
// Aktion gilt.
const NARRATIVE_AUTO_REFRESH_HOURS = 6;

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Kurze Einordnung (22.09.2026, 30.09.2026 angepasst): zeigt das FAZIT
// (kernaussage) des System-Briefing-Snapshots -- seit der Umstrukturierung
// auf vier Abschnitte (siehe lib/types.ts::SystemBriefingResult) ist das
// bereits die kurze, 1-2-saetzige Zusammenfassung, keine clientseitige
// Kuerzung eines langen Fliesstexts mehr noetig.
const SHORT_NARRATIVE_INFO_TEXT = [
  "Was das ist: das Fazit der System-Briefing-Einordnung (Regelwerk + Nexus-Faktoren) als schneller Überblick direkt hier oben -- dieselbe Analyse wie unten in der System-Briefing-Kachel, nicht extra generiert.",
  "Andere Engine als das grosse Badge oben: das Badge ist die regelbasierte 14-Faktoren-Gesamteinschätzung, diese Box wendet dein eigenes Regelwerk (Welz/Salomon/\"Mein Trading System\") AUF diese Einschätzung an -- beide können unterschiedlicher Meinung sein. Weicht der aktuelle Stand tatsächlich ab, erscheint hier ein Warnhinweis (⚠) statt zwei stillschweigend widersprüchlichen Badges.",
  `Automatische Aktualisierung: ist der zuletzt generierte Stand älter als ${NARRATIVE_AUTO_REFRESH_HOURS} Std., löst diese Kachel automatisch EINEN neuen System-Briefing-Aufruf aus (kostenloses Gratis-Tier, wie jede andere KI-Kachel) -- bis dahin wird kein veralteter Text angezeigt. Ein manueller Klick auf "Neu generieren" auf der System-Briefing-Kachel (Tab "KI-Einschätzungen") funktioniert weiterhin unabhängig davon.`,
  "Wichtig: Preis-/EMA-/sonstige Zahlen IM TEXT sind der Stand zum Generierungszeitpunkt (siehe Zeitstempel darunter), keine Live-Werte. Für den Live-Preis immer die BTC-Preis-Kachel nutzen.",
].join("\n\n");

function formatUsdM(value: number) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(1)}M`;
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
//
// 02.10.2026 -- Nutzer-Feedback "verstaendlicher, klarer, strukturierter":
// (1) MTF-Alignment-% (nur 1H/4H/1D) entfernt -- live nachgewiesen, dass sie
// einen echten 15M-Gegentrend verdecken konnte (100% Alignment trotz
// bestaetigt baerischem 15M, weil die Prozentzahl 15M/1W gar nicht erfasst);
// die MTF-Ampel (5 Zeitrahmen, mit ADX-Nuance) bleibt alleinige Quelle. (2)
// "Kurze Einordnung" (System-Briefing) jetzt als eigener, umrandeter Block
// mit explizitem Hinweis "andere Engine" + automatischer Divergenz-Warnung
// (briefingDivergence), statt stillschweigend ein zweites, potenziell
// widerspruechliches Bullisch/Baerisch-Badge unter dem oberen zu zeigen. (3)
// Die Confidence-/Risk-Detailzeile in "Datenqualitaet" vs. "Marktlage"
// gruppiert statt einer flachen 5-6-Werte-Zeile. (4) Die vormals separat
// schwebende "X von Y Signalen bestaetigen"-Zeile ist jetzt Teil von
// StatusLineSummary selbst (✓/✗ direkt an der jeweiligen Zeile, siehe dort).

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

// 02.10.2026 -- Nutzer-Feedback: "warnmuster: soll zusaetzlich angezeigt
// werden welches." Vorher bewusst ein Meta-Signal-Badge ohne Namen (siehe
// Git-Historie) -- WELCHES der Muster vorliegt stand nur in den separaten
// Pattern-Badges darueber, Nutzer musste beide Badge-Reihen gedanklich
// verknuepfen. Jetzt steht der/die Mustername(n) direkt im Badge-Text
// selbst, aus demselben state.patterns, das die Pattern-Badges oben schon
// anzeigen -- keine neue Datenquelle.
//
// Nachtrag (gleicher Tag) -- Nutzer-Wunsch "inkl deren Richtung, im
// gleichen Badge": Richtung je Pattern + die Namensmenge, die den
// "warning_pattern"-Risk-Factor ausloest (identisch zu
// RISK_ELEVATING_PATTERNS in compute-market-state). Seit 03.10.2026 in
// lib/patternDirection.ts ausgelagert (lib/levelStructureContext.ts braucht
// dieselbe Zuordnung fuer den Signal-Abgleich, kein Grund fuer eine zweite
// Kopie im selben Repo).
//
// Zweiter Nachtrag (gleicher Tag, Nutzer-Frage "warnmuster nun doppelt
// angezeigt?"): ja, war es -- die obere Pattern-Badge-Reihe zeigte denselben
// Namen nochmal neben dem jetzt bereits vollstaendigen Warn-Muster-Badge.
// RISK_ELEVATING_PATTERN_NAMES filtert diese Namen aus der oberen Reihe,
// sie bleiben aber (inkl. Begruendung) vollstaendig im Warn-Muster-Badge/
// dessen Erklaerungstext erhalten -- kein Informationsverlust, nur keine
// doppelte Darstellung mehr. "Bullish Confirmation" ist NICHT in dieser
// Menge und bleibt dadurch weiterhin oben sichtbar (kein Risk-Factor, hat
// also kein eigenes Badge weiter unten).

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
  // Kurze Einordnung (22.09.2026, vormals eigene "Zusammenfassung"-Kachel
  // mit eigenem AI-Aufruf/Route -- siehe Kommentar bei der Render-Stelle
  // unten): zeigt nur noch einen Auszug des ohnehin schon vorhandenen
  // System-Briefing-Snapshots, kein eigener Fetch/Poll/Button hier.
  initialSystemBriefing: SystemBriefingSnapshot | null;
  // MTF-Ampel (22.09.2026, siehe lib/mtfSignal.ts) -- unabhaengig vom
  // gewichteten mtf_alignment-Feld in state (das deckt nur 1H/4H/1D ohne
  // ADX-Nuance ab); die Ampel ergaenzt 15M/1H/4H/1D/1W mit Trend-vs-
  // Trendbildung-Unterscheidung.
  initialMtfDots: MtfTimeframeDot[];
}) {
  const [state, setState] = useState(initialState);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [regime, setRegime] = useState(initialRegime);
  const [mtfDots, setMtfDots] = useState(initialMtfDots);
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

  useEffect(() => {
    const interval = setInterval(async () => {
      setMtfDots(await fetchMtfDots());
    }, MARKET_STATE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Nutzer-Feedback (23.09.2026): eine veraltete "Kurze Einordnung" darf
  // hier nie als aktueller Zustand lesbar sein (siehe bereits einmal
  // aufgetretener Bug mit einem laengst ueberholten Preis im Fliesstext).
  // Ab NARRATIVE_AUTO_REFRESH_HOURS wird der veraltete Text nicht nur
  // ausgeblendet, sondern automatisch EIN neuer System-Briefing-Snapshot
  // angefordert (dieselbe Route wie der "Neu generieren"-Button in
  // SystemBriefingCard.tsx, inkl. deren serverseitigem Rate-Limit) --
  // narrativeAutoRefreshAttemptedRef sorgt dafuer, dass pro Mount hoechstens
  // ein Versuch ausgeloest wird (kein Nachhaemmern des Endpoints, falls die
  // Anfrage fehlschlaegt). Start bewusst bei "unknown" (kein Text, kein
  // Hinweis) statt sofort den Narrativ-Text zu zeigen: vermeidet jedes --
  // und sei es nur kurze -- Anzeigen eines potenziell veralteten Snapshots
  // vor der ersten, Date.now()-abhaengigen Berechnung im Effect (gleiche
  // Hydration-Begruendung wie bei FullDateTime/StaleBadge in
  // ClientTimestamp.tsx).
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

  // Ebene-0-Statuszeilen: eine Zeile je Sparte mit ihrem eigenen, bereits
  // vorhandenen Wert + Pfeil (siehe lib/heroSummary.ts fuer die 4-Zustands-
  // Logik). Beschraenkt auf die 5 Sparten mit einer echten, dokumentierten
  // Richtungsaussage (Marktkontext, Marktphase, Spot Pressure, Preis & OI,
  // ETF-Flows) -- Positionierung, Liquidationen und News wurden entfernt
  // (Nutzer-Feedback 23.09.2026): sie hatten laut ihrer eigenen Panel-Texte
  // ausdruecklich keine Kursprognose/Richtungsaussage, zeigten hier immer
  // nur "nicht anzeigbar" und flossen auch nicht in die "X von Y bestaetigen"-
  // Konfirmationslogik ein -- bleiben als Rohdaten weiterhin in ihren
  // eigenen Detail-Kacheln (LiquidationPanel/PositioningPanel/NewsRiskPanel)
  // sichtbar.
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
  // Zwei-Engines-Trennung (Nutzer-Feedback: Kopf-Kachel "verstaendlicher,
  // klarer, strukturierter" -- das Bullisch/Baerisch-Badge oben (14-
  // Faktoren-Engine) und das Fazit unten in "Kurze Einordnung" (System-
  // Briefing, wendet Tobys eigenes Regelwerk an) sind ZWEI unabhaengige
  // Einschaetzungen, die bisher ohne jede Kennzeichnung als Widerspruch
  // untereinander standen. Gleiche Berechnung wie Divergenz-Radar
  // (systemBriefingVsState), hier direkt aus den ohnehin schon geladenen
  // state/narrativeSnapshot-Werten, kein zusaetzlicher Fetch.
  const briefingDivergence = computeSystemBriefingVsStateDivergence(
    narrativeSnapshot?.result?.fazit?.bias,
    state.overall_state
  );

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

      {momentumDivergence.triggered && (
        <p className="flex items-center gap-1 text-xs text-down/90">
          ⚠️ Momentum bestätigt den Trend nicht mehr (Prototyp-Hinweis)
          <PanelInfo title="Momentum-Divergenz-Hinweis" content={momentumDivergenceInfo} />
        </p>
      )}

      <p className="text-sm text-text-muted leading-relaxed">
        {buildCompactMarketStateSummary(state)}
      </p>

      <TradingHoursBadge events={upcomingEconomicEvents} />
      <EconomicHeroBadge events={upcomingEconomicEvents} />

      <StatusLineSummary
        items={statusLines}
        heading={
          confirmation.primaryDirection && confirmation.totalComparable > 0
            ? `${confirmation.confirmingCount} von ${confirmation.totalComparable} unabhängigen Signalen bestätigen (✓/✗ unten)`
            : undefined
        }
      />

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

        <div className="space-y-1.5 text-xs text-text-faint">
          <div className="flex gap-x-4 gap-y-1 flex-wrap items-baseline">
            <span className="text-[10px] uppercase tracking-[0.1em] text-text-faint/70 w-full">
              Datenqualität
            </span>
            <span>Verlässlichkeit: {Math.round(state.confidence)}/100</span>
            <span>Datenabdeckung: {Math.round(state.data_coverage_pct)}%</span>
            <span>Signal-Stärke: {Math.round(confidenceBreakdown.signalStrengthPct)}%</span>
            <span>
              Konsens:{" "}
              {confidenceBreakdown.consensusPct !== null
                ? `${Math.round(confidenceBreakdown.consensusPct)}%`
                : "—"}
            </span>
          </div>
          {state.risk_level && (
            <div className="flex gap-x-4 gap-y-1 flex-wrap items-baseline">
              <span className="text-[10px] uppercase tracking-[0.1em] text-text-faint/70 w-full">
                Marktlage
              </span>
              <span>
                Risk: <span className={riskColor(state.risk_level)}>{RISK_LABELS[state.risk_level] ?? state.risk_level}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-faint">MTF-Ampel (15M-1W):</span>
          <MtfDotsRow dots={mtfDots} />
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

        {/* Kurze Einordnung (22.09.2026): ersetzt die vormals eigenstaendige
            "Zusammenfassung"-Kachel (eigener AI-Aufruf/eigene Route/eigene
            Snapshot-Tabelle) -- die deckte sich inhaltlich stark mit dem
            inzwischen breiteren System-Briefing (siehe lib/systemBriefing-
            Context.ts, seit 22.09.2026 auch Marktkontext/ETF/Positionierung/
            News). Zeigt einen kurzen, rein clientseitig gekuerzten Auszug
            desselben System-Briefing-Snapshots. Ab NARRATIVE_AUTO_REFRESH_
            HOURS (23.09.2026) loest die Kachel automatisch EINEN neuen
            System-Briefing-Snapshot aus (siehe Effect oben) statt weiter
            veralteten Text zu zeigen oder auf einen manuellen Klick im
            System-Briefing-Tab zu warten. */}
        <div className="mt-1 rounded-md border border-accent/25 bg-accent/[0.04] p-3 space-y-1.5">
          <span className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs uppercase tracking-[0.15em] text-text-muted">Kurze Einordnung</p>
            <span className="text-[10px] text-text-faint border border-border rounded px-1">
              dein Regelwerk, andere Engine
            </span>
            <PanelInfo title="Kurze Einordnung" content={SHORT_NARRATIVE_INFO_TEXT} />
          </span>
          {briefingDivergence === "DIVERGENCE" && (
            <p className="text-xs text-down flex items-center gap-1">
              ⚠ Weicht von der Gesamteinschätzung oben ab (14-Faktoren-Engine vs. dein Regelwerk) —
              einen echten Widerspruch, keinen Darstellungsfehler.
            </p>
          )}
          {!narrativeSnapshot?.result?.fazit?.kernaussage ? (
            <p className="text-xs text-text-faint">
              Noch keine Einordnung generiert — siehe System-Briefing (Tab &quot;KI-Einschätzungen&quot;).
            </p>
          ) : narrativeFreshness === "stale" ? (
            narrativeRefreshError ? (
              <p className="text-xs text-down">
                Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.), automatische
                Aktualisierung fehlgeschlagen ({narrativeRefreshError}) — im System-Briefing (Tab
                &quot;KI-Einschätzungen&quot;) manuell neu generieren.
              </p>
            ) : (
              <p className="text-xs text-text-faint">
                Einordnung ist veraltet (Stand vor {narrativeHoursOld} Std.) —{" "}
                {narrativeRefreshing ? "wird automatisch aktualisiert…" : "Aktualisierung wird angefordert…"}
              </p>
            )
          ) : narrativeFreshness === "fresh" ? (
            <>
              <p className="text-sm text-text-muted leading-relaxed">
                <span
                  className={
                    narrativeSnapshot.result.fazit.bias === "bullish"
                      ? "text-up font-semibold"
                      : narrativeSnapshot.result.fazit.bias === "bearish"
                      ? "text-down font-semibold"
                      : "text-text font-semibold"
                  }
                >
                  {narrativeSnapshot.result.fazit.bias === "bullish"
                    ? "Bullisch"
                    : narrativeSnapshot.result.fazit.bias === "bearish"
                    ? "Bärisch"
                    : "Neutral"}
                </span>{" "}
                — {narrativeSnapshot.result.fazit.kernaussage}
              </p>
              <FullDateTime iso={narrativeSnapshot.generated_at} className="text-xs text-text-faint" />
              <p className="text-xs text-text-faint">
                Vollständige Einordnung im System-Briefing (Tab &quot;KI-Einschätzungen&quot;).
              </p>
            </>
          ) : null}
        </div>

        <MasterReportHeroCard />
      </div>
    </section>
  );
}
