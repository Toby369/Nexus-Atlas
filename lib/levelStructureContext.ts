import { supabase } from "./supabase";
import type { KeyLevel, KeyLevelConfirmation } from "./chartStructureContext";
import { fetchMtfDots, type MtfDotStatus } from "./mtfSignal";
import { PATTERN_DIRECTION } from "./patternDirection";

// Level-Struktur-Kachel (Nutzer-Wunsch 03.10.2026, siehe Chat-Verlauf: Toby
// las den Wochen-Pivot bei 82'828.7 manuell aus dem Chart -- "keine hoeheren
// Hochs" waehrend der Widerstand haelt, nach dem Bruch "keine tieferen
// Tiefs" als bullische Bestaetigung, inkl. des ehrlichen Gegenbeispiels vom
// 28.9. -- "so moechte ich das angezeigt bekommen!"). Portiert genau diese
// manuelle Analyse in eine wiederverwendbare, automatische Berechnung:
//
// 1) interpretLevelStructure() -- reine Funktion, baut aus Kerzen +
//    market_features.swing_type-Historie die Phase (haelt die Zone noch,
//    oder wurde sie gebrochen) und das ehrliche Narrativ (inkl. etwaiger
//    Gegentests wie dem 28.9.-Dip).
// 2) confluenceTier() -- Staerke-Stufe (Nutzer-Antwort auf Rueckfrage:
//    "zuerst key level, kommt swing vwap oder ema dazu wird es
//    verstaerkt"): liest einfach KeyLevel.confirmedBy, das
//    withConfirmationLevels() in chartStructureContext.ts bereits aus
//    EMA50/Swing-VWAP-Naehe befuellt -- kein zweiter Fetch noetig.
// 3) computeSignalTally() -- Abgleich mit anderen Nexus-Signalen (Nutzer-
//    Antwort: "aufzeigen wieviel baerisch und wieviel bullisch? gewichtend?"
//    -- bewusst UNGEWICHTET in v1, einfache Zaehlung, siehe Kommentar dort).
//    Vergleicht den AKTUELLEN Stand von CVD-Trend/Warn-Mustern/MTF-Ampel
//    gegen die aktuelle Phase der Zone -- KEINE historische Rekonstruktion
//    dieser Signale zum Zeitpunkt der Ablehnung/des Bruchs (waere ein
//    deutlich groesserer Umbau, siehe Kommentar bei getLevelStructureData).
//
// getLevelStructureData() orchestriert alles fuer die naechsten
// MAX_ZONES_PER_SIDE Key-Levels je Seite (mit Pivot-Anker, reine
// Liquidations-/Spot-Volume-Zonen ohne anchorOpenTime werden uebersprungen
// -- fuer die gilt "seit wann haelt das" nicht).

const MAX_ZONES_PER_SIDE = 2;
// Wie weit zurueck eine Zone noch analysiert wird -- aeltere Pivot-Anker
// (z.B. ein 1W-Pivot von vor einem Jahr) waeren fuer "haelt das noch"
// weniger aussagekraeftig und wuerden die 1H-Kerzen-Abfrage unnoetig
// aufblaehen. 270 Tage = grosszuegig genug fuer die aktuell relevanten
// 1W/1D-Pivots (siehe PIVOT_WEEKLY_SOURCE_DAILY_CANDLES=182 Tage in
// chartStructureContext.ts), ohne unbegrenzt in die Vergangenheit zu gehen.
const MAX_LOOKBACK_DAYS = 270;
// 1H-Kerzen ueber MAX_LOOKBACK_DAYS: 270*24=6480 -- mit Puffer.
const CANDLE_QUERY_LIMIT = 7000;

const CONFLUENCE_RELEVANT: KeyLevelConfirmation[] = ["ema50", "vwap_swing_high", "vwap_swing_low"];

export interface LevelStructureCandle {
  openTime: string;
  high: number;
  low: number;
  close: number;
}

interface SwingRow {
  candleOpenTime: string;
  swingType: "HH" | "HL" | "LH" | "LL" | null;
}

export type LevelStructurePhase = "respecting" | "broken";

export interface ClosestApproach {
  openTime: string;
  price: number;
  distancePct: number;
}

