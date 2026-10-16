import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 1 Market-Intelligence-Engine: Candle-Collector + Indikator-Engine.
//
// Data Layer (candles) und Analysis Layer (market_features) sind bewusst
// getrennt (siehe Migration create_candles_and_market_features): diese
// Function befuellt beide, aber in zwei unabhaengigen Schritten -- 1) rohe
// Binance-Futures-Klines speichern, 2) daraus Indikatoren berechnen. Ein
// zukuenftiger zweiter Kerzen-Provider koennte candles fuellen, ohne dass
// market_features angepasst werden muesste.
//
// Datenquelle: Binance Futures Klines (fapi.binance.com) -- bereits
// etablierte, oeffentliche, kostenlose Quelle (collect-btc nutzt dieselbe
// Basis-URL). taker_buy_base_vol aus der Kline liefert die Grundlage fuer
// Futures-CVD ohne zusaetzlichen Datenaufruf. OI-Werte kommen ausschliesslich
// ueber die bereits fixierte get_market_series-RPC (aggregated) -- keine
// zweite/duplizierte OI-Logik. Basis nutzt die bereits vorhandenen
// spot_market_snapshots (Binance Spot) -- kein neuer externer Call.
//
// Alle Schwellenwerte/Lookbacks sind benannte Konstanten, nicht hart im
// Code verstreut -- spaeter per Backtesting optimierbar, keine "magischen
// Zahlen" (Spec-Vorgabe).
//
// 2026-09-11: "15m" ergaenzt (Confluence-Score-Protokoll, siehe
// CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md Abschnitt 8 "Pipeline-Integration"
// und CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md) -- die sequenzielle
// Swing-Setup-Kette (research_swing_setup_chain_events) UND die meisten der
// 29 getesteten Confluence-Signale (Struktur/CVD/Trendstaerke/Trend-Regime/
// VWAP-Position) basieren auf 15m-market_features, das bisher nur per
// Einmal-Backfill bis 2026-09-04 befuellt war (siehe backfill-history/
// index.ts) und seitdem nicht mehr live nachgezogen wurde -- ohne laufende
// 15m-Kerzen friert die gesamte Confluence-Pipeline ein. Dieser Cron laeuft
// ohnehin bereits alle 15 Minuten (collect-candles-every-15-min), also exakt
// im 15m-Kerzen-Takt -- kein neuer Cron noetig, nur der zusaetzliche
// Intervall-Eintrag.
//
// 2026-09-14: "1m" ergaenzt (Nutzer-Recherche "5m/15m/1h RSI-Gegenbewegung"
// -- 5m existiert als Intervall nirgends, muss aus 1m resampled werden).
// Die 1m-candles-Historie war bisher NUR per Einmal-Backfill bis 2026-09-04
// befuellt (siehe backfill-history/index.ts, dort seit 11.09.2026 bewusst
// NUR fuer candles zugelassen, s.u.) und lief seitdem nicht weiter -- exakt
// dasselbe "friert ein"-Muster wie beim 15m-Fix oben, hier fuer 1m nachgezogen.
// WICHTIG: 1m schreibt bewusst NUR in candles, NICHT in market_features
// (siehe Weiche in processInterval() unten) -- market_features_interval_
// check erlaubt ohnehin nur 15m/1h/4h/1d/1w, und bei 1m-Dichte (~15x mehr
// Zeilen als 15m) waere die Indikator-Berechnung reiner Mehraufwand fuer ein
// Feature-Set, das aktuell nirgends angefragt ist (identische Begruendung
// wie in backfill-history/index.ts, dort am 11.09.2026 dokumentiert).
//
// 2026-09-21: Bugfix (Toby-Feedback: Liquidations-/Hebelkarte zeigte
// "Nicht genug OI-Historie", obwohl die Rohdaten gesund waren). Root Cause
// ueber die Edge-Function-Logs verifiziert: Schritt 4 (OI/Spot-Zuordnung)
// rief get_market_series('aggregated', ...) bisher mit p_since=candles[0]
// auf -- dem AELTESTEN der bis zu FETCH_LIMIT=1000 geladenen Kerzen, obwohl
// nur die juengsten WRITE_LOOKBACK=250 Kerzen ueberhaupt geschrieben werden
// (bei 1H ~41 Tage, bei 4H/1D noch deutlich mehr Spanne als noetig). Diese
// unnoetig breite Spanne liess die aggregierte OI-Abfrage (LATERAL-Join
// ueber 5 Boersen) bei JEDEM Lauf in einen Postgres-Statement-Timeout
// laufen (Log-Beleg: "OI-Serie (1h): canceling statement due to statement
// timeout", durchgehend fuer 15m/1H/4H/1D) -- oi_current/oi_delta_pct/
// oi_volume_ratio/spot_price/basis_pct blieben dadurch leer, obwohl
// market_snapshots/spot_market_snapshots vollstaendig und aktuell sind.
// Fix: startIdx (Beginn des tatsaechlich geschriebenen Fensters) wird jetzt
// VOR Schritt 4 berechnet, die OI-/Spot-Abfrage startet ab einer Kerze vor
// startIdx (Puffer fuer oiDeltaPct der aeltesten geschriebenen Zeile) statt
// ab candles[0] -- dieselbe Grundfunktion, nur ein deutlich kleineres,
// tatsaechlich benoetigtes Zeitfenster.
//
// 2026-10-02: "1w" ergaenzt (Nutzer-Frage: "mtf ampel 1w wird nicht
// angezeigt weil nicht vorhanden?" -- die MTF-Ampel im Next.js-Repo
// (lib/mtfSignal.ts) zeigte 1W bisher hart codiert immer als "keine Daten",
// weil hier nie Wochenkerzen gesammelt wurden. candles_interval_check/
// market_features_interval_check wurden vorab per Migration um "1w"
// erweitert. Binance liefert bei interval=1w nur so viele Kerzen zurueck,
// wie tatsaechlich existieren (BTCUSDT-Perpetual-Historie seit 09/2019,
// also deutlich unter FETCH_LIMIT=1000) -- ema_800 (braucht 800 Kerzen
// Vorlauf) bleibt fuer 1w dadurch auf absehbare Zeit weiterhin null, exakt
// das bestehende "keine Daten statt erfundener Wert"-Verhalten wie bei
// jedem anderen Intervall mit zu kurzer Historie, kein neuer Sonderfall.
//
// 2026-10-14: computeMarketStructure kausal (siehe Kommentar dort und
// docs/research/ORDERFLOW-4-SCHRITTE-PROTOCOL_2026-10-13.md, Nachtrag 1).
// Bis hierher wurde ein Fraktal-Swing schon an seiner eigenen Kerze j
// verarbeitet, obwohl er erst nach Kerze j+SWING_LOOKBACK feststeht. Weil
// jeder Lauf die letzten WRITE_LOOKBACK Zeilen neu schreibt, enthielt die
// gespeicherte Historie von structure_trend/bos/choch dadurch bis zu 5
// Kerzen Blick in die Zukunft (1h: 12 % der Kerzen betroffen).
// Historie per recompute_market_structure_causal() neu berechnet.
// Quellcode liegt seit 2026-10-14 auch im Repo (supabase/functions/
// collect-candles/index.ts).
//
// 2026-10-15: Spot-Zuordnung fuer basis_pct nur noch mit 5 Min Toleranz,
// siehe SPOT_TOLERANCE_MS.
const SYMBOL = "BTCUSDT";
const INTERVALS = ["1m", "15m", "1h", "4h", "1d", "1w"] as const;
type Interval = (typeof INTERVALS)[number];

