import { supabase } from "./supabase";
import { detectFractalSwings, findPivots } from "./swingDetection";

// Datenschicht fuer "Struktur: Key Levels, AVWAP, Trendlinien, Muster"
// (Nutzer-Idee 24.09.2026, Recherche siehe Chat-Verlauf: Key-Level-/AVWAP-/
// Trendlinien-/Kerzenmuster-Regelwerk). Reine, deterministische Berechnung
// bei jedem Seitenaufruf -- KEIN KI-Aufruf (bewusste Nutzer-Entscheidung
// "erstmal ohne KI-Verbindung"), gleiches Muster wie GUSS/VWAP-Vector/CVD
// in tradingIndicatorsContext.ts (eigener Candle-Fetch statt Cross-Import,
// da dessen `Candle`-Interface modul-intern ist).
//
// Umsetzungs-Entscheidung (Recherche-Ergebnis): AVWAP-Pivot-Engine und
// Kerzenmuster-Erkennung existierten bereits (research-python/
// avwap_pivot_setup/avwap_engine.py bzw. die DB-Funktion
// research_detect_candlestick_patterns()) -- hier nach TypeScript
// portiert/produktiv verdrahtet. Trendlinien-Erkennung existierte nirgends
// und ist hier komplett neu gebaut (auf Basis der bereits vorhandenen
// Swing-Erkennung aus lib/swingDetection.ts).
//
// Key Levels (ueberarbeitet 30.09.2026, Nutzer-Feedback "muessen handfester
// sein"): bewusst NICHT mehr nur Liquidations-Cluster, sondern Markt-uebliche
// Pivot-Punkte (Web-Recherche 30.09.2026: Classic/Floor-Trader-Pivots sind
// die verbreitetste Variante, Camarilla nur fuer <=1H geeignet -- siehe
// Chat-Verlauf fuer Quellen) -- hier als fraktale Schwenkpunkte (gleicher
// Lookback=3 wie AVWAP-Pivot oben) auf VIER Zeitrahmen top-down: 1W/1D/4H/1H
// (Toby-Vorgabe). Liegen mehrere Zeitrahmen-Pivots nahe beieinander
// (PIVOT_CONFLUENCE_TOLERANCE_PCT), werden sie zu EINER Zone gebuendelt --
// je mehr Zeitrahmen, desto staerker die Zone. Zusaetzlich verstaerkt durch
// Naehe zu einem Liquidations-Cluster, EMA13/50/200 oder VWAP (Daily/Weekly/
// Swing) -- letztere zwei kommen NICHT aus einem neuen Fetch hier, sondern
// werden nachtraeglich rein clientseitig/pure via withConfirmationLevels()
// aus bereits an anderer Stelle auf derselben Seite geladenen Werten
// (meinSystemContext/tradingIndicatorsContext) angereichert, um keinen
// doppelten Rechenweg/Fetch zu erzeugen. Fibonacci-Retracement/Orderbuch-
// Waende bleiben bewusst aussen vor (stehen bereits in VwapVectorCard/
// OrderbookWallCard auf derselben Seite, keine Dopplung).

const CANDLE_LOOKBACK = 300; // gleiche Fenstergroesse wie GUSS_CANDLE_LOOKBACK
const CANDLESTICK_PRIOR_TREND_LOOKBACK = 6; // 1:1 wie research_detect_candlestick_patterns() (lag 6)
const CANDLESTICK_RECENT_EVENTS_LIMIT = 5;

// AVWAP-Pivot (Toby-Setup-Idee 18.09.2026, siehe research-python/
// avwap_pivot_setup/config.py::AvwapPivotParams) -- identische Werte.
const AVWAP_PIVOT_LENGTH = 3;
const AVWAP_MAX_ACTIVE_LINES_PER_SIDE = 5;

// Trendlinien (neu, 24.09.2026): dieselbe Swing-Definition wie VWAP-Vector/
// GUSS (GUSS_SWING_LOOKBACK in tradingIndicatorsContext.ts), damit alle
// "Struktur"-Kacheln auf derselben Seite dieselben Wendepunkte meinen.
const TRENDLINE_SWING_LOOKBACK = 20;
// Stefan Salomon (Web-Recherche + knowledge_base module='salomon'): "Eine
// Linie ist erst dann ein statistisch relevanter Trend, wenn sie mindestens
// drei Beruehrungspunkte hat."
const TRENDLINE_MIN_TOUCHES = 3;
// Wie nah ein weiterer Schwenkpunkt an der verlaengerten Linie liegen muss,
// um noch als "Beruehrung" zu zaehlen (relativ zum Linienwert an dieser
// Stelle) -- eigene, dokumentierte Toleranz, keine Originalquelle.
const TRENDLINE_TOUCH_TOLERANCE_PCT = 0.005;

const KEY_LEVEL_LOOKBACK_HOURS = 6; // gleiches Fenster wie LiquidationPanel/LeverageMapCard
const KEY_LEVEL_MAX_LIQUIDATION_CLUSTERS = 4;
const KEY_LEVEL_PRICE_BUCKET_USD = 200;

// Spot Volume Profile (30.09.2026, Nutzer-Idee "sieht nexus wo/bei welchem
// preis spot gekauft wurde?") -- wo genau Kauf-/Verkaufsvolumen im Spot-
// Markt konzentriert ist (collect-spot-volume-profile, alle 5 Min, siehe
// supabase/-Edge-Function -- liegt nicht in diesem Repo, nur der Aufruf
// hier). Gleiches Lookback-Fenster wie Liquidations-Cluster, damit alle
// Key-Level-Quellen dieselbe Frage ("was ist gerade relevant") beantworten.
const SPOT_VOLUME_MAX_NODES = 4;

