import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Einmalig aufgerufene Backfill-Function (kein Cron) -- Nutzer-Wunsch:
// "evaluieren ob und welche Optionen wir haben, Nexus viel weiter in der
// Vergangenheit testen zu lassen", dann "ja, Option A umsetzen" (kostenlos
// nachrueckbare Faktoren). Holt historische Binance-Futures-Klines nach
// und berechnet daraus ALLE market_features-Zeilen neu (nicht nur die
// juengsten WRITE_LOOKBACK wie collect-candles im Live-Betrieb) --
// identische Indikator-Mathematik wie collect-candles/index.ts, hier 1:1
// kopiert statt geteilt (Supabase Edge Functions haben keinen gemeinsamen
// Code-Import zwischen Functions in diesem Projekt-Setup).
//
// Bewusst NUR die Faktoren, die sich rein aus Preis/Volumen ableiten lassen
// (structure, momentum, trend_strength, trend_regime, vwap_position, cvd) --
// oi_current/oi_delta_pct/oi_volume_ratio/spot_price/basis_pct bleiben fuer
// den rueckwirkenden Zeitraum bewusst NULL: dafuer gibt es keine kostenlose
// historische Quelle (aggregiertes OI/Spot-Snapshots existieren nur ab dem
// Start der jeweiligen Live-Collectoren) -- "keine Daten" statt eines
// erfundenen Werts, gleiche Philosophie wie ueberall sonst im Projekt.
//
// 2026-09-04: "15m" ergaenzt (Kerzenmuster-Backtest auf 15m/1h/4h) --
// Binance akzeptiert "15m" als Kline-Interval-String genauso wie
// "1h"/"4h"/"1d". Zusaetzlich computeRangeStart/computeRangeEnd ergaenzt:
// bei 70k+ Kerzen (15m ueber 2 Jahre) sprengt die Verarbeitung der
// KOMPLETTEN Historie in einem Aufruf die Edge-Function-Ressourcen
// (WORKER_RESOURCE_LIMIT, reproduzierbar auch mit skipKlines:true --
// also nicht der Kline-Fetch, sondern die Indikator-Berechnung+market_
// features-Schreibphase ueber alle Zeilen ist der Engpass). Mit den
// beiden neuen Params wird nur ein Zeitfenster gelesen (plus LOOKBACK_
// CANDLES Vorlauf fuer EMA200/ADX-Einschwingung) und nur dieses Fenster
// nach market_features geschrieben -- mehrere Aufrufe decken dann die
// gesamte Historie ab (identisches Chunking-Prinzip wie die 1H-backtest_
// states-Rekonstruktion einer frueheren Session-Phase). Ohne die beiden
// Params bleibt das Verhalten unveraendert (volle Historie, ein Aufruf --
// weiterhin die Betriebsart fuer 1h/4h/1d, die das bereits schafft).
//
// 2026-09-11: "1m" ergaenzt (Swing-Setup-Trailing-Backtest, siehe
// docs/research/SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md) -- Ziel ist
// dort NICHT ein neues Indikator-Set, sondern der reale Kreuzungspreis fuer
// die bereits dokumentierte SL-Slippage-Frage (15m-Kerzentief ist nur eine
// Naeherung). "1m" ist daher bewusst NUR fuer candles zugelassen, NICHT
// fuer market_features: market_features_interval_check erlaubt weiterhin
// nur 15m/1h/4h/1d (unveraendert), und die Indikator-Berechnung wuerde bei
// 1m-Dichte (~15x mehr Zeilen als 15m) unnoetigen Rechen-/Speicheraufwand
// fuer ein Feature-Set erzeugen, das aktuell nirgends im Projekt angefragt
// ist -- "kein Feature ohne Verwendung", gleiche Zurueckhaltung wie bei den
// bewusst NULL gelassenen OI/Spot-Feldern oben.
//
// 2026-09-12: computeAtr() ergaenzt (Gesamteinschaetzung-Score-Protokoll,
// siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md
// Abschnitt 1+8 Schritt 0) -- atr_14 wurde in collect-candles/index.ts
// bereits frueher ergaenzt, aber nie in diese Backfill-Kopie uebertragen
// (schrieb bislang hart "atr_14: null"). Ohne historischen ATR14 waere die
// ATR-skalierte Zielgroesse des neuen Protokolls nur auf den letzten paar
// Tagen Live-Daten kalibrierbar statt auf der vollen 4-Jahres-Historie.
// Identische Formel wie collect-candles (Wilder-Glaettung, Periode 14).
//
// 2026-09-20: "5m" ergaenzt (Toby-Setup-Phasen-Signal-Projekt,
// research-python/toby_setup/ -- Nutzer trad teilweise auf 5m-Basis, die
// bestehende 15m-Setup-Historie allein bildet das nicht ab). "5m" existierte
// bereits als Live-Collector-Intervall in `candles` (Daten ab 2026-09-04
// vorhanden), aber diese Backfill-Function kannte es nicht -- die
// rueckwirkende Historie vor dem Live-Collector-Start fehlte. Analog zu
// "1m" bewusst NUR fuer candles, NICHT fuer market_features (gleicher
// Grund: market_features_interval_check erlaubt nur 15m/1h/4h/1d, und kein
// Feature-Bedarf fuer 5m ausserhalb des reinen OHLCV+Volume, das
// research-python sich selbst berechnet).