// Wie viele Kerzen pro Lauf max. von Binance geholt UND aus der eigenen
// candles-Tabelle geladen werden (Vorlauf fuer EMA800/ADX + Reserve).
// Binance erlaubt bis zu 1500 Kerzen pro Request. Auf 500 angehoben auf
// 1000 (Trade-Debate-Kachel, 07.09.2026): EMA800 braucht mindestens 800
// Kerzen Vorlauf zum Seeden (SMA der ersten 800 Werte) -- mit dem alten
// FETCH_LIMIT=500 waere EMA800 nie ins Seeding gekommen, weil hier ohnehin
// nur die juengsten FETCH_LIMIT Kerzen geladen werden. Nebeneffekt beim
// 1D-Intervall: die Binance-Anfrage mit limit=1000 liefert automatisch
// auch tiefere historische Tageskerzen als zuvor gespeichert -- die
// candles-Tabelle wuchs beim ersten Lauf mit diesem Wert von 733 auf 999
// Tageskerzen, ganz ohne separaten Backfill.
const FETCH_LIMIT = 1000;

// Wie viele der juengsten Kerzen pro Lauf tatsaechlich in market_features
// geschrieben werden. Kleiner als FETCH_LIMIT, damit (a) genug Vorlauf-
// Historie fuer EMA800/ADX besteht, ohne (b) bei jedem Cron-Tick hunderte
// Zeilen unnoetig neu zu schreiben -- deckt trotzdem genug juengere
// Historie ab, um spaete OI-/Basis-Korrekturen nachzuziehen.
const WRITE_LOOKBACK = 250;