// Multi-Timeframe-Pivots fuer Key Levels (30.09.2026). Lookback identisch zu
// AVWAP_PIVOT_LENGTH oben (Toby: "3 davor, 3 danach ergibt Pivot") --
// derselbe fraktale Massstab, nur jetzt auf vier statt nur einem Zeitrahmen.
const PIVOT_FRACTAL_LOOKBACK = 3;
// Wie nah zwei Level (aus verschiedenen Zeitrahmen oder Quellen) beieinander
// liegen muessen, um zu EINER Zone gebuendelt zu werden -- enger als die
// Trendlinien-Beruehrungstoleranz (0,5%), da Pivot-Zonen praeziser gemeint
// sind. Bewusster Startwert (Toby: "so mal starten, schauen ob das passt").
const PIVOT_CONFLUENCE_TOLERANCE_PCT = 0.003;
// Kerzen-Fenster je Zeitrahmen -- bewusst NICHT die komplette Historie,
// sondern ein auf "aktuell relevant" begrenztes, aehnlich CANDLE_LOOKBACK
// (300 1H-Kerzen = ~12,5 Tage) fuer die anderen Struktur-Bausteine.
const PIVOT_4H_LOOKBACK_CANDLES = 90; // ~15 Tage
const PIVOT_DAILY_LOOKBACK_CANDLES = 60; // ~2 Monate
// Quell-Fenster fuer die Wochen-Aggregation (aus 1D-Kerzen) -- ergibt bei
// vollstaendiger Abdeckung ~26 Wochen-Kerzen, genug fuer mehrere bestaetigte
// Wochen-Schwenkpunkte bei PIVOT_FRACTAL_LOOKBACK=3.
const PIVOT_WEEKLY_SOURCE_DAILY_CANDLES = 182;
// Begrenzung der angezeigten Zonen je Seite (Widerstand/Unterstuetzung) --
// gleiches Prinzip wie KEY_LEVEL_MAX_LIQUIDATION_CLUSTERS/
// AVWAP_MAX_ACTIVE_LINES_PER_SIDE.
const KEY_LEVEL_MAX_ZONES_PER_SIDE = 4;

// Chart-Formationen (neu, 25.09.2026, Nutzer-Nachfrage "doubel top,
// w-pattern"): wie nah die zwei Tops/Bottoms bzw. die zwei Schultern
// beieinander liegen muessen, um noch als "gleiche Hoehe" zu gelten --
// eigene, dokumentierte Toleranz (2%), keine Originalquelle.
const FORMATION_PEAK_TOLERANCE_PCT = 0.02;
// Ab welcher relativen Steigung (Preisaenderung je Kerze, relativ zum
// aktuellen Linienwert) eine Trendlinie als "geneigt" statt "flach" gilt --
// Schwelle fuer die Dreiecks-Klassifikation (steigend/fallend/symmetrisch).
const TRIANGLE_FLAT_SLOPE_PCT_PER_BAR = 0.0003;

// Flaggen/Wimpel/Keile (neu, 25.09.2026, Nutzer-Nachfrage): anders als
// Trendlinien/Dreiecke (ganzes 300-Kerzen-Fenster) sind das LOKALE,
// kurzlebige Muster direkt NACH einem scharfen vorangehenden Kursimpuls
// (dem "Flaggenmast") -- eigene, kleinraeumigere Erkennung.
const POLE_WINDOW = 10; // Kerzen fuer den moeglichen Flaggenmast
const CONSOLIDATION_WINDOW = 15; // Kerzen fuer die moegliche Konsolidierung danach
const CONSOLIDATION_SWING_LOOKBACK = 2; // kleines Fenster -> kleiner Pivot-Lookback
const POLE_REFERENCE_CANDLES = 50; // Referenzfenster fuer die durchschnittliche Kerzenspanne
// Mindestbewegung des Mastes als Vielfaches der durchschnittlichen
// Kerzenspanne (grobes ATR-Analogon) -- eigene, dokumentierte Schwelle.
const POLE_MIN_MOVE_RANGE_MULT = 3;
// Kanalbreite am Ende ggue. am Anfang der Konsolidierung: "parallel" (Flagge)
// wenn sich die Breite um hoechstens diesen Anteil aendert, "konvergierend"
// (Wimpel/Keil) wenn sie um mindestens diesen Anteil schrumpft.
const CHANNEL_PARALLEL_TOLERANCE_PCT = 0.15;
const CHANNEL_CONVERGENCE_MIN_SHRINK_PCT = 0.15;

export interface OhlcvCandle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Generalisiert auf beliebige Intervalle (30.09.2026, fuer die Multi-
// Timeframe-Pivots noetig) -- vorher fest auf "1h" verdrahtet, da Key Levels
// bis dahin ausschliesslich Liquidations-Cluster waren.
async function fetchCandlesForInterval(interval: "1h" | "4h" | "1d", limit: number): Promise<OhlcvCandle[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, open, high, low, close, volume")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", interval)
    .order("open_time", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`chartStructureContext: Fehler beim Laden der ${interval}-Kerzen:`, error.message);
  }

  return (data ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      openTime: row.open_time as string,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
}

async function fetchCandles(): Promise<OhlcvCandle[]> {
  return fetchCandlesForInterval("1h", CANDLE_LOOKBACK);
}

// Aggregiert 1D-Kerzen (chronologisch, wie von fetchCandlesForInterval
// geliefert) zu Wochen-Kerzen -- Montag (UTC) als Wochenbeginn. Reine
// Funktion, kein DB-Zugriff, damit isoliert mit handgebauten Tagesreihen
// testbar (gleiches Prinzip wie die anderen pure Bausteine dieser Datei).
export function aggregateToWeekly(dailyCandles: OhlcvCandle[]): OhlcvCandle[] {
  const weeks = new Map<string, OhlcvCandle[]>();
  for (const c of dailyCandles) {
    const d = new Date(c.openTime);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayOfWeek = monday.getUTCDay(); // 0=So..6=Sa
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setUTCDate(monday.getUTCDate() + diffToMonday);
    const key = monday.toISOString();
    const group = weeks.get(key) ?? [];
    group.push(c);
    weeks.set(key, group);
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, group]) => ({
      openTime: weekStart,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    }));
}

// --- Kerzenmuster -------------------------------------------------------
// TS-Port von research_detect_candlestick_patterns() (Postgres-Funktion,
// bislang nur Research/Backtest) -- dieselben Schwellenwerte, aber hier auf
// dem ohnehin schon geladenen, auf CANDLE_LOOKBACK begrenzten Kerzenfenster
// statt eines vollen Table-Scans ueber die komplette Historie (die DB-
// Funktion hat keinen Datums-Filter, waere fuer einen Live-Seitenaufruf zu
// teuer).

export interface CandlestickPatternEvent {
  candleOpenTime: string;
  patternName: string;
  direction: "BULLISH" | "BEARISH";
}

