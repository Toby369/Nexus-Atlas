// Divergenz-Radar (05.09.2026) -- schliesst einen Teil der in der Recherche
// "bei welchen Paaren koennen Divergenzen entstehen" identifizierten Luecken.
// Reine, getestete Funktionen -- kein Netzwerk-/DB-Zugriff hier (siehe
// lib/divergenceRadarContext.ts fuer die Datenbeschaffung).
//
// Wiederverwendet denselben Status-Typ wie die bereits produktive Engine
// Divergence (lib/marketStateSummary.ts) statt einen zweiten, semantisch
// identischen Typ zu erfinden.
//
// WICHTIG (Ehrlichkeits-Prinzip wie bei Engine Divergence): jede Funktion
// hier ist ein plausibles, regelbasiertes MUSTER -- keine davon wurde
// gegen echte Preis-Outcomes gebacktestet (siehe docs/research/
// DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md fuer den Versuch bei den
// AELTEREN Mustern). "Vorhanden" heisst hier nicht "belegt wirksam".

import type { MarketState, OrderbookWallSnapshot } from "./types";
import type { SpotPressureVerdict } from "./spotPressure";
import { type EngineDivergenceStatus } from "./marketStateSummary";

export type { EngineDivergenceStatus as DivergenceStatus } from "./marketStateSummary";

function factorValue(state: Pick<MarketState, "factors">, key: string): -1 | 0 | 1 | null {
  return state.factors?.[key]?.value ?? null;
}

// --- 1. Options-Skew vs. Sentiment -----------------------------------------
// Beide sind unabhaengige Contrarian-Faktoren im 14-Faktoren-Score, werden
// dort aber nur addiert, nie direkt gegeneinander geprueft.
export function computeOptionsVsSentimentDivergence(
  state: Pick<MarketState, "factors">
): EngineDivergenceStatus {
  const options = factorValue(state, "options");
  const sentiment = factorValue(state, "sentiment");
  if (options === null || sentiment === null || options === 0 || sentiment === 0) {
    return "NOT_COMPARABLE";
  }
  return options === sentiment ? "AGREEMENT" : "DIVERGENCE";
}

// --- 2. Spot-Pressure (Taker-Flow, Spot) vs. CVD (Futures) -----------------
// Bisher nur implizit ueber "spotbestaetigt" in lib/marketContext.ts (nur
// innerhalb der Marktkontext-Kachel) -- hier als eigenstaendiger Vergleich.
export function computeSpotVsFuturesDivergence(
  spotVerdict: SpotPressureVerdict,
  state: Pick<MarketState, "factors">
): EngineDivergenceStatus {
  const cvd = factorValue(state, "cvd");
  if (cvd === null || cvd === 0) return "NOT_COMPARABLE";
  if (spotVerdict === "NEUTRAL" || spotVerdict === "INSUFFICIENT_DATA") return "NOT_COMPARABLE";
  const spotDirection = spotVerdict === "BUYING_PRESSURE" ? 1 : -1;
  return spotDirection === cvd ? "AGREEMENT" : "DIVERGENCE";
}

// --- 3. Zyklus-Indikator (Log-Preiskanal-Band) vs. kurzfristiges Momentum --
// Nur bei einer STRECKUNG (deutlich ueber/unter Trendkanal) ueberhaupt eine
// Aussage -- "auf Trendkanal" ist keine Divergenz-Grundlage, sondern der
// Normalzustand.
export function computeCycleVsMomentumDivergence(
  bandLabel: string,
  state: Pick<MarketState, "factors">
): EngineDivergenceStatus {
  const momentum = factorValue(state, "momentum");
  if (momentum === null || momentum === 0) return "NOT_COMPARABLE";

  let bandDirection: -1 | 0 | 1;
  if (bandLabel === "Deutlich über Trendkanal") bandDirection = 1;
  else if (bandLabel === "Deutlich unter Trendkanal") bandDirection = -1;
  else return "NOT_COMPARABLE";

  // "Divergenz" hier: Preis langfristig gestreckt UND kurzfristiges Momentum
  // zeigt bereits in die Gegenrichtung (moegliches Erschoepfungssignal) --
  // AGREEMENT (Streckung + gleichgerichtetes Momentum) ist der haeufigere,
  // weniger interessante Fall (Trend setzt sich einfach fort).
  return bandDirection === momentum ? "AGREEMENT" : "DIVERGENCE";
}

// --- TradingView-Signal vs. interner Zustand -------------------------------
// Nachgeholt (05.09.2026): war urspruenglich zurueckgestellt, weil die
// Webhook-Alerts keine Pflicht-Richtung mitschicken. Loesung: alle 6
// Pine-Skripte senden einen von 14 bekannten signal_type-Strings, deren
// Richtung sich verlaesslich aus dem Namen ableiten laesst (siehe
// lib/tradingViewSignal.ts::inferSignalDirection) -- kein Raten aus
// Freitext, nur das Auswerten einer bereits vorhandenen Namenskonvention.
export function computeTradingViewVsStateDivergence(
  signalDirection: "bullish" | "bearish" | null,
  overallState: MarketState["overall_state"] | null
): EngineDivergenceStatus {
  if (signalDirection === null || overallState === null) return "NOT_COMPARABLE";
  if (overallState !== "BULLISH" && overallState !== "BEARISH") return "NOT_COMPARABLE";
  const stateDirection = overallState === "BULLISH" ? "bullish" : "bearish";
  return signalDirection === stateDirection ? "AGREEMENT" : "DIVERGENCE";
}