// Spot-Preis fuer die Basis: hoechstens 5 Minuten vor dem Kerzenschluss.
// spot_market_snapshots ist ein 5-Minuten-Raster, timestamp_utc = Beginn des
// 5-Min-Fensters, last_price = Kurs am Ende des Fensters. Zur 1h-Kerze mit
// Schluss 13:59:59.999 passt also der Snapshot 13:55 (Kurs um 14:00).
// 2026-10-15 (Fehlalarm "Basis/Perpetual-Praemie extrem"): vorher galt die
// OI-Toleranz (>= 1 h). Lief collect-candles, bevor der 13:55-Snapshot
// geschrieben war, nahm es den von 13:50 -- 5 Minuten zu alt. Bei einer
// schnellen Bewegung ergab das +0,33 % statt -0,065 % Basis und eine
// Risiko-Push. Jetzt: fehlt der passende Snapshot noch, bleibt basis_pct
// leer und der naechste Lauf (WRITE_LOOKBACK schreibt neu) fuellt ihn nach.
const SPOT_TOLERANCE_MS = 5 * 60 * 1000;

// Fraktale Swing-Erkennung: ein Hoch/Tief gilt als bestaetigt, wenn es
// hoeher/tiefer ist als jede der LOOKBACK Kerzen davor und danach
// (Standard-Fraktal-Definition, 5 ist die gebraeuchlichste Wahl).
// Konfigurierbar gehalten fuer spaeteres Backtesting.
const SWING_LOOKBACK = 5;

// Wilder-Perioden (Branchenstandard) fuer RSI/ATR/ADX.
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

// Lookback fuer die CVD-Trend-Klassifikation (rising/falling/flat).
const CVD_TREND_LOOKBACK = 5;

// Donchian-Channel-Standardperiode fuer Range High/Low.
const RANGE_LOOKBACK = 20;

// Rollierendes Fenster fuer VWAP (gleiche Periodenlaenge wie RANGE_LOOKBACK,
// konsistent zu den uebrigen Lookbacks). Bugfix: VWAP wurde zuvor kumulativ
// ueber das GESAMTE geladene FETCH_LIMIT-Fenster (500 Kerzen, bei 1H ca.
// 20 Tage) berechnet -- mit wachsendem kumuliertem Volumen wurde jede neue
// Kerze anteilig verschwindend klein, wodurch VWAP faktisch einfror und weit
// hinter dem aktuellen Preis zurueckblieb (verifiziert: VWAP driftete von
// ca. 64100 auf 70700, waehrend der Preis im selben Zeitraum auf ca. 78700
// stieg). Ein rollierendes 20-Perioden-Fenster bleibt ein aktueller
// Referenzwert, wie fuer die geplante "Preis vs. VWAP"-Einordnung noetig.
const VWAP_LOOKBACK = 20;