export function detectCandlestickPatterns(candles: OhlcvCandle[]): CandlestickPatternEvent[] {
  const events: CandlestickPatternEvent[] = [];
  const lb = CANDLESTICK_PRIOR_TREND_LOOKBACK;

  for (let i = 1; i < candles.length; i++) {
    const c0 = candles[i];
    const c1 = candles[i - 1];
    const c2 = i >= 2 ? candles[i - 2] : null;

    const range0 = c0.high - c0.low;
    const body0 = Math.abs(c0.close - c0.open);
    const upperWick0 = c0.high - Math.max(c0.open, c0.close);
    const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
    const body1 = Math.abs(c1.close - c1.open);

    let priorTrend: "up" | "down" | null = null;
    if (i - 1 - lb >= 0) {
      const close1Back = c1.close;
      const close6Back = candles[i - 1 - lb].close;
      if (close1Back < close6Back) priorTrend = "down";
      else if (close1Back > close6Back) priorTrend = "up";
    }

    if (range0 > 0 && body0 <= 0.1 * range0 && priorTrend !== null) {
      events.push({
        candleOpenTime: c0.openTime,
        patternName: "doji",
        direction: priorTrend === "down" ? "BULLISH" : "BEARISH",
      });
    }

    if (
      range0 > 0 &&
      body0 <= 0.3 * range0 &&
      lowerWick0 >= 2.0 * Math.max(body0, 0.0001) &&
      lowerWick0 >= 0.5 * range0 &&
      upperWick0 <= 0.15 * range0 &&
      priorTrend === "down"
    ) {
      events.push({ candleOpenTime: c0.openTime, patternName: "hammer", direction: "BULLISH" });
    }
    if (
      range0 > 0 &&
      body0 <= 0.3 * range0 &&
      lowerWick0 >= 2.0 * Math.max(body0, 0.0001) &&
      lowerWick0 >= 0.5 * range0 &&
      upperWick0 <= 0.15 * range0 &&
      priorTrend === "up"
    ) {
      events.push({ candleOpenTime: c0.openTime, patternName: "hanging_man", direction: "BEARISH" });
    }

    if (body0 > 0 && body1 > 0 && c1.close < c1.open && c0.close > c0.open && c0.open <= c1.close && c0.close >= c1.open) {
      events.push({ candleOpenTime: c0.openTime, patternName: "bullish_engulfing", direction: "BULLISH" });
    }
    if (body0 > 0 && body1 > 0 && c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open) {
      events.push({ candleOpenTime: c0.openTime, patternName: "bearish_engulfing", direction: "BEARISH" });
    }

    if (c2) {
      const range2 = c2.high - c2.low;
      const body2 = Math.abs(c2.close - c2.open);
      if (
        range2 > 0 &&
        c2.close < c2.open &&
        body2 >= 0.5 * range2 &&
        body1 <= 0.3 * range2 &&
        range0 > 0 &&
        c0.close > c0.open &&
        body0 >= 0.5 * range0 &&
        c0.close > (c2.open + c2.close) / 2
      ) {
        events.push({ candleOpenTime: c0.openTime, patternName: "morning_star", direction: "BULLISH" });
      }
      if (
        range2 > 0 &&
        c2.close > c2.open &&
        body2 >= 0.5 * range2 &&
        body1 <= 0.3 * range2 &&
        range0 > 0 &&
        c0.close < c0.open &&
        body0 >= 0.5 * range0 &&
        c0.close < (c2.open + c2.close) / 2
      ) {
        events.push({ candleOpenTime: c0.openTime, patternName: "evening_star", direction: "BEARISH" });
      }
    }
  }

  return events.slice(-CANDLESTICK_RECENT_EVENTS_LIMIT).reverse();
}

// --- AVWAP-Pivot ----------------------------------------------------------
// TS-Port von research-python/avwap_pivot_setup/avwap_engine.py, reduziert
// auf das fuer eine Live-Anzeige Notwendige: welche AVWAP-Pivot-Linien sind
// GERADE JETZT noch aktiv (nicht durch einen Schlusskurs-Durchbruch
// invalidiert)? Die Rejection-Signal-/Touch-Count-Logik des Originals
// (fuer den Backtest gebaut) wird hier bewusst weggelassen -- nur der
// Linien-Lebenszyklus (entstehen/wachsen/invalidieren) bleibt 1:1 erhalten,
// weil NUR der die aktuell gueltigen Linienwerte bestimmt.

export interface AvwapPivotLevel {
  anchorOpenTime: string;
  side: "resistance" | "support";
  value: number;
}

interface ActiveAvwapLine {
  anchorIdx: number;
  cumPv: number;
  cumV: number;
}

export function computeAvwapPivotLevels(candles: OhlcvCandle[]): AvwapPivotLevel[] {
  const n = candles.length;
  if (n < AVWAP_PIVOT_LENGTH * 2 + 1) return [];

  const closes = candles.map((c) => c.close);
  const typical = candles.map((c) => (c.high + c.low + c.close) / 3);
  const pv = typical.map((t, i) => t * candles[i].volume);

  // Pine-Lag: ein Pivot bei Index i wird erst bei i+PIVOT_LENGTH sichtbar
  // (symmetrisches Fenster), identisch zu avwap_engine.py.
  const pivots = findPivots(closes, AVWAP_PIVOT_LENGTH);
  const revealByIndex = new Map<number, ("high" | "low")[]>();
  for (const p of pivots) {
    const revealIdx = p.index + AVWAP_PIVOT_LENGTH;
    if (revealIdx >= n) continue;
    const arr = revealByIndex.get(revealIdx) ?? [];
    arr.push(p.kind);
    revealByIndex.set(revealIdx, arr);
  }

  let activeResistance: ActiveAvwapLine[] = [];
  let activeSupport: ActiveAvwapLine[] = [];

  for (let t = 0; t < n; t++) {
    const c = candles[t].close;

    for (const line of activeResistance) {
      line.cumPv += pv[t];
      line.cumV += candles[t].volume;
    }
    for (const line of activeSupport) {
      line.cumPv += pv[t];
      line.cumV += candles[t].volume;
    }

    activeResistance = activeResistance.filter((ln) => c <= ln.cumPv / ln.cumV);
    activeSupport = activeSupport.filter((ln) => c >= ln.cumPv / ln.cumV);

    const revealed = revealByIndex.get(t);
    if (revealed) {
      for (const kind of revealed) {
        const anchorIdx = t - AVWAP_PIVOT_LENGTH;
        let cumPv = 0;
        let cumV = 0;
        for (let k = anchorIdx; k <= t; k++) {
          cumPv += pv[k];
          cumV += candles[k].volume;
        }
        if (cumV <= 0) continue;
        const line: ActiveAvwapLine = { anchorIdx, cumPv, cumV };
        if (kind === "high") {
          activeResistance.push(line);
          activeResistance = activeResistance.slice(-AVWAP_MAX_ACTIVE_LINES_PER_SIDE);
        } else {
          activeSupport.push(line);
          activeSupport = activeSupport.slice(-AVWAP_MAX_ACTIVE_LINES_PER_SIDE);
        }
      }
    }
  }

  const toLevel = (ln: ActiveAvwapLine, side: AvwapPivotLevel["side"]): AvwapPivotLevel => ({
    anchorOpenTime: candles[ln.anchorIdx].openTime,
    side,
    value: ln.cumPv / ln.cumV,
  });

  return [
    ...activeResistance.map((ln) => toLevel(ln, "resistance")),
    ...activeSupport.map((ln) => toLevel(ln, "support")),
  ].sort((a, b) => b.value - a.value);
}