// --- 4. Handelslage-KI-Bias vs. Gesamteinschaetzung ------------------------
// Analog zu computeEngineDivergence (Market State vs. Regime Matrix), nur
// mit der KI-Kurzeinschaetzung als zweiter "Engine". bias ist optional --
// vor dem 05.09.2026 generierte Snapshots haben das Feld noch nicht.
export function computeHandelslageVsStateDivergence(
  bias: "bullish" | "bearish" | "neutral" | undefined,
  overallState: MarketState["overall_state"] | null
): EngineDivergenceStatus {
  if (!bias || bias === "neutral" || overallState === null) return "NOT_COMPARABLE";
  if (overallState !== "BULLISH" && overallState !== "BEARISH") return "NOT_COMPARABLE";
  const stateDirection = overallState === "BULLISH" ? "bullish" : "bearish";
  return bias === stateDirection ? "AGREEMENT" : "DIVERGENCE";
}

// --- 5. On-Chain (SOPR) vs. Preis -------------------------------------------
// Klassisches On-Chain-Distribution-Muster (Preis nahe lokalem Hoch/Tief,
// aber SOPR zeigt das Gegenteil von "mehr Gewinnmitnahme bei steigenden
// Preisen"). SOPR < 1 heisst: im Schnitt wurden Coins gerade MIT VERLUST
// bewegt -- ungewoehnlich nahe an einem Hoch, normal/erwartet nahe einem
// Tief (Kapitulation).
//
// Bewusst NUR deskriptiv: im multivariaten Modell dieser Session (siehe
// docs/research zu On-Chain-Backfill) halfen On-Chain-Features nicht als
// eigenstaendiger Preis-Praediktor -- diese Funktion ist eine
// Beobachtungshilfe, kein geprueftes Signal, siehe INFO_TEXT in
// DivergenceRadarCard.tsx.
export type OnchainDivergence = "PRICE_HIGH_SOPR_LOSS" | "PRICE_LOW_SOPR_PROFIT" | "NOT_COMPARABLE";

export function computeOnchainVsPriceDivergence(
  sopr: number | null,
  priceDistanceFrom30dHighPct: number | null,
  priceDistanceFrom30dLowPct: number | null
): OnchainDivergence {
  if (sopr === null) return "NOT_COMPARABLE";
  const nearHigh = priceDistanceFrom30dHighPct !== null && priceDistanceFrom30dHighPct > -2;
  const nearLow = priceDistanceFrom30dLowPct !== null && priceDistanceFrom30dLowPct < 2;

  if (nearHigh && sopr < 1) return "PRICE_HIGH_SOPR_LOSS";
  if (nearLow && sopr >= 1) return "PRICE_LOW_SOPR_PROFIT";
  return "NOT_COMPARABLE";
}

// --- 6. Orderbuch-Wand: Persistenz zwischen zwei Schnappschuessen ----------
export type WallPersistence = "NEU" | "GEHALTEN" | "VERSCHWUNDEN" | "KEINE_DATEN";

// "Gehalten" toleriert eine kleine Preisverschiebung (Orderbuch bewegt sich
// laufend) -- nur wenn der Wand-Preis um mehr als 0.1% abweicht oder ganz
// fehlt, gilt sie als neu/verschwunden statt als dieselbe Wand.
const WALL_SAME_LEVEL_TOLERANCE_PCT = 0.1;

function isSameWallLevel(priceA: number, priceB: number): boolean {
  const diffPct = (Math.abs(priceA - priceB) / priceB) * 100;
  return diffPct <= WALL_SAME_LEVEL_TOLERANCE_PCT;
}

export function computeWallPersistence(
  currentPrice: number | null,
  previousPrice: number | null
): WallPersistence {
  if (currentPrice === null && previousPrice === null) return "KEINE_DATEN";
  if (currentPrice !== null && previousPrice === null) return "NEU";
  if (currentPrice === null && previousPrice !== null) return "VERSCHWUNDEN";
  return isSameWallLevel(currentPrice!, previousPrice!) ? "GEHALTEN" : "NEU";
}

// --- 7. Liquidations-Modell (geschaetzte Cluster) vs. echte Ereignisse -----
// Reine Korroboration ("gab es in der Naehe dieses geschaetzten Clusters
// tatsaechlich eine Liquidation"), KEIN Backtest/Trefferquote -- dafuer
// fehlt die retroaktive Rekonstruktion frueherer Modell-Staende, siehe
// docs/research/DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md Abschnitt "Nicht
// umgesetzt".
const CLUSTER_CORROBORATION_TOLERANCE_PCT = 1;

export function findCorroboratingLiquidation<T extends { price: number | null }>(
  clusterPrice: number,
  recentLiquidations: T[]
): T | null {
  for (const event of recentLiquidations) {
    if (event.price === null) continue;
    const diffPct = (Math.abs(event.price - clusterPrice) / clusterPrice) * 100;
    if (diffPct <= CLUSTER_CORROBORATION_TOLERANCE_PCT) return event;
  }
  return null;
}

export interface OrderbookWallWithPersistence extends OrderbookWallSnapshot {
  bidWallPersistence: WallPersistence;
  askWallPersistence: WallPersistence;
}