function intervalToMs(interval: Interval): number {
  switch (interval) {
    case "1m":
      return 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "1w":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --- Indikator-Bausteine ---------------------------------------------------

// Generische EMA-Berechnung, die auch Serien mit fuehrenden nulls verarbeiten
// kann (z.B. macdLine, die erst startet, sobald die langsame EMA seed hat).
// Seed = SMA der ersten `period` nicht-null Werte.
function emaSeries(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema: number | null = null;
  const seedBuffer: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (ema === null) {
      seedBuffer.push(v);
      if (seedBuffer.length === period) {
        ema = seedBuffer.reduce((a, b) => a + b, 0) / period;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

function computeRsi(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function computeAtr(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  const n = highs.length;
  const tr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) tr[i] = highs[i] - lows[i];
    else tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return out;
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

function computeAdx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): { adx: (number | null)[]; plusDi: (number | null)[]; minusDi: (number | null)[] } {
  const n = highs.length;
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDiOut: (number | null)[] = new Array(n).fill(null);
  const minusDiOut: (number | null)[] = new Array(n).fill(null);
  if (n <= period * 2) return { adx, plusDi: plusDiOut, minusDi: minusDiOut };

  let smTr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smPlusDM = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smMinusDM = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  for (let i = period + 1; i < n; i++) {
    smTr = smTr - smTr / period + tr[i];
    smPlusDM = smPlusDM - smPlusDM / period + plusDM[i];
    smMinusDM = smMinusDM - smMinusDM / period + minusDM[i];
    const plusDi = smTr === 0 ? 0 : (smPlusDM / smTr) * 100;
    const minusDi = smTr === 0 ? 0 : (smMinusDM / smTr) * 100;
    plusDiOut[i] = plusDi;
    minusDiOut[i] = minusDi;
    const diSum = plusDi + minusDi;
    const dx = diSum === 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100;
    dxValues.push(dx);
    if (dxValues.length === period) {
      adx[i] = dxValues.reduce((a, b) => a + b, 0) / period;
    } else if (dxValues.length > period) {
      const prevAdx = adx[i - 1]!;
      adx[i] = (prevAdx * (period - 1) + dx) / period;
    }
  }
  return { adx, plusDi: plusDiOut, minusDi: minusDiOut };
}

// VWAP als rollierendes Fenster ueber die letzten `lookback` Kerzen (nicht
// ueber das gesamte geladene Datenfenster -- siehe VWAP_LOOKBACK-Kommentar
// oben). Kein fester Handels-"Session"-Reset, da BTC-Perpetuals 24/7 ohne
// Session-Grenzen handeln; ein rollierendes Fenster erreicht denselben
// Zweck (aktueller Referenzwert) ohne kuenstliche Tagesgrenze.
function computeVwap(highs: number[], lows: number[], closes: number[], volumes: number[], lookback: number): number[] {
  const n = highs.length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - lookback + 1);
    let cumPV = 0;
    let cumV = 0;
    for (let j = start; j <= i; j++) {
      const typical = (highs[j] + lows[j] + closes[j]) / 3;
      cumPV += typical * volumes[j];
      cumV += volumes[j];
    }
    out[i] = cumV === 0 ? closes[i] : cumPV / cumV;
  }
  return out;
}

// Donchian-artige Range High/Low: hoechster High / tiefster Low der letzten
// `lookback` Kerzen inkl. der aktuellen. Einfache, ungewichtete Rolling-
// Window-Extrempunkte -- ergaenzt die Swing-basierte Struktur um eine
// zweite, davon unabhaengige Referenz (kein fraktales Bestaetigungs-Delay).
function computeRollingRange(
  highs: number[],
  lows: number[],
  lookback: number,
): { rangeHigh: (number | null)[]; rangeLow: (number | null)[] } {
  const n = highs.length;
  const rangeHigh: (number | null)[] = new Array(n).fill(null);
  const rangeLow: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < lookback - 1) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - lookback + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    rangeHigh[i] = hi;
    rangeLow[i] = lo;
  }
  return { rangeHigh, rangeLow };
}

type SwingType = "HH" | "HL" | "LH" | "LL";
type Trend = "bullish" | "bearish" | "ranging";

interface StructureResult {
  swingType: (SwingType | null)[];
  structureTrend: Trend[];
  bos: boolean[];
  bosDirection: ("bullish" | "bearish" | null)[];
  choch: boolean[];
  chochDirection: ("bullish" | "bearish" | null)[];
}

// Vereinfachte, dokumentierte Markt-Struktur-Erkennung: fraktale Swing-
// Highs/Lows (+/- lookback), daraus HH/HL/LH/LL, daraus Trend/BOS/CHoCH.
// BOS = Bruch des letzten Extrempunkts IN Trendrichtung (Bestaetigung),
// CHoCH = Bruch GEGEN die Trendrichtung (moeglicher Trendwechsel, dreht
// den Trend-Zustand). Dient als strukturelles Rohmaterial fuer die
// spaetere Market-State-Engine, ist kein eigenstaendiges Handelssignal.
//
// 2026-10-14 kausal: Ein Swing bei Kerze j steht erst fest, wenn auch die
// `lookback` Kerzen danach vorliegen. Er wird deshalb erst bei Kerze
// i = j + lookback verarbeitet (Trend, BOS-/CHoCH-Referenzpreise).
// structure_trend/bos/choch einer Kerze haengen damit nur noch von Kerzen
// bis einschliesslich dieser Kerze ab. swing_type bleibt bewusst am
// Pivot-Bar j stehen (levelStructureContext/get_anchored_vwap_summary
// brauchen die Lage des Pivots); Typ und Reihenfolge sind unveraendert.
// Referenz-Implementierung + Tests: research-python/orderflow_4step/
// features.py::causal_structure_trend.
function computeMarketStructure(highs: number[], lows: number[], lookback: number): StructureResult {
  const n = highs.length;
  const swingType: (SwingType | null)[] = new Array(n).fill(null);
  const structureTrend: Trend[] = new Array(n).fill("ranging");
  const bos: boolean[] = new Array(n).fill(false);
  const bosDirection: ("bullish" | "bearish" | null)[] = new Array(n).fill(null);
  const choch: boolean[] = new Array(n).fill(false);
  const chochDirection: ("bullish" | "bearish" | null)[] = new Array(n).fill(null);

  const rawSwingHigh: boolean[] = new Array(n).fill(false);
  const rawSwingLow: boolean[] = new Array(n).fill(false);
  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    rawSwingHigh[i] = isHigh;
    rawSwingLow[i] = isLow;
  }

  let lastSwingHighPrice: number | null = null;
  let lastSwingLowPrice: number | null = null;
  let trend: Trend = "ranging";

  for (let i = 0; i < n; i++) {
    const j = i - lookback;
    let confirmedType: SwingType | null = null;
    if (j >= 0) {
      if (rawSwingHigh[j]) {
        if (lastSwingHighPrice !== null) {
          confirmedType = highs[j] > lastSwingHighPrice ? "HH" : "LH";
        }
        lastSwingHighPrice = highs[j];
      } else if (rawSwingLow[j]) {
        if (lastSwingLowPrice !== null) {
          confirmedType = lows[j] > lastSwingLowPrice ? "HL" : "LL";
        }
        lastSwingLowPrice = lows[j];
      }
      swingType[j] = confirmedType;
    }

    if (confirmedType === "HH" || confirmedType === "HL") trend = "bullish";
    else if (confirmedType === "LH" || confirmedType === "LL") trend = "bearish";

    const priorTrend = trend;
    if (priorTrend === "bullish") {
      if (lastSwingLowPrice !== null && lows[i] < lastSwingLowPrice) {
        choch[i] = true;
        chochDirection[i] = "bearish";
        trend = "bearish";
      } else if (lastSwingHighPrice !== null && highs[i] > lastSwingHighPrice) {
        bos[i] = true;
        bosDirection[i] = "bullish";
      }
    } else if (priorTrend === "bearish") {
      if (lastSwingHighPrice !== null && highs[i] > lastSwingHighPrice) {
        choch[i] = true;
        chochDirection[i] = "bullish";
        trend = "bullish";
      } else if (lastSwingLowPrice !== null && lows[i] < lastSwingLowPrice) {
        bos[i] = true;
        bosDirection[i] = "bearish";
      }
    }

    structureTrend[i] = trend;
  }

  return { swingType, structureTrend, bos, bosDirection, choch, chochDirection };
}