// --- Trendlinien (neu) ----------------------------------------------------
// Verbindet die zwei juengsten Swing-Tiefs (Aufwaertslinie) bzw. Swing-
// Hochs (Abwaertslinie) -- Salomons eigene Definition ("verbindet man die
// markanten Tiefpunkte/Hochpunkte"). Weitere Schwenkpunkte, die (innerhalb
// TRENDLINE_TOUCH_TOLERANCE_PCT) auf derselben verlaengerten Linie liegen,
// zaehlen als zusaetzliche Beruehrung; ab TRENDLINE_MIN_TOUCHES gilt die
// Linie als "confirmed" (Salomons Mindestwert), sonst wird sie trotzdem
// gezeigt, aber als unbestaetigt markiert -- nie stillschweigend verworfen.

export interface TrendlinePoint {
  openTime: string;
  value: number;
}

export interface TrendlineLevel {
  direction: "up" | "down";
  touchCount: number;
  confirmed: boolean;
  currentValue: number;
  points: TrendlinePoint[];
}

export interface SwingPoint {
  index: number;
  value: number;
}

// Gemeinsame Schwenkpunkt-Basis fuer Trendlinien UND Chart-Formationen
// (Double Top/Bottom, Kopf-Schulter, Dreiecke) -- EIN detectFractalSwings-
// Aufruf statt mehrerer, alle Struktur-Bausteine dieser Kachel meinen
// dieselben Wendepunkte.
export function computeSwingPoints(candles: OhlcvCandle[]): { lowPoints: SwingPoint[]; highPoints: SwingPoint[] } {
  if (candles.length < TRENDLINE_SWING_LOOKBACK * 2 + 1) return { lowPoints: [], highPoints: [] };

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const swings = detectFractalSwings(highs, lows, TRENDLINE_SWING_LOOKBACK);

  const lowPoints: SwingPoint[] = [];
  const highPoints: SwingPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (swings.isSwingLow[i]) lowPoints.push({ index: i, value: lows[i] });
    if (swings.isSwingHigh[i]) highPoints.push({ index: i, value: highs[i] });
  }
  return { lowPoints, highPoints };
}

export function fitTrendline(
  points: SwingPoint[],
  direction: TrendlineLevel["direction"],
  candles: OhlcvCandle[]
): TrendlineLevel | null {
  if (points.length < 2) return null;
  const p1 = points[points.length - 2];
  const p2 = points[points.length - 1];
  if (p2.index === p1.index) return null;

  const slope = (p2.value - p1.value) / (p2.index - p1.index);
  const lineValueAt = (idx: number) => p1.value + slope * (idx - p1.index);

  let touchCount = 0;
  for (const pt of points) {
    const expected = lineValueAt(pt.index);
    if (expected <= 0) continue;
    if (Math.abs(pt.value - expected) / expected <= TRENDLINE_TOUCH_TOLERANCE_PCT) touchCount++;
  }

  return {
    direction,
    touchCount,
    confirmed: touchCount >= TRENDLINE_MIN_TOUCHES,
    currentValue: lineValueAt(candles.length - 1),
    points: [p1, p2].map((p) => ({ openTime: candles[p.index].openTime, value: p.value })),
  };
}

export function computeTrendlines(
  candles: OhlcvCandle[],
  swingPoints: { lowPoints: SwingPoint[]; highPoints: SwingPoint[] } = computeSwingPoints(candles)
): TrendlineLevel[] {
  const { lowPoints, highPoints } = swingPoints;
  const results: TrendlineLevel[] = [];
  const up = fitTrendline(lowPoints, "up", candles);
  if (up) results.push(up);
  const down = fitTrendline(highPoints, "down", candles);
  if (down) results.push(down);
  return results;
}

// --- Chart-Formationen (neu, 25.09.2026) -----------------------------------
// Nutzer-Nachfrage "doubel top, w-pattern" + Recherche-Auftrag
// "Vollstaendigkeit": Stefan Salomons Lehrbuch deckt neben Trendlinien auch
// M-/W-Formationen (Doppelhoch/-tief), Kopf-Schulter und Dreiecke
// (symmetrisch/steigend/fallend) ab -- alle vier hier umgesetzt, da sie
// direkt auf der bereits vorhandenen Schwenkpunkt-/Trendlinien-Basis
// aufbauen. BEWUSST NICHT umgesetzt: Flaggen/Wimpel/Keile -- die brauchen
// eine andere Erkennungsbasis (ein scharfer vorangehender "Flaggenmast"
// + ein sich verengender Parallelkanal), keine Wiederverwendung der
// Schwenkpunkt-Logik, damit eine eigenstaendige Erweiterung.

export type SwingFormationType =
  | "double_top"
  | "double_bottom"
  | "head_and_shoulders"
  | "inverse_head_and_shoulders";

export interface ChartFormation {
  type: SwingFormationType;
  direction: "BULLISH" | "BEARISH";
  necklineValue: number;
  // Nackenlinie per SCHLUSSKURS gebrochen (nach dem zweiten Top/Bottom bzw.
  // der zweiten Schulter)? Wie bei AVWAP-Pivot/Kerzenmustern reine
  // Beobachtung, kein Handelssignal.
  confirmed: boolean;
  points: TrendlinePoint[];
}