const SYMBOL = "BTCUSDT";
const FETCH_LIMIT = 1500; // Binance-Maximum pro Kline-Request
const KLINE_STAGGER_MS = 250;

const SWING_LOOKBACK = 5;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const CVD_TREND_LOOKBACK = 5;
const RANGE_LOOKBACK = 20;
const VWAP_LOOKBACK = 20;

// Vorlauf-Kerzen vor computeRangeStart, damit EMA200/ADX14 beim Eintritt
// ins Schreibfenster bereits eingeschwungen sind. exp(-2*2500/(200+1)) ist
// numerisch nicht mehr von "seit Genesis berechnet" unterscheidbar (EMA200
// braucht laut data_quality-Konvention nur 200 Kerzen fuer "OK").
const LOOKBACK_CANDLES = 2500;

function intervalToMs(interval: string): number {
  switch (interval) {
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
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

// --- Indikator-Bausteine (1:1 aus collect-candles/index.ts) ----------------

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
    if (rawSwingHigh[i]) {
      if (lastSwingHighPrice !== null) swingType[i] = highs[i] > lastSwingHighPrice ? "HH" : "LH";
      lastSwingHighPrice = highs[i];
    } else if (rawSwingLow[i]) {
      if (lastSwingLowPrice !== null) swingType[i] = lows[i] > lastSwingLowPrice ? "HL" : "LL";
      lastSwingLowPrice = lows[i];
    }
    if (swingType[i] === "HH" || swingType[i] === "HL") trend = "bullish";
    else if (swingType[i] === "LH" || swingType[i] === "LL") trend = "bearish";
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

interface BackfillBody {
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  startTime: number; // ms epoch
  endTime?: number; // ms epoch, default now
  skipKlines?: boolean; // true = nur market_features aus vorhandenen candles neu berechnen
  computeRangeStart?: number; // ms epoch -- nur dieses Fenster (+ Lookback) lesen/schreiben
  computeRangeEnd?: number; // ms epoch, exklusiv
}

Deno.serve(async (req: Request) => {
  let body: BackfillBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Ungueltiges JSON im Body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!["1m", "5m", "15m", "1h", "4h", "1d"].includes(body.interval)) {
    return new Response(JSON.stringify({ success: false, error: "interval muss 1m/5m/15m/1h/4h/1d sein." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const interval = body.interval;
  const nowMs = Date.now();
  const endTime = body.endTime ?? nowMs;
  let candlesUpserted = 0;
  let requests = 0;
  let cursor = body.startTime ?? 0;
  let candlesFetched = 0;

  if (!body.skipKlines) {
    // 1) Historische Klines paginiert holen (Binance-Limit 1500/Request).
    const candleRows: any[] = [];
    const MAX_REQUESTS = 60; // Sicherheitsdeckel gegen Endlosschleifen

    while (cursor < endTime && requests < MAX_REQUESTS) {
      requests++;
      const raw = await fetchJson(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=${FETCH_LIMIT}`,
      );
      if (!Array.isArray(raw) || raw.length === 0) break;

      const closed = raw.filter((k: any[]) => k[6] < nowMs);
      for (const k of closed) {
        candleRows.push({
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
        });
      }

      const lastCloseMs = raw[raw.length - 1][6];
      if (raw.length < FETCH_LIMIT || lastCloseMs + 1 <= cursor) break;
      cursor = lastCloseMs + 1;
      await sleep(KLINE_STAGGER_MS);
    }

    candlesFetched = candleRows.length;
    const UPSERT_CHUNK = 1000;
    for (let i = 0; i < candleRows.length; i += UPSERT_CHUNK) {
      const chunk = candleRows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("candles")
        .upsert(chunk, { onConflict: "exchange,symbol,interval,open_time", ignoreDuplicates: true });
      if (error) {
        return new Response(JSON.stringify({ success: false, error: `candles upsert: ${error.message}`, candlesUpserted }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      candlesUpserted += chunk.length;
    }
  }

  // 1m/5m-Kerzen bewusst OHNE market_features-Berechnung zurueckgeben (siehe
  // Kommentare oben, 2026-09-11 bzw. 2026-09-20): reine Rohdaten, kein
  // Indikator-Set fuer 1m/5m ist irgendwo im Projekt angefragt, und
  // market_features_interval_check erlaubt ohnehin nur 15m/1h/4h/1d.
  if (interval === "1m" || interval === "5m") {
    return new Response(
      JSON.stringify({
        success: true,
        interval,
        klineRequests: requests,
        candlesFetched,
        candlesUpserted,
        featuresWritten: 0,
        reachedEnd: cursor >= endTime,
        nextCursor: cursor,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // 2) market_features neu berechnen. Ohne computeRangeStart/End: GESAMTE
  // gespeicherte Historie dieses Intervalls (bisheriges Verhalten, fuer
  // 1h/4h/1d weiterhin ausreichend). Mit computeRangeStart/End: nur ein
  // Zeitfenster + LOOKBACK_CANDLES Vorlauf lesen/schreiben (fuer sehr
  // grosse Historien wie 15m, siehe Kommentar oben).
  // WICHTIG: PostgREST deckelt .limit() serverseitig auf die konfigurierte
  // max-rows-Grenze (hier beobachtet: 1000), unabhaengig vom angeforderten
  // Wert -- daher explizite Seiten-Pagination per .range() statt eines
  // einzelnen grossen .limit()-Aufrufs.
  const readStartIso =
    body.computeRangeStart !== undefined
      ? new Date(body.computeRangeStart - LOOKBACK_CANDLES * intervalToMs(interval)).toISOString()
      : null;
  const readEndIso = body.computeRangeEnd !== undefined ? new Date(body.computeRangeEnd).toISOString() : null;

  const candles: any[] = [];
  const PAGE_SIZE = 1000;
  for (let page = 0; ; page++) {
    let q = supabase
      .from("candles")
      .select(
        "open_time,close_time,open,high,low,close,volume,quote_volume,taker_buy_base_vol,taker_buy_quote_vol,trade_count",
      )
      .eq("exchange", "binance")
      .eq("symbol", SYMBOL)
      .eq("interval", interval);
    if (readStartIso) q = q.gte("open_time", readStartIso);
    if (readEndIso) q = q.lt("open_time", readEndIso);
    const { data: pageRows, error: readError } = await q
      .order("open_time", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (readError) {
      return new Response(JSON.stringify({ success: false, error: `candles read: ${readError.message}`, candlesUpserted }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!pageRows || pageRows.length === 0) break;
    candles.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }

  const n = candles.length;
  if (n < RSI_PERIOD + 1) {
    return new Response(
      JSON.stringify({ success: true, candlesUpserted, totalCandlesInDb: n, featuresWritten: 0, note: "Zu wenig Historie fuer Indikatoren" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const highs = candles.map((c: any) => Number(c.high));
  const lows = candles.map((c: any) => Number(c.low));
  const closes = candles.map((c: any) => Number(c.close));
  const volumes = candles.map((c: any) => Number(c.volume));
  const takerBuy = candles.map((c: any) => Number(c.taker_buy_base_vol ?? 0));

  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
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

  const writeStartMs = body.computeRangeStart ?? -Infinity;
  const writeEndMs = body.computeRangeEnd ?? Infinity;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const openMs = Date.parse(candles[i].open_time);
    if (openMs < writeStartMs || openMs >= writeEndMs) continue;
    const candleCount = i + 1;
    const dataQuality = candleCount >= 200 ? "OK" : candleCount >= 50 ? "PRELIMINARY" : "INSUFFICIENT";
    rows.push({
      symbol: SYMBOL,
      interval,
      candle_open_time: candles[i].open_time,
      close_price: closes[i],
      ema_20: ema20[i],
      ema_50: ema50[i],
      ema_200: ema200[i],
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
      oi_current: null,
      oi_delta_pct: null,
      oi_volume_ratio: null,
      spot_price: null,
      basis_pct: null,
      candle_count: candleCount,
      data_quality: dataQuality,
    });
  }

  const FEATURE_CHUNK = 500;
  let featuresWritten = 0;
  for (let i = 0; i < rows.length; i += FEATURE_CHUNK) {
    const chunk = rows.slice(i, i + FEATURE_CHUNK);
    const { error } = await supabase.from("market_features").upsert(chunk, { onConflict: "symbol,interval,candle_open_time" });
    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: `market_features upsert: ${error.message}`, candlesUpserted, featuresWritten }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    featuresWritten += chunk.length;
  }

  return new Response(
    JSON.stringify({
      success: true,
      interval,
      klineRequests: requests,
      candlesFetched,
      candlesUpserted,
      candlesRead: n,
      featuresWritten,
      reachedEnd: cursor >= endTime,
      nextCursor: cursor,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
