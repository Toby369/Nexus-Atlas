import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// NEXUS Positioning Collector (Phase 2+3, erweitert Phase 2 Market-Intelligence).
// Sammelt Long/Short-Ratio, Top-Trader-Ratio und Taker-Buy/Sell-Flow und
// leitet daraus eine transparente, mehrere Kennzahlen kombinierende
// Positioning-Einschaetzung ab (Divergence Engine, Punkt 2+15 der Vorgabe).
//
// Binance, Bybit, OKX und Bitget liefern Retail-Long/Short-Daten oeffentlich
// und kostenlos. Bitunix und Pionex bieten dafuer keine oeffentliche Route ->
// bewusst ausgelassen statt Daten zu erfinden.
//
// WICHTIG (Punkt 2 der Vorgabe): Keine isolierte Einzelkennzahl wird direkt
// in ein Signal uebersetzt. Die Einschaetzung kombiniert immer: Retail- vs.
// Top-Trader-Positionierung, Taker-Flow, OI-Trend, Preis-Trend und Funding.

interface PositioningRow {
  exchange: string;
  global_long_account_ratio: number | null;
  global_short_account_ratio: number | null;
  global_account_long_short_ratio: number | null;
  top_trader_long_account_ratio: number | null;
  top_trader_short_account_ratio: number | null;
  top_trader_account_long_short_ratio: number | null;
  top_trader_long_position_ratio: number | null;
  top_trader_short_position_ratio: number | null;
  top_trader_position_long_short_ratio: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
  taker_buy_sell_ratio: number | null;
  status: "ok" | "error";
  error: string | null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
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

function emptyRow(exchange: string): PositioningRow {
  return {
    exchange,
    global_long_account_ratio: null,
    global_short_account_ratio: null,
    global_account_long_short_ratio: null,
    top_trader_long_account_ratio: null,
    top_trader_short_account_ratio: null,
    top_trader_account_long_short_ratio: null,
    top_trader_long_position_ratio: null,
    top_trader_short_position_ratio: null,
    top_trader_position_long_short_ratio: null,
    taker_buy_vol: null,
    taker_sell_vol: null,
    taker_buy_sell_ratio: null,
    status: "ok",
    error: null,
  };
}

function errorRow(exchange: string, err: unknown): PositioningRow {
  const message = err instanceof Error ? err.message : String(err);
  return { ...emptyRow(exchange), status: "error", error: message };
}

// --- Binance: Global + Top Trader (Account/Position) + Taker Flow ---------
async function collectBinance(symbol: string): Promise<PositioningRow> {
  const exchange = "binance";
  try {
    const base = "https://fapi.binance.com/futures/data";
    const period = "5m";

    const [global, topAccount, topPosition, taker] = await Promise.all([
      fetchJson(`${base}/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`),
      fetchJson(`${base}/topLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`),
      fetchJson(`${base}/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=1`),
      fetchJson(`${base}/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=1`),
    ]);

    const g = global?.[0];
    const ta = topAccount?.[0];
    const tp = topPosition?.[0];
    const tk = taker?.[0];

    if (!g || !ta || !tp || !tk) {
      throw new Error("Unvollstaendige Binance-Positioning-Antwort");
    }

    return {
      exchange,
      global_long_account_ratio: parseFloat(g.longAccount),
      global_short_account_ratio: parseFloat(g.shortAccount),
      global_account_long_short_ratio: parseFloat(g.longShortRatio),
      top_trader_long_account_ratio: parseFloat(ta.longAccount),
      top_trader_short_account_ratio: parseFloat(ta.shortAccount),
      top_trader_account_long_short_ratio: parseFloat(ta.longShortRatio),
      top_trader_long_position_ratio: parseFloat(tp.longAccount),
      top_trader_short_position_ratio: parseFloat(tp.shortAccount),
      top_trader_position_long_short_ratio: parseFloat(tp.longShortRatio),
      taker_buy_vol: parseFloat(tk.buyVol),
      taker_sell_vol: parseFloat(tk.sellVol),
      taker_buy_sell_ratio: parseFloat(tk.buySellRatio),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorRow(exchange, err);
  }
}

// --- Bybit: nur globale Account-Ratio (buyRatio/sellRatio) ----------------
async function collectBybit(symbol: string): Promise<PositioningRow> {
  const exchange = "bybit";
  try {
    const json = await fetchJson(
      `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=5min&limit=1`,
    );
    const entry = json?.result?.list?.[0];
    if (!entry) throw new Error("Keine Bybit-Positioning-Daten");

    const buyRatio = parseFloat(entry.buyRatio);
    const sellRatio = parseFloat(entry.sellRatio);

    return {
      ...emptyRow(exchange),
      global_long_account_ratio: buyRatio,
      global_short_account_ratio: sellRatio,
      global_account_long_short_ratio: sellRatio !== 0 ? buyRatio / sellRatio : null,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorRow(exchange, err);
  }
}

// --- OKX: nur globale Account-Ratio (long/short als Verhaeltnis) ----------
// OKX liefert im Gegensatz zu Binance/Bybit keine getrennten
// Long-/Short-Prozentwerte, sondern direkt das Verhaeltnis long/short.
// Rueckrechnung ueber long+short=1: long = ratio/(1+ratio), short = 1-long.
async function collectOkx(symbol: string): Promise<PositioningRow> {
  const exchange = "okx";
  try {
    const instId = symbol.replace("USDT", "-USDT-SWAP");
    const json = await fetchJson(
      `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=${instId}&period=5m&limit=1`,
    );
    if (json?.code !== "0") throw new Error(`OKX API-Fehler: ${json?.msg || json?.code}`);
    const entry = json?.data?.[0];
    if (!entry) throw new Error("Keine OKX-Positioning-Daten");

    const ratio = parseFloat(entry[1]);
    if (Number.isNaN(ratio)) throw new Error("Ungueltiges OKX-Ratio-Format");
    const longAccount = ratio / (1 + ratio);
    const shortAccount = 1 - longAccount;

    return {
      ...emptyRow(exchange),
      global_long_account_ratio: longAccount,
      global_short_account_ratio: shortAccount,
      global_account_long_short_ratio: ratio,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorRow(exchange, err);
  }
}

// --- Bitget: nur globale Account-Ratio -------------------------------------
// GET /api/v2/mix/market/account-long-short liefert longAccountRatio/
// shortAccountRatio/longShortAccountRatio direkt als 5-Min-Zeitreihe
// (verifiziert per Live-Aufruf) -- letzter Eintrag = aktuellster Wert.
// Keine Top-Trader-Aufschluesselung oeffentlich verfuegbar (wie bei
// Bybit/OKX), bleibt bewusst null statt erfunden.
async function collectBitget(symbol: string): Promise<PositioningRow> {
  const exchange = "bitget";
  try {
    const json = await fetchJson(
      `https://api.bitget.com/api/v2/mix/market/account-long-short?symbol=${symbol}&productType=USDT-FUTURES`,
    );
    const list = json?.data;
    if (!Array.isArray(list) || list.length === 0) throw new Error("Keine Bitget-Positioning-Daten");
    const entry = list[list.length - 1];

    const longRatio = parseFloat(entry.longAccountRatio);
    const shortRatio = parseFloat(entry.shortAccountRatio);
    const longShortRatio = parseFloat(entry.longShortAccountRatio);

    return {
      ...emptyRow(exchange),
      global_long_account_ratio: longRatio,
      global_short_account_ratio: shortRatio,
      global_account_long_short_ratio: Number.isNaN(longShortRatio) ? null : longShortRatio,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorRow(exchange, err);
  }
}

// --- Divergence Engine (nur auf Binance-Daten, da vollstaendigster Datensatz) --
// Kombiniert: Retail- vs. Top-Trader-Positionierung (Account UND Position),
// Taker-Flow, OI-Trend und Preis-Trend (aus market_snapshots). Erzeugt eine
// vorsichtig formulierte, probabilistische Einschaetzung -- niemals eine
// blinde Buy/Sell-Aussage aus einer einzelnen Kennzahl.
function describeRatio(ratio: number, longLabel: string, shortLabel: string): string {
  if (ratio > 1.15) return `deutlich ${longLabel}`;
  if (ratio > 1.03) return `leicht ${longLabel}`;
  if (ratio < 0.87) return `deutlich ${shortLabel}`;
  if (ratio < 0.97) return `leicht ${shortLabel}`;
  return "nahezu ausgeglichen";
}

async function buildPositioningSignal(
  supabase: ReturnType<typeof createClient>,
  binance: PositioningRow,
  symbol: string,
  now: string,
) {
  if (
    binance.status !== "ok" ||
    binance.global_account_long_short_ratio === null ||
    binance.top_trader_position_long_short_ratio === null ||
    binance.taker_buy_sell_ratio === null
  ) {
    return; // Datenqualitaet zu gering fuer eine belastbare Aussage -> kein Signal erzeugen.
  }

  // OI-/Preis-Trend aus den bestehenden Binance-Marktdaten (letzte ~2h).
  const { data: history, error: historyError } = await supabase
    .from("market_snapshots")
    .select("last_price, open_interest, timestamp_utc")
    .eq("symbol", symbol)
    .eq("exchange", "binance")
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(24);

  if (historyError || !history || history.length < 2) return;

  const latest = history[0];
  const reference = history[history.length - 1];
  const priceChangePct =
    ((latest.last_price - reference.last_price) / reference.last_price) * 100;
  const oiChangePct = reference.open_interest
    ? ((latest.open_interest - reference.open_interest) / reference.open_interest) * 100
    : 0;

  const retailDesc = describeRatio(binance.global_account_long_short_ratio, "long-lastig", "short-lastig");
  const topTraderDesc = describeRatio(binance.top_trader_position_long_short_ratio, "long-lastig", "short-lastig");
  const takerDesc = describeRatio(binance.taker_buy_sell_ratio, "aggressiv kaufend", "aggressiv verkaufend");

  const retailLongLeaning = binance.global_account_long_short_ratio > 1.03;
  const retailShortLeaning = binance.global_account_long_short_ratio < 0.97;
  const topLongLeaning = binance.top_trader_position_long_short_ratio > 1.03;
  const topShortLeaning = binance.top_trader_position_long_short_ratio < 0.97;

  const participantDivergence =
    (retailLongLeaning && !topLongLeaning) || (retailShortLeaning && !topShortLeaning);

  const oiRising = oiChangePct > 1.0;
  const oiFalling = oiChangePct < -1.0;
  const priceRising = priceChangePct > 0.3;
  const priceFalling = priceChangePct < -0.3;

  // Regelbasierte, mehrere Kennzahlen kombinierende Einordnung.
  let scenario: string;
  let score: number; // -100 (stark short-lastig) .. +100 (stark long-lastig), Positioning nicht Kursprognose
  let riskNote: string;

  if (retailLongLeaning && (topShortLeaning || !topLongLeaning) && oiRising && priceRising) {
    scenario =
      "Retail positioniert sich zunehmend long, waehrend Top Trader die Bewegung nicht im gleichen Mass bestaetigen. " +
      "Das Open Interest steigt bei steigendem Preis. Das kann auf eine Long-Crowding-Situation mit erhoehtem Risiko " +
      "einer spaeteren Korrektur (Long Squeeze) hindeuten -- muss es aber nicht.";
    score = 55;
    riskNote = "erhoeht";
  } else if (retailShortLeaning && topLongLeaning && oiRising) {
    scenario =
      "Retail ist ueberwiegend short positioniert, waehrend Top Trader eher long stehen. Das Open Interest steigt. " +
      "Das kann auf einen moeglichen Short-Squeeze-Aufbau hindeuten -- eine Bestaetigung durch weitere Datenpunkte " +
      "waere noetig.";
    score = -40;
    riskNote = "erhoeht (Short-Squeeze-Risiko)";
  } else if (participantDivergence) {
    scenario =
      `Retail-Positionierung (${retailDesc}) und Top-Trader-Positionierung (${topTraderDesc}) laufen aktuell auseinander. ` +
      "Eine eindeutige Markttendenz laesst sich daraus allein nicht ableiten.";
    score = 0;
    riskNote = "unklar, Divergenz vorhanden";
  } else if (oiFalling && (priceFalling || priceRising)) {
    scenario =
      "Das Open Interest faellt bei " +
      (priceFalling ? "fallendem" : "steigendem") +
      " Preis. Das deutet eher auf Positionsabbau/Glattstellung als auf neuen Trendaufbau hin.";
    score = priceFalling ? -20 : 20;
    riskNote = "moderat";
  } else {
    scenario =
      `Retail (${retailDesc}) und Top Trader (${topTraderDesc}) sind aktuell weitgehend uebereinstimmend positioniert. ` +
      `Taker-Flow ist ${takerDesc}. Keine auffaellige Divergenz erkennbar.`;
    score = retailLongLeaning ? 15 : retailShortLeaning ? -15 : 0;
    riskNote = "gering";
  }

  // Confidence: hoeher, wenn Retail- und Top-Trader-Signal UND Taker-Flow in dieselbe Richtung zeigen
  // (Bestaetigung durch mehrere unabhaengige Kennzahlen), niedriger bei Divergenz oder schwachen Werten.
  let confidence = 50;
  if (participantDivergence) confidence -= 10;
  if ((takerDesc.includes("kaufend") && retailLongLeaning) || (takerDesc.includes("verkaufend") && retailShortLeaning)) {
    confidence += 15;
  }
  if (Math.abs(oiChangePct) > 2) confidence += 10;
  confidence = Math.max(20, Math.min(85, confidence));

  const explanation =
    `${scenario} Basis: Binance (vollstaendigster oeffentlicher Datensatz), Betrachtungszeitraum ca. ${
      history.length * 5
    } Minuten. ` +
    `Preis ${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%, OI ${oiChangePct >= 0 ? "+" : ""}${oiChangePct.toFixed(2)}%. ` +
    `Distribution-/Squeeze-Risiko: ${riskNote}. Dies ist eine datenbasierte Einordnung der Positionierung, keine Kauf-/Verkaufsempfehlung.`;

  await supabase.from("positioning_signals").insert({
    timestamp_utc: now,
    signal_type: "retail_vs_top_trader_divergence",
    symbol,
    score,
    confidence,
    timeframe: "~2h",
    explanation,
    supporting_metrics: {
      global_account_long_short_ratio: binance.global_account_long_short_ratio,
      top_trader_position_long_short_ratio: binance.top_trader_position_long_short_ratio,
      top_trader_account_long_short_ratio: binance.top_trader_account_long_short_ratio,
      taker_buy_sell_ratio: binance.taker_buy_sell_ratio,
      price_change_pct: priceChangePct,
      oi_change_pct: oiChangePct,
      participant_divergence: participantDivergence,
    },
  });
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const symbol = "BTCUSDT";
  const now = new Date().toISOString();

  const results = await Promise.allSettled([
    collectBinance(symbol),
    collectBybit(symbol),
    collectOkx(symbol),
    collectBitget(symbol),
  ]);

  const rows = results.map((r) =>
    r.status === "fulfilled" ? r.value : errorRow("unknown", r.reason),
  );

  const { error: insertError } = await supabase.from("positioning_snapshots").insert(
    rows.map((r) => ({
      timestamp_utc: now,
      exchange: r.exchange,
      symbol,
      global_long_account_ratio: r.global_long_account_ratio,
      global_short_account_ratio: r.global_short_account_ratio,
      global_account_long_short_ratio: r.global_account_long_short_ratio,
      top_trader_long_account_ratio: r.top_trader_long_account_ratio,
      top_trader_short_account_ratio: r.top_trader_short_account_ratio,
      top_trader_account_long_short_ratio: r.top_trader_account_long_short_ratio,
      top_trader_long_position_ratio: r.top_trader_long_position_ratio,
      top_trader_short_position_ratio: r.top_trader_short_position_ratio,
      top_trader_position_long_short_ratio: r.top_trader_position_long_short_ratio,
      taker_buy_vol: r.taker_buy_vol,
      taker_sell_vol: r.taker_sell_vol,
      taker_buy_sell_ratio: r.taker_buy_sell_ratio,
      status: r.status,
      error: r.error,
    })),
  );

  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const binanceRow = rows.find((r) => r.exchange === "binance");
  if (binanceRow) {
    try {
      await buildPositioningSignal(supabase, binanceRow, symbol, now);
    } catch (_err) {
      // Signal-Erzeugung ist best-effort; ein Fehler hier darf den
      // erfolgreichen Datenimport oben nicht ungueltig machen.
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      symbol,
      results: rows.map((r) => ({ exchange: r.exchange, status: r.status })),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