function detectDoubleFormation(
  extremes: SwingPoint[],
  opposites: SwingPoint[],
  type: "double_top" | "double_bottom",
  candles: OhlcvCandle[]
): ChartFormation | null {
  if (extremes.length < 2) return null;
  const p1 = extremes[extremes.length - 2];
  const p2 = extremes[extremes.length - 1];
  if (p2.index <= p1.index) return null;

  const avg = (p1.value + p2.value) / 2;
  if (avg <= 0 || Math.abs(p2.value - p1.value) / avg > FORMATION_PEAK_TOLERANCE_PCT) return null;

  const between = opposites.filter((o) => o.index > p1.index && o.index < p2.index);
  if (between.length === 0) return null;
  const necklineValue =
    type === "double_top" ? Math.min(...between.map((o) => o.value)) : Math.max(...between.map((o) => o.value));

  let confirmed = false;
  for (let i = p2.index + 1; i < candles.length; i++) {
    if (type === "double_top" ? candles[i].close < necklineValue : candles[i].close > necklineValue) {
      confirmed = true;
      break;
    }
  }

  return {
    type,
    direction: type === "double_top" ? "BEARISH" : "BULLISH",
    necklineValue,
    confirmed,
    points: [p1, p2].map((p) => ({ openTime: candles[p.index].openTime, value: p.value })),
  };
}

function detectHeadAndShoulders(
  extremes: SwingPoint[],
  opposites: SwingPoint[],
  type: "head_and_shoulders" | "inverse_head_and_shoulders",
  candles: OhlcvCandle[]
): ChartFormation | null {
  if (extremes.length < 3) return null;
  const [s1, head, s2] = extremes.slice(-3);
  if (!(head.index > s1.index && s2.index > head.index)) return null;

  const headIsExtreme =
    type === "head_and_shoulders" ? head.value > s1.value && head.value > s2.value : head.value < s1.value && head.value < s2.value;
  if (!headIsExtreme) return null;

  const shoulderAvg = (s1.value + s2.value) / 2;
  if (shoulderAvg <= 0 || Math.abs(s2.value - s1.value) / shoulderAvg > FORMATION_PEAK_TOLERANCE_PCT) return null;

  const neck1 = opposites.filter((o) => o.index > s1.index && o.index < head.index);
  const neck2 = opposites.filter((o) => o.index > head.index && o.index < s2.index);
  if (neck1.length === 0 || neck2.length === 0) return null;

  const n1 = type === "head_and_shoulders" ? Math.min(...neck1.map((o) => o.value)) : Math.max(...neck1.map((o) => o.value));
  const n2 = type === "head_and_shoulders" ? Math.min(...neck2.map((o) => o.value)) : Math.max(...neck2.map((o) => o.value));
  const necklineValue = (n1 + n2) / 2;

  let confirmed = false;
  for (let i = s2.index + 1; i < candles.length; i++) {
    if (type === "head_and_shoulders" ? candles[i].close < necklineValue : candles[i].close > necklineValue) {
      confirmed = true;
      break;
    }
  }

  return {
    type,
    direction: type === "head_and_shoulders" ? "BEARISH" : "BULLISH",
    necklineValue,
    confirmed,
    points: [s1, head, s2].map((p) => ({ openTime: candles[p.index].openTime, value: p.value })),
  };
}

export function computeSwingFormations(
  candles: OhlcvCandle[],
  swingPoints: { lowPoints: SwingPoint[]; highPoints: SwingPoint[] } = computeSwingPoints(candles)
): ChartFormation[] {
  const { lowPoints, highPoints } = swingPoints;
  const formations: ChartFormation[] = [];

  const doubleTop = detectDoubleFormation(highPoints, lowPoints, "double_top", candles);
  if (doubleTop) formations.push(doubleTop);
  const doubleBottom = detectDoubleFormation(lowPoints, highPoints, "double_bottom", candles);
  if (doubleBottom) formations.push(doubleBottom);
  const headAndShoulders = detectHeadAndShoulders(highPoints, lowPoints, "head_and_shoulders", candles);
  if (headAndShoulders) formations.push(headAndShoulders);
  const inverseHeadAndShoulders = detectHeadAndShoulders(lowPoints, highPoints, "inverse_head_and_shoulders", candles);
  if (inverseHeadAndShoulders) formations.push(inverseHeadAndShoulders);

  return formations;
}

// --- Dreiecke (neu, 25.09.2026) ---------------------------------------------
// Nutzt die bereits gefitteten Trendlinien (dieselben zwei Linien wie oben)
// wieder -- ein Dreieck ist strukturell nur eine Konvergenz-Klassifikation
// derselben Auf-/Abwaertslinie, kein eigener Fit.

export interface TriangleFormation {
  type: "ascending" | "descending" | "symmetric";
  upperValue: number;
  lowerValue: number;
}

function lineSlopePctPerBar(line: TrendlineLevel, candles: OhlcvCandle[]): number {
  if (line.currentValue === 0) return 0;
  const i1 = candles.findIndex((c) => c.openTime === line.points[0].openTime);
  const i2 = candles.findIndex((c) => c.openTime === line.points[1].openTime);
  if (i1 === -1 || i2 === -1 || i2 === i1) return 0;
  return (line.points[1].value - line.points[0].value) / (i2 - i1) / line.currentValue;
}

export function detectTriangle(trendlines: TrendlineLevel[], candles: OhlcvCandle[]): TriangleFormation | null {
  const up = trendlines.find((l) => l.direction === "up");
  const down = trendlines.find((l) => l.direction === "down");
  if (!up || !down) return null;

  const upSlope = lineSlopePctPerBar(up, candles);
  const downSlope = lineSlopePctPerBar(down, candles);
  const upFlat = Math.abs(upSlope) <= TRIANGLE_FLAT_SLOPE_PCT_PER_BAR;
  const downFlat = Math.abs(downSlope) <= TRIANGLE_FLAT_SLOPE_PCT_PER_BAR;

  let type: TriangleFormation["type"] | null = null;
  if (downFlat && upSlope > TRIANGLE_FLAT_SLOPE_PCT_PER_BAR) type = "ascending";
  else if (upFlat && downSlope < -TRIANGLE_FLAT_SLOPE_PCT_PER_BAR) type = "descending";
  else if (upSlope > TRIANGLE_FLAT_SLOPE_PCT_PER_BAR && downSlope < -TRIANGLE_FLAT_SLOPE_PCT_PER_BAR) type = "symmetric";

  if (!type) return null;
  return { type, upperValue: down.currentValue, lowerValue: up.currentValue };
}