export interface CounterEvent {
  openTime: string;
  price: number;
}

export interface LevelStructureResult {
  phase: LevelStructurePhase;
  sinceOpenTime: string;
  breakOpenTime: string | null;
  closestApproach: ClosestApproach | null;
  counterEvent: CounterEvent | null;
  narrative: string;
}

function fmtDateDE(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

function fmtPrice(value: number): string {
  return value.toLocaleString("de-CH", { maximumFractionDigits: 0 });
}

// Kernstueck: reine Funktion (kein Fetch), daher isoliert testbar -- siehe
// lib/levelStructureContext.test.ts. `candles` muss 1H-Kerzen AB
// level.anchorOpenTime aufsteigend sortiert enthalten, `swingRows` dieselbe
// Spanne aus market_features.swing_type (ebenfalls aufsteigend).
export function interpretLevelStructure(
  level: { price: number; side: "resistance" | "support"; anchorOpenTime: string },
  candles: LevelStructureCandle[],
  swingRows: SwingRow[]
): LevelStructureResult {
  const breaksUpward = level.side === "resistance";

  let breakCandle: LevelStructureCandle | null = null;
  let closestApproach: ClosestApproach | null = null;

  for (const c of candles) {
    const extreme = breaksUpward ? c.high : c.low;
    const isNewExtreme =
      closestApproach === null || (breaksUpward ? extreme > closestApproach.price : extreme < closestApproach.price);
    if (isNewExtreme) {
      closestApproach = {
        openTime: c.openTime,
        price: extreme,
        distancePct: (Math.abs(extreme - level.price) / level.price) * 100,
      };
    }
    const crossed = breaksUpward ? c.close > level.price : c.close < level.price;
    if (crossed) {
      breakCandle = c;
      break;
    }
  }

  if (!breakCandle) {
    const sideLabel = level.side === "resistance" ? "Widerstand" : "Unterstützung";
    const patternLabel = level.side === "resistance" ? "höhere Hochs" : "tiefere Tiefs";
    let narrative = `${sideLabel} seit ${fmtDateDE(level.anchorOpenTime)} intakt -- kein Schlusskurs ist seither über die Zone hinweg bestätigt, keine ${patternLabel} gegen sie.`;
    if (closestApproach && closestApproach.distancePct < 5) {
      narrative += ` Nächste Annäherung am ${fmtDateDE(closestApproach.openTime)} (${fmtPrice(closestApproach.price)}, ${closestApproach.distancePct.toFixed(2)}% entfernt).`;
    }
    return {
      phase: "respecting",
      sinceOpenTime: level.anchorOpenTime,
      breakOpenTime: null,
      closestApproach,
      counterEvent: null,
      narrative,
    };
  }

  // Gebrochen -- Gegen-Ereignis seit dem Bruch suchen (LL nach Bruch nach
  // oben = baerischer Gegentest trotz Bruch, HH nach Bruch nach unten =
  // bullischer Gegentest trotz Bruch). Das JUENGSTE Gegen-Ereignis wird als
  // neuer Ausgangspunkt genommen -- exakt das Muster aus der manuellen
  // Analyse (Pivot-Bruch am 21.9., aber der tatsaechlich tiefste Test war
  // der 28.9.-Dip, nicht der 24.9.-Test direkt nach dem Bruch).
  const counterSwingType = breaksUpward ? "LL" : "HH";
  const candleByOpenTime = new Map(candles.map((c) => [c.openTime, c]));

  let counterEvent: CounterEvent | null = null;
  for (const row of swingRows) {
    if (row.candleOpenTime <= breakCandle.openTime) continue;
    if (row.swingType !== counterSwingType) continue;
    const candle = candleByOpenTime.get(row.candleOpenTime);
    if (!candle) continue;
    const price = breaksUpward ? candle.low : candle.high;
    counterEvent = { openTime: row.candleOpenTime, price };
  }

  const sinceOpenTime = counterEvent?.openTime ?? breakCandle.openTime;
  const continuationLabel = breaksUpward ? "keine tieferen Tiefs" : "keine höheren Hochs";
  const breakLabel = breaksUpward ? "nach oben durchbrochen" : "nach unten durchbrochen";

  let narrative = `Am ${fmtDateDE(breakCandle.openTime)} ${breakLabel}.`;
  if (counterEvent) {
    narrative += ` Erneut getestet am ${fmtDateDE(counterEvent.openTime)} (${fmtPrice(counterEvent.price)}).`;
  }
  narrative += ` Seit ${fmtDateDE(sinceOpenTime)} ${continuationLabel} mehr.`;

  return {
    phase: "broken",
    sinceOpenTime,
    breakOpenTime: breakCandle.openTime,
    closestApproach: null,
    counterEvent,
    narrative,
  };
}

// Stufe 1 = nur das Key-Level selbst, Stufe 2 = zusaetzlich EMA50 ODER
// Swing-VWAP nahe dran, Stufe 3 = beides. Liest ausschliesslich
// confirmedBy, das withConfirmationLevels() (chartStructureContext.ts)
// bereits befuellt -- kein zusaetzlicher Fetch.
export function confluenceTier(confirmedBy: KeyLevelConfirmation[]): 1 | 2 | 3 {
  const n = confirmedBy.filter((c) => CONFLUENCE_RELEVANT.includes(c)).length;
  return Math.min(3, 1 + n) as 1 | 2 | 3;
}

export function confluenceLabel(confirmedBy: KeyLevelConfirmation[]): string {
  const parts = ["Key-Level"];
  if (confirmedBy.includes("ema50")) parts.push("EMA50");
  if (confirmedBy.includes("vwap_swing_high") || confirmedBy.includes("vwap_swing_low")) parts.push("Swing-VWAP");
  return parts.join(" + ");
}

export type SignalDirection = "bearish" | "bullish" | "neutral";

export interface SignalTallyEntry {
  label: string;
  direction: SignalDirection;
}

export interface SignalTally {
  bearish: number;
  bullish: number;
  neutral: number;
  entries: SignalTallyEntry[];
}

// UNGEWICHTET (Nutzer-Rueckfrage "gewichtend?" -- bewusst v1-Entscheidung:
// jedes Signal zaehlt gleich viel. Eine Gewichtung (z.B. MTF-Ampel staerker
// als ein einzelnes Pattern) waere ein sinnvoller naechster Schritt, aber
// erst, wenn klar ist, ob die einfache Zaehlung ueberhaupt nuetzlich ist).
// Vergleicht AKTUELLE Signale, nicht deren historischen Stand zum
// Ablehnungs-/Bruch-Zeitpunkt -- eine echte Rueckrechnung ("war CVD am
// 24.9. divergent?") wuerde fuer jedes Signal eine eigene Historien-
// Rekonstruktion brauchen (CVD-Divergenz ist z.B. nicht in market_features
// gespeichert, nur live berechnet, siehe tradingIndicatorsContext.ts) --
// bewusst ausserhalb des Umfangs dieser ersten Version.
export function computeSignalTally(
  cvdTrend: "rising" | "falling" | "flat" | null,
  patterns: { name: string }[],
  mtfDots: { status: MtfDotStatus }[]
): SignalTally {
  const entries: SignalTallyEntry[] = [];

  if (cvdTrend === "rising") entries.push({ label: "CVD steigend", direction: "bullish" });
  else if (cvdTrend === "falling") entries.push({ label: "CVD fallend", direction: "bearish" });
  else if (cvdTrend === "flat") entries.push({ label: "CVD flach", direction: "neutral" });

  for (const p of patterns) {
    const direction = PATTERN_DIRECTION[p.name];
    if (direction) entries.push({ label: p.name, direction });
  }

  const bullishDots = mtfDots.filter((d) => d.status === "bullish_confirmed" || d.status === "bullish_forming").length;
  const bearishDots = mtfDots.filter((d) => d.status === "bearish_confirmed" || d.status === "bearish_forming").length;
  if (bullishDots > 0 || bearishDots > 0) {
    entries.push({
      label: `MTF-Ampel (${bullishDots} bullisch / ${bearishDots} bärisch von 5)`,
      direction: bullishDots > bearishDots ? "bullish" : bearishDots > bullishDots ? "bearish" : "neutral",
    });
  }

  return {
    bearish: entries.filter((e) => e.direction === "bearish").length,
    bullish: entries.filter((e) => e.direction === "bullish").length,
    neutral: entries.filter((e) => e.direction === "neutral").length,
    entries,
  };
}

export interface LevelStructureZone extends LevelStructureResult {
  price: number;
  side: "resistance" | "support";
  confirmedBy: KeyLevelConfirmation[];
  confluenceTier: 1 | 2 | 3;
  confluenceLabel: string;
  signalTally: SignalTally;
}

async function fetchCandlesSince(sinceIso: string): Promise<LevelStructureCandle[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, high, low, close")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1h")
    .gte("open_time", sinceIso)
    .order("open_time", { ascending: true })
    .limit(CANDLE_QUERY_LIMIT);

  if (error) {
    console.error("levelStructureContext: Fehler beim Laden der 1H-Kerzen:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    openTime: r.open_time as string,
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}

async function fetchSwingRowsSince(sinceIso: string): Promise<SwingRow[]> {
  const { data, error } = await supabase
    .from("market_features")
    .select("candle_open_time, swing_type")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1h")
    .gte("candle_open_time", sinceIso)
    .order("candle_open_time", { ascending: true })
    .limit(CANDLE_QUERY_LIMIT);

  if (error) {
    console.error("levelStructureContext: Fehler beim Laden der Swing-Historie:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    candleOpenTime: r.candle_open_time as string,
    swingType: r.swing_type as SwingRow["swingType"],
  }));
}

interface LatestPatternsRow {
  patterns: { name: string; note: string }[] | null;
}

async function fetchLatestPatterns(): Promise<{ name: string }[]> {
  const { data, error } = await supabase
    .from("market_states")
    .select("patterns")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle<LatestPatternsRow>();

  if (error) {
    console.error("levelStructureContext: Fehler beim Laden der Warn-Muster:", error.message);
    return [];
  }
  return data?.patterns ?? [];
}

function pickNearestZones(keyLevels: KeyLevel[]): KeyLevel[] {
  const cutoffIso = new Date(Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const withAnchor = keyLevels.filter((z) => z.anchorOpenTime !== null && z.anchorOpenTime >= cutoffIso);

  const resistances = withAnchor.filter((z) => z.side === "resistance").sort((a, b) => a.price - b.price);
  const supports = withAnchor.filter((z) => z.side === "support").sort((a, b) => b.price - a.price);

  return [...resistances.slice(0, MAX_ZONES_PER_SIDE), ...supports.slice(0, MAX_ZONES_PER_SIDE)];
}

// Orchestrator (SSR, wie getChartStructureData/getTradingIndicatorsData) --
// cvdTrend wird als bereits geladener Wert uebergeben (tradingIndicators.cvd
// .trend auf app/lernen/page.tsx), kein zweiter CVD-Fetch noetig.
export async function getLevelStructureData(
  keyLevels: KeyLevel[],
  cvdTrend: "rising" | "falling" | "flat" | null
): Promise<LevelStructureZone[]> {
  const zones = pickNearestZones(keyLevels);
  if (zones.length === 0) return [];

  const [patterns, mtfDots] = await Promise.all([fetchLatestPatterns(), fetchMtfDots()]);
  const signalTally = computeSignalTally(cvdTrend, patterns, mtfDots);

  const results = await Promise.all(
    zones.map(async (zone) => {
      const anchorOpenTime = zone.anchorOpenTime!;
      const [candles, swingRows] = await Promise.all([
        fetchCandlesSince(anchorOpenTime),
        fetchSwingRowsSince(anchorOpenTime),
      ]);
      const structure = interpretLevelStructure(
        { price: zone.price, side: zone.side, anchorOpenTime },
        candles,
        swingRows
      );
      return {
        ...structure,
        price: zone.price,
        side: zone.side,
        confirmedBy: zone.confirmedBy,
        confluenceTier: confluenceTier(zone.confirmedBy),
        confluenceLabel: confluenceLabel(zone.confirmedBy),
        signalTally,
      };
    })
  );

  return results;
}