// Sortierte Punkt-Reihe (t=Millis, v=Wert) fuer Asof-Lookups: letzter Punkt
// mit t <= targetMs, sofern innerhalb der Toleranz -- gleiches Prinzip wie
// die LATERAL-Asof-Logik in get_market_series/get_market_reference_snapshot,
// hier in JS fuer den Kerzen-Zeitraster.
function buildAsofLookup(points: { t: number; v: number }[]) {
  return function lookup(targetMs: number, toleranceMs: number): number | null {
    let lo = 0;
    let hi = points.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= targetMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans === -1) return null;
    if (targetMs - points[ans].t > toleranceMs) return null;
    return points[ans].v;
  };
}

interface ProcessResult {
  success: boolean;
  candlesFetched: number;
  candlesStored: number;
  featuresWritten: number;
  note?: string;
}

async function processInterval(supabase: any, interval: Interval): Promise<ProcessResult> {
  // 1) Klines von Binance Futures holen, nur garantiert abgeschlossene
  // Kerzen (closeTime < jetzt) uebernehmen -- die aktuell noch offene
  // Kerze wuerde unvollstaendige Werte (v.a. Volumen/Taker-Split) liefern.
  const raw = await fetchJson(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${interval}&limit=${FETCH_LIMIT}`,
  );
  if (!Array.isArray(raw)) throw new Error("Unerwartete Binance-Kline-Antwort");

  const nowMs = Date.now();
  const closedKlines = raw.filter((k: any[]) => k[6] < nowMs);

  const candleRows = closedKlines.map((k: any[]) => ({
    exchange: "binance",
    symbol: SYMBOL,
    interval,
    open_time: new Date(k[0]).toISOString(),
    close_time: new Date(k[6]).toISOString(),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    quote_volume: parseFloat(k[7]),
    taker_buy_base_vol: parseFloat(k[9]),
    taker_buy_quote_vol: parseFloat(k[10]),
    trade_count: Number(k[8]),
  }));

  if (candleRows.length > 0) {
    const { error: candleError } = await supabase
      .from("candles")
      .upsert(candleRows, { onConflict: "exchange,symbol,interval,open_time", ignoreDuplicates: true });
    if (candleError) throw new Error(`candles upsert: ${candleError.message}`);
  }

  // 2026-09-14: "1m" schreibt bewusst NUR candles, keine market_features
  // (siehe Kommentar am Dateianfang) -- hier abgebrochen, bevor die
  // vergleichsweise teure Indikator-Berechnung unten ueberhaupt anlaeuft.
  if (interval === "1m") {
    return {
      success: true,
      candlesFetched: closedKlines.length,
      candlesStored: candleRows.length,
      featuresWritten: 0,
      note: "1m: nur candles, market_features bewusst ausgelassen",
    };
  }

  // 2) Eigene Historie zurueckladen -- nutzt konsequent das, was tatsaechlich
  // in candles steht (kann durch fruehere Laeufe bereits mehr Historie
  // enthalten als der aktuelle Batch).
  const { data: storedDesc, error: readError } = await supabase
    .from("candles")
    .select(
      "open_time,close_time,open,high,low,close,volume,quote_volume,taker_buy_base_vol,taker_buy_quote_vol,trade_count",
    )
    .eq("exchange", "binance")
    .eq("symbol", SYMBOL)
    .eq("interval", interval)
    .order("open_time", { ascending: false })
    .limit(FETCH_LIMIT);
  if (readError) throw new Error(`candles read: ${readError.message}`);

  const candles = [...(storedDesc ?? [])].reverse();
  const n = candles.length;
  if (n < RSI_PERIOD + 1) {
    return {
      success: true,
      candlesFetched: closedKlines.length,
      candlesStored: candleRows.length,
      featuresWritten: 0,
      note: "Zu wenig Historie fuer Indikatoren",
    };
  }

  // Bugfix 21.09.2026 (siehe Kommentar am Dateianfang): startIdx frueher
  // berechnet, damit Schritt 4 unten (OI/Spot-Zuordnung) nur noch das
  // tatsaechlich GESCHRIEBENE Fenster abfragt statt des vollen geladenen
  // n-Kerzen-Fensters.
  const startIdx = Math.max(0, n - WRITE_LOOKBACK);

  const highs = candles.map((c: any) => Number(c.high));
  const lows = candles.map((c: any) => Number(c.low));
  const closes = candles.map((c: any) => Number(c.close));
  const volumes = candles.map((c: any) => Number(c.volume));
  const takerBuy = candles.map((c: any) => Number(c.taker_buy_base_vol ?? 0));
  const closeTimesMs = candles.map((c: any) => Date.parse(c.close_time));

  // 3) Indikatoren
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema100 = emaSeries(closes, 100);
  const ema200 = emaSeries(closes, 200);
  // EMA800 (Trade-Debate-Kachel, 07.09.2026): braucht 800 Kerzen Vorlauf zum
  // Seeden. Der FETCH_LIMIT-Erhoehung auf 1000 zieht bei Binance automatisch
  // auch tiefere Historie nach (verifiziert 07.09.2026: 1D-Kerzen in candles
  // sprangen von 733 auf 999 im selben Lauf) -- auf 1h/4h/1D dadurch bereits
  // beim ersten Lauf ausreichend Historie zum Seeden vorhanden.
  const ema800 = emaSeries(closes, 800);
  const rsi = computeRsi(closes, RSI_PERIOD);
  const emaFast = emaSeries(closes, MACD_FAST);
  const emaSlow = emaSeries(closes, MACD_SLOW);
  const macdLine = emaFast.map((f, i) => (f !== null && emaSlow[i] !== null ? f - (emaSlow[i] as number) : null));
  const macdSignal = emaSeries(macdLine, MACD_SIGNAL);
  const macdHist = macdLine.map((m, i) => (m !== null && macdSignal[i] !== null ? m - (macdSignal[i] as number) : null));
  const atr = computeAtr(highs, lows, closes, ATR_PERIOD);
  const { adx, plusDi, minusDi } = computeAdx(highs, lows, closes, ADX_PERIOD);
  const vwap = computeVwap(highs, lows, closes, volumes, VWAP_LOOKBACK);
  const { rangeHigh, rangeLow } = computeRollingRange(highs, lows, RANGE_LOOKBACK);
  const structure = computeMarketStructure(highs, lows, SWING_LOOKBACK);

  // Futures-CVD aus taker_buy_base_vol (direkt aus dem Trade-Tape der
  // Binance-Kline, kein Schaetzwert -- gleiches Prinzip wie bei
  // collect-spot-pressure auf der Spot-Seite). cvd_cumulative ist kumulativ
  // ueber das GELADENE Fenster dieses Laufs, nicht seit Symbol-Inception --
  // fuer Trend-/Divergenz-Erkennung gedacht, nicht als absolute All-Time-Zahl.
  const cvdDelta = volumes.map((v: number, i: number) => 2 * takerBuy[i] - v);
  const cvdCumulative: number[] = [];
  let cumCvd = 0;
  for (const d of cvdDelta) {
    cumCvd += d;
    cvdCumulative.push(cumCvd);
  }
  const cvdTrend: ("rising" | "falling" | "flat")[] = cvdCumulative.map((_val, i) => {
    if (i < CVD_TREND_LOOKBACK) return "flat";
    const change = cvdCumulative[i] - cvdCumulative[i - CVD_TREND_LOOKBACK];
    const recentAvgAbsDelta =
      cvdDelta.slice(i - CVD_TREND_LOOKBACK + 1, i + 1).reduce((a: number, b: number) => a + Math.abs(b), 0) /
      CVD_TREND_LOOKBACK;
    const flatThreshold = recentAvgAbsDelta * 0.5;
    if (Math.abs(change) < flatThreshold) return "flat";
    return change > 0 ? "rising" : "falling";
  });

  // 4) OI (aggregiert, ueber die bereits fixierte RPC -- keine doppelte
  // OI-Logik) + Spot-Preis (fuer Basis) per Asof-Abgleich zuordnen.
  //
  // Bugfix 21.09.2026 (siehe Kommentar am Dateianfang): earliestIso deckt
  // jetzt NUR noch das tatsaechlich geschriebene WRITE_LOOKBACK-Fenster ab
  // (plus 1 Puffer-Kerze fuer oiDeltaPct der aeltesten Zeile, plus
  // toleranceMs als Sicherheitsmarge) statt des vollen geladenen
  // n-Kerzen-Fensters (bis zu 1000 Kerzen) -- vorher kippte die aggregierte
  // OI-Abfrage dadurch bei JEDEM Lauf in einen Postgres-Statement-Timeout.
  const toleranceMs = Math.max(intervalToMs(interval), 30 * 60 * 1000);
  const oiLookbackIdx = Math.max(0, startIdx - 1);
  const earliestIso = new Date(Date.parse(candles[oiLookbackIdx].open_time) - toleranceMs).toISOString();

  // Bugfix 21.09.2026 (Teil 2, gefunden per DEBUG-Instrumentierung): PostgREST
  // deckelt JEDE API-/RPC-Antwort dieses Projekts hart auf 1000 Zeilen,
  // unabhaengig von p_max_points -- get_market_series bekam bei p_max_points:
  // 3000 fuer 1H/4H/1D real >1000 Rohpunkte zurueck, PostgREST schnitt dann
  // auf die ERSTEN (= chronologisch AELTESTEN, wegen "order by ... asc" in
  // der Funktion) 1000 Zeilen zu, noch bevor die SQL-eigene Dezimierung
  // (garantiert rn=1 UND rn=total, siehe get_market_series-Definition) den
  // juengsten Punkt sichern konnte -- oiPoints hatte dadurch nie einen
  // Eintrag nahe "jetzt". p_max_points jetzt auf 900 (< 1000er-Deckel)
  // gesenkt: die Dezimierung laeuft dann VOR dem PostgREST-Cutoff und
  // garantiert weiterhin den juengsten Punkt.
  const { data: oiSeriesRaw, error: oiError } = await supabase.rpc("get_market_series", {
    p_exchange: "aggregated",
    p_since: earliestIso,
    p_max_points: 900,
  });
  if (oiError) console.error(`OI-Serie (${interval}):`, oiError.message);
  const oiPoints = (oiSeriesRaw ?? [])
    .filter((p: any) => p.open_interest !== null)
    .map((p: any) => ({ t: Date.parse(p.timestamp_utc), v: Number(p.open_interest) }));
  const lookupOi = buildAsofLookup(oiPoints);

  // Bugfix 21.09.2026 (Teil 3, dieselbe PostgREST-1000-Zeilen-Deckelung wie
  // bei der OI-Serie oben, hier aber ohne SQL-seitige Dezimierung -- eine
  // rohe .from().select(): spot_market_snapshots hat im relevanten Fenster
  // (z.B. 1H: ~11 Tage) deutlich mehr als 1000 Zeilen (verifiziert: 3122
  // Zeilen/11 Tage). Aufsteigend sortiert + hohes .limit() liess PostgREST
  // dieselben AELTESTEN 1000 Zeilen zurueckgeben, egal wie hoch das Limit
  // war -- spot_price/basis_pct blieben dadurch fuer die juengsten Kerzen
  // leer. Fix: absteigend sortieren (neueste zuerst) + auf 900 begrenzen
  // (< 1000er-Deckel), danach in JS zurueckdrehen -- garantiert die
  // juengsten Punkte statt der aeltesten.
  const { data: spotRowsDesc, error: spotError } = await supabase
    .from("spot_market_snapshots")
    .select("timestamp_utc,last_price")
    .gte("timestamp_utc", earliestIso)
    .order("timestamp_utc", { ascending: false })
    .limit(900);
  if (spotError) console.error(`Spot-Serie (${interval}):`, spotError.message);
  const spotRowsRaw = [...(spotRowsDesc ?? [])].reverse();
  const spotPoints = spotRowsRaw
    .filter((p: any) => p.last_price !== null)
    .map((p: any) => ({ t: Date.parse(p.timestamp_utc), v: Number(p.last_price) }));
  const lookupSpot = buildAsofLookup(spotPoints);

  const oiCurrentArr = closeTimesMs.map((t: number) => lookupOi(t, toleranceMs));
  const spotPriceArr = closeTimesMs.map((t: number) => lookupSpot(t, SPOT_TOLERANCE_MS));

  const oiDeltaPct = oiCurrentArr.map((cur: number | null, i: number) => {
    const prev = i > 0 ? oiCurrentArr[i - 1] : null;
    if (cur === null || prev === null || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  });
  // OI-Volumen-Verhaeltnis: welcher Anteil des Kerzen-Volumens (BTC) sich in
  // netto neuem Open Interest niedergeschlagen hat, statt reiner Churn zu
  // sein. Beide Groessen sind in BTC vergleichbar (aggregiertes OI in
  // Kontrakten/BTC, Binance-Kerzenvolumen in BTC).
  const oiVolumeRatio = oiCurrentArr.map((cur: number | null, i: number) => {
    const prev = i > 0 ? oiCurrentArr[i - 1] : null;
    if (cur === null || prev === null || volumes[i] === 0) return null;
    return Math.abs(cur - prev) / volumes[i];
  });
  const basisPct = spotPriceArr.map((spot: number | null, i: number) =>
    spot !== null && spot !== 0 ? ((closes[i] - spot) / spot) * 100 : null,
  );

  // 5) market_features-Zeilen fuer die juengsten WRITE_LOOKBACK Kerzen
  // schreiben. candle_count = Anzahl der im geladenen Fenster verfuegbaren
  // Kerzen bis inkl. dieser -- Basis fuer data_quality (EMA200 braucht 200
  // Kerzen Vorlauf, um wirklich eingeschwungen zu sein).
  const rows = [];
  for (let i = startIdx; i < n; i++) {
    const candleCount = i + 1;
    const dataQuality = candleCount >= 200 ? "OK" : candleCount >= 50 ? "PRELIMINARY" : "INSUFFICIENT";
    rows.push({
      symbol: SYMBOL,
      interval,
      candle_open_time: candles[i].open_time,
      close_price: closes[i],
      ema_20: ema20[i],
      ema_50: ema50[i],
      ema_100: ema100[i],
      ema_200: ema200[i],
      ema_800: ema800[i],
      rsi_14: rsi[i],
      macd_line: macdLine[i],
      macd_signal: macdSignal[i],
      macd_histogram: macdHist[i],
      atr_14: atr[i],
      adx_14: adx[i],
      plus_di: plusDi[i],
      minus_di: minusDi[i],
      vwap: vwap[i],
      range_high_20: rangeHigh[i],
      range_low_20: rangeLow[i],
      swing_type: structure.swingType[i],
      structure_trend: structure.structureTrend[i],
      bos: structure.bos[i],
      bos_direction: structure.bosDirection[i],
      choch: structure.choch[i],
      choch_direction: structure.chochDirection[i],
      cvd_delta: cvdDelta[i],
      cvd_cumulative: cvdCumulative[i],
      cvd_trend: cvdTrend[i],
      oi_current: oiCurrentArr[i],
      oi_delta_pct: oiDeltaPct[i],
      oi_volume_ratio: oiVolumeRatio[i],
      spot_price: spotPriceArr[i],
      basis_pct: basisPct[i],
      candle_count: candleCount,
      data_quality: dataQuality,
    });
  }

  const { error: featuresError } = await supabase
    .from("market_features")
    .upsert(rows, { onConflict: "symbol,interval,candle_open_time" });
  if (featuresError) throw new Error(`market_features upsert: ${featuresError.message}`);

  return {
    success: true,
    candlesFetched: closedKlines.length,
    candlesStored: candleRows.length,
    featuresWritten: rows.length,
  };
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results = await Promise.allSettled(INTERVALS.map((interval) => processInterval(supabase, interval)));

  const summary = results.map((r, idx) => {
    if (r.status === "fulfilled") return { interval: INTERVALS[idx], ...r.value };
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return { interval: INTERVALS[idx], success: false, error: message };
  });

  const overallSuccess = summary.some((s) => s.success);
  return new Response(JSON.stringify({ success: overallSuccess, results: summary }), {
    status: overallSuccess ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