// --- Flaggen/Wimpel/Keile (neu, 25.09.2026) ---------------------------------
// Anders als Trendlinien/Dreiecke ein LOKALES Muster: ein scharfer
// vorangehender Kursimpuls (Flaggenmast, POLE_WINDOW Kerzen), gefolgt von
// einer kurzen Konsolidierung (CONSOLIDATION_WINDOW Kerzen) mit einer
// eigenen, kleinraeumigen Schwenkpunkt-Erkennung (CONSOLIDATION_SWING_
// LOOKBACK statt TRENDLINE_SWING_LOOKBACK). Klassifikation ueber die
// Kanalbreite am Anfang vs. Ende der Konsolidierung: bleibt sie etwa gleich
// -> Flagge (paralleler Kanal), schrumpft sie -> Wimpel (gegenlaeufige
// Linien) oder Keil (beide Linien in dieselbe Richtung geneigt).
//
// BEWUSST OHNE Richtungs-Prognose (kein "direction: BULLISH/BEARISH" wie
// bei Double Top/Kopf-Schulter): ob ein Keil in diesem Kontext eher
// Fortsetzung oder Umkehr bedeutet, ist in der TA-Literatur selbst
// uneinheitlich -- reine strukturelle Beschreibung, wie beim Dreieck oben.

export type ContinuationFormationType = "flag" | "pennant" | "wedge";

export interface ContinuationFormation {
  type: ContinuationFormationType;
  poleDirection: "up" | "down";
  upperValue: number;
  lowerValue: number;
}

function lineValueAtIndex(line: TrendlineLevel, segment: OhlcvCandle[], targetIdx: number): number {
  const i1 = segment.findIndex((c) => c.openTime === line.points[0].openTime);
  const i2 = segment.findIndex((c) => c.openTime === line.points[1].openTime);
  if (i1 === -1 || i2 === -1 || i2 === i1) return line.currentValue;
  const slope = (line.points[1].value - line.points[0].value) / (i2 - i1);
  return line.points[0].value + slope * (targetIdx - i1);
}

// Reine Klassifikation zweier bereits gefitteter Kanal-Linien -- getrennt
// von der Schwenkpunkt-/Flaggenmast-Erkennung, damit die eigentliche
// Unterscheidungslogik (Flagge/Wimpel/Keil) isoliert mit handgebauten
// Linien testbar ist (gleiches Prinzip wie detectTriangle()).
export function classifyChannel(
  upper: TrendlineLevel,
  lower: TrendlineLevel,
  segment: OhlcvCandle[]
): ContinuationFormationType | null {
  const widthStart = lineValueAtIndex(upper, segment, 0) - lineValueAtIndex(lower, segment, 0);
  const widthEnd = upper.currentValue - lower.currentValue;
  if (widthStart <= 0 || widthEnd <= 0) return null;

  const upperSlope = lineSlopePctPerBar(upper, segment);
  const lowerSlope = lineSlopePctPerBar(lower, segment);
  const sameDirection = (upperSlope > 0 && lowerSlope > 0) || (upperSlope < 0 && lowerSlope < 0);

  const widthChangePct = (widthEnd - widthStart) / widthStart;
  if (Math.abs(widthChangePct) <= CHANNEL_PARALLEL_TOLERANCE_PCT) return "flag";
  if (widthChangePct <= -CHANNEL_CONVERGENCE_MIN_SHRINK_PCT) return sameDirection ? "wedge" : "pennant";
  return null;
}

export function detectContinuationFormation(candles: OhlcvCandle[]): ContinuationFormation | null {
  const n = candles.length;
  const poleStart = n - CONSOLIDATION_WINDOW - POLE_WINDOW;
  if (poleStart - POLE_REFERENCE_CANDLES < 0) return null;
  const poleEndExclusive = n - CONSOLIDATION_WINDOW;

  const poleMove = candles[poleEndExclusive - 1].close - candles[poleStart].close;
  const referenceCandles = candles.slice(poleStart - POLE_REFERENCE_CANDLES, poleStart);
  const avgRange = referenceCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / referenceCandles.length;
  if (avgRange <= 0 || Math.abs(poleMove) < POLE_MIN_MOVE_RANGE_MULT * avgRange) return null;
  const poleDirection: "up" | "down" = poleMove > 0 ? "up" : "down";

  const segment = candles.slice(n - CONSOLIDATION_WINDOW);
  const highs = segment.map((c) => c.high);
  const lows = segment.map((c) => c.low);
  const swings = detectFractalSwings(highs, lows, CONSOLIDATION_SWING_LOOKBACK);
  const lowPoints: SwingPoint[] = [];
  const highPoints: SwingPoint[] = [];
  for (let i = 0; i < segment.length; i++) {
    if (swings.isSwingLow[i]) lowPoints.push({ index: i, value: lows[i] });
    if (swings.isSwingHigh[i]) highPoints.push({ index: i, value: highs[i] });
  }

  const upper = fitTrendline(highPoints, "down", segment);
  const lower = fitTrendline(lowPoints, "up", segment);
  if (!upper || !lower) return null;

  const type = classifyChannel(upper, lower, segment);
  if (!type) return null;
  // classifyChannel() verlangt widthEnd > 0 -> upper.currentValue > lower.currentValue.
  return { type, poleDirection, upperValue: upper.currentValue, lowerValue: lower.currentValue };
}

// --- Key Levels (Multi-Timeframe-Pivot-Konfluenz) ---------------------------
// Siehe Datei-Kopfkommentar fuer die Herleitung. Fibonacci-Retracement/
// Orderbuch-Waende bleiben bewusst aussen vor (stehen bereits in
// VwapVectorCard/OrderbookWallCard auf derselben Seite, keine Dopplung).

export type PivotTimeframe = "1w" | "1d" | "4h" | "1h";

export interface TimeframePivotPoint {
  timeframe: PivotTimeframe;
  kind: "high" | "low";
  price: number;
  openTime: string;
}

// Fraktale Schwenkpunkt-Erkennung (PIVOT_FRACTAL_LOOKBACK=3, wie AVWAP-
// Pivot) auf EINEM Zeitrahmen -- wird fuer 1W/1D/4H/1H separat aufgerufen.
export function computeTimeframePivots(
  candles: OhlcvCandle[],
  timeframe: PivotTimeframe
): TimeframePivotPoint[] {
  if (candles.length < PIVOT_FRACTAL_LOOKBACK * 2 + 1) return [];

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const swings = detectFractalSwings(highs, lows, PIVOT_FRACTAL_LOOKBACK);

  const points: TimeframePivotPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (swings.isSwingHigh[i]) {
      points.push({ timeframe, kind: "high", price: highs[i], openTime: candles[i].openTime });
    }
    if (swings.isSwingLow[i]) {
      points.push({ timeframe, kind: "low", price: lows[i], openTime: candles[i].openTime });
    }
  }
  return points;
}

export type KeyLevelConfirmation =
  | "liquidation"
  | "spot_volume"
  | "ema13"
  | "ema50"
  | "ema200"
  | "vwap_daily"
  | "vwap_weekly"
  | "vwap_swing_high"
  | "vwap_swing_low";

export interface KeyLevel {
  price: number;
  side: "resistance" | "support";
  // Zeitrahmen, deren Pivot-Punkte in diese Zone fallen -- je mehr, desto
  // staerker die Konfluenz. Leer, wenn die Zone ausschliesslich aus einem
  // Liquidations-Cluster/Spot-Volume-Knoten ohne nahen Pivot besteht.
  timeframes: PivotTimeframe[];
  confirmedBy: KeyLevelConfirmation[];
  liquidationNotionalUsd: number | null;
  // Spot Volume Profile (30.09.2026): tatsaechlich gehandeltes Kauf-/
  // Verkaufsvolumen (BTC) in dieser Zone, letzte KEY_LEVEL_LOOKBACK_HOURS.
  // Ueberwiegend Kauf = Support-Hinweis, ueberwiegend Verkauf =
  // Widerstand-Hinweis (Toby-Idee 30.09.2026). null, wenn keine
  // signifikante Konzentration in dieser Zone lag.
  spotVolume: { buyVolumeBtc: number; sellVolumeBtc: number } | null;
}

interface LiquidationCluster {
  price: number;
  notionalUsd: number;
  eventCount: number;
}

async function fetchLiquidationClusters(): Promise<LiquidationCluster[]> {
  const since = new Date(Date.now() - KEY_LEVEL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_liquidation_intelligence", {
    p_since: since,
    p_bucket_minutes: 15,
    p_price_bucket_usd: KEY_LEVEL_PRICE_BUCKET_USD,
  });

  if (error) {
    console.error("chartStructureContext: Fehler bei get_liquidation_intelligence:", error.message);
    return [];
  }

  const clusters =
    ((data as Record<string, unknown> | null)?.price_clusters as
      | { price_bucket: number; notional_usd: number; event_count: number }[]
      | undefined) ?? [];

  return clusters
    .slice()
    .sort((a, b) => b.notional_usd - a.notional_usd)
    .slice(0, KEY_LEVEL_MAX_LIQUIDATION_CLUSTERS)
    .map((c) => ({ price: c.price_bucket, notionalUsd: c.notional_usd, eventCount: c.event_count }));
}

interface SpotVolumeNode {
  price: number;
  buyVolumeBtc: number;
  sellVolumeBtc: number;
}

// Liest die vom collect-spot-volume-profile-Collector bereits vorverdichteten
// Preis-Buckets (siehe RPC-Kommentar in der Migration) -- dieselbe "nur die
// staerksten N zeigen"-Logik wie fetchLiquidationClusters oben.
async function fetchSpotVolumeNodes(): Promise<SpotVolumeNode[]> {
  const since = new Date(Date.now() - KEY_LEVEL_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_spot_volume_profile", {
    p_since: since,
    p_price_bucket_usd: KEY_LEVEL_PRICE_BUCKET_USD,
  });

  if (error) {
    console.error("chartStructureContext: Fehler bei get_spot_volume_profile:", error.message);
    return [];
  }

  const nodes =
    ((data as Record<string, unknown> | null)?.price_buckets as
      | { price_bucket: number; buy_volume: number; sell_volume: number; trade_count: number }[]
      | undefined) ?? [];

  return nodes
    .slice()
    .sort((a, b) => b.buy_volume + b.sell_volume - (a.buy_volume + a.sell_volume))
    .slice(0, SPOT_VOLUME_MAX_NODES)
    .map((n) => ({ price: n.price_bucket, buyVolumeBtc: n.buy_volume, sellVolumeBtc: n.sell_volume }));
}

// Interne, vereinheitlichte Rohquelle vor der Zonen-Buendelung -- ein Pivot-
// Punkt, ein Liquidations-Cluster und ein Spot-Volume-Knoten sind alle
// einfach "ein Preis mit Herkunft", erst die Buendelung unterscheidet
// danach wieder.
interface RawLevelSource {
  price: number;
  pivot?: { timeframe: PivotTimeframe };
  liquidation?: { notionalUsd: number };
  spotVolume?: { buyVolumeBtc: number; sellVolumeBtc: number };
}

// Kernstueck der Key-Levels-Neuerung: buendelt Pivot-Punkte (aus allen vier
// Zeitrahmen), Liquidations-Cluster UND Spot-Volume-Knoten zu Zonen, wenn
// sie innerhalb tolerancePct beieinander liegen (single-linkage, sortiert
// nach Preis) -- EMA/VWAP werden NICHT hier eingerechnet (siehe
// withConfirmationLevels()), damit diese Funktion komplett pure/testbar
// bleibt (kein Fetch, keine externen Werte).
export function buildKeyLevelZones(
  pivotPoints: TimeframePivotPoint[],
  liquidationClusters: LiquidationCluster[],
  spotVolumeNodes: SpotVolumeNode[],
  currentPrice: number,
  tolerancePct: number = PIVOT_CONFLUENCE_TOLERANCE_PCT
): KeyLevel[] {
  const raw: RawLevelSource[] = [
    ...pivotPoints.map((p) => ({ price: p.price, pivot: { timeframe: p.timeframe } })),
    ...liquidationClusters.map((c) => ({ price: c.price, liquidation: { notionalUsd: c.notionalUsd } })),
    ...spotVolumeNodes.map((n) => ({
      price: n.price,
      spotVolume: { buyVolumeBtc: n.buyVolumeBtc, sellVolumeBtc: n.sellVolumeBtc },
    })),
  ].sort((a, b) => a.price - b.price);

  const zones: KeyLevel[] = [];
  let clusterMembers: RawLevelSource[] = [];
  let clusterMeanPrice = 0;

  const flush = () => {
    if (clusterMembers.length === 0) return;
    const price = clusterMembers.reduce((sum, m) => sum + m.price, 0) / clusterMembers.length;
    const timeframes = Array.from(
      new Set(clusterMembers.filter((m) => m.pivot).map((m) => m.pivot!.timeframe))
    );
    const liquidationMembers = clusterMembers.filter((m) => m.liquidation);
    const spotVolumeMembers = clusterMembers.filter((m) => m.spotVolume);
    const confirmedBy: KeyLevelConfirmation[] = [];
    if (liquidationMembers.length > 0) confirmedBy.push("liquidation");
    if (spotVolumeMembers.length > 0) confirmedBy.push("spot_volume");
    const liquidationNotionalUsd =
      liquidationMembers.length > 0
        ? liquidationMembers.reduce((sum, m) => sum + m.liquidation!.notionalUsd, 0)
        : null;
    const spotVolume =
      spotVolumeMembers.length > 0
        ? {
            buyVolumeBtc: spotVolumeMembers.reduce((sum, m) => sum + m.spotVolume!.buyVolumeBtc, 0),
            sellVolumeBtc: spotVolumeMembers.reduce((sum, m) => sum + m.spotVolume!.sellVolumeBtc, 0),
          }
        : null;

    zones.push({
      price,
      side: price >= currentPrice ? "resistance" : "support",
      timeframes,
      confirmedBy,
      liquidationNotionalUsd,
      spotVolume,
    });
    clusterMembers = [];
  };

  for (const source of raw) {
    if (clusterMembers.length === 0) {
      clusterMembers.push(source);
      clusterMeanPrice = source.price;
      continue;
    }
    const withinTolerance =
      clusterMeanPrice > 0 && Math.abs(source.price - clusterMeanPrice) / clusterMeanPrice <= tolerancePct;
    if (withinTolerance) {
      clusterMembers.push(source);
      clusterMeanPrice = clusterMembers.reduce((sum, m) => sum + m.price, 0) / clusterMembers.length;
    } else {
      flush();
      clusterMembers.push(source);
      clusterMeanPrice = source.price;
    }
  }
  flush();

  // Naeher an currentPrice = relevanter -- je Seite auf die staerksten/
  // naechstgelegenen KEY_LEVEL_MAX_ZONES_PER_SIDE begrenzen, sonst koennte
  // die Liste bei vier Zeitrahmen + Liquidationen sehr lang werden.
  const resistances = zones
    .filter((z) => z.side === "resistance")
    .sort((a, b) => a.price - b.price)
    .slice(0, KEY_LEVEL_MAX_ZONES_PER_SIDE);
  const supports = zones
    .filter((z) => z.side === "support")
    .sort((a, b) => b.price - a.price)
    .slice(0, KEY_LEVEL_MAX_ZONES_PER_SIDE);

  return [...resistances.reverse(), ...supports];
}

// Reichert bereits berechnete Key Levels NACHTRAEGLICH um EMA-/VWAP-
// Konfluenz an -- bewusst NICHT Teil von getChartStructureData()/
// buildKeyLevelZones(): EMA13/50/200 (meinSystemContext) und VWAP
// (tradingIndicatorsContext) werden auf app/lernen/page.tsx ohnehin schon
// fuer andere Kacheln geladen; ein zweiter Fetch/Rechenweg nur fuer diese
// Konfluenz-Pruefung waere unnoetig. Pure Funktion, daher isoliert testbar.
export function withConfirmationLevels(
  data: ChartStructureData,
  levels: { label: KeyLevelConfirmation; price: number | null }[],
  tolerancePct: number = PIVOT_CONFLUENCE_TOLERANCE_PCT
): ChartStructureData {
  const keyLevels = data.keyLevels.map((zone) => {
    const additions = levels.filter(
      (lvl) =>
        lvl.price !== null &&
        zone.price > 0 &&
        Math.abs(lvl.price - zone.price) / zone.price <= tolerancePct &&
        !zone.confirmedBy.includes(lvl.label)
    );
    if (additions.length === 0) return zone;
    return { ...zone, confirmedBy: [...zone.confirmedBy, ...additions.map((a) => a.label)] };
  });
  return { ...data, keyLevels };
}

// --- Kombinierter Einstiegspunkt -------------------------------------------

export interface ChartStructureData {
  interval: "1h";
  candlestickPatterns: CandlestickPatternEvent[];
  avwapPivotLevels: AvwapPivotLevel[];
  trendlines: TrendlineLevel[];
  swingFormations: ChartFormation[];
  triangle: TriangleFormation | null;
  continuationFormation: ContinuationFormation | null;
  keyLevels: KeyLevel[];
  currentPrice: number | null;
  dataAsOf: string | null;
}

export async function getChartStructureData(): Promise<ChartStructureData> {
  const [candles, candles4h, candlesDailySource, liquidationClusters, spotVolumeNodes] = await Promise.all([
    fetchCandles(),
    fetchCandlesForInterval("4h", PIVOT_4H_LOOKBACK_CANDLES),
    fetchCandlesForInterval("1d", PIVOT_WEEKLY_SOURCE_DAILY_CANDLES),
    fetchLiquidationClusters(),
    fetchSpotVolumeNodes(),
  ]);

  const lastCandle = candles[candles.length - 1] ?? null;
  const currentPrice = lastCandle?.close ?? null;

  const swingPoints = computeSwingPoints(candles);
  const trendlines = computeTrendlines(candles, swingPoints);

  const candlesDaily = candlesDailySource.slice(-PIVOT_DAILY_LOOKBACK_CANDLES);
  const candlesWeekly = aggregateToWeekly(candlesDailySource);
  const pivotPoints = [
    ...computeTimeframePivots(candlesWeekly, "1w"),
    ...computeTimeframePivots(candlesDaily, "1d"),
    ...computeTimeframePivots(candles4h, "4h"),
    ...computeTimeframePivots(candles, "1h"),
  ];
  const keyLevels =
    currentPrice !== null
      ? buildKeyLevelZones(pivotPoints, liquidationClusters, spotVolumeNodes, currentPrice)
      : [];

  return {
    interval: "1h",
    candlestickPatterns: detectCandlestickPatterns(candles),
    avwapPivotLevels: computeAvwapPivotLevels(candles),
    trendlines,
    swingFormations: computeSwingFormations(candles, swingPoints),
    triangle: detectTriangle(trendlines, candles),
    continuationFormation: detectContinuationFormation(candles),
    keyLevels,
    currentPrice,
    dataAsOf: lastCandle?.openTime ?? null,
  };
}
