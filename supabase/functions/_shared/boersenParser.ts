// Auslesen der Boersen-Antworten fuer collect-btc und collect-positioning.
//
// Reines Modul: kein Netz, kein Deno, keine Datenbank -- damit es Vitest im
// Next.js-Repo gegen gespeicherte echte Antworten pruefen kann
// (lib/boersenVertrag.test.ts, Fixtures in supabase/functions/_fixtures/,
// Auffrischen: tools/fixtures-auffrischen/README.md).
//
// Warum (docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md, Punkt C):
// parseFloat(undefined) ist NaN, und Postgres nimmt 'NaN' in einer
// numeric-Spalte klaglos an. Benennt eine Boerse ein Feld um, schrieb der
// Sammler bisher still Zeilen mit status "ok" und falschen Zahlen. Jetzt
// wirft ein fehlendes Pflichtfeld einen Fehler mit Feldnamen -- die Zeile
// bekommt status "error", und die Datenstand-Ampel zeigt die Boerse als
// ausgefallen (get_data_freshness zaehlt nur status "ok").

/** Zahl aus einem Boersen-Feld (meist ein String); Pflicht. */
export function pflichtZahl(obj: unknown, feld: string, quelle: string): number {
  const roh = (obj as Record<string, unknown> | null | undefined)?.[feld];
  const n = typeof roh === "number" ? roh : typeof roh === "string" && roh !== "" ? Number(roh) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`${quelle}: Feld "${feld}" fehlt oder ist keine Zahl (war ${JSON.stringify(roh)})`);
  }
  return n;
}

/** Zahl, die fehlen darf (leer, null, fehlend -> null). */
export function kannZahl(obj: unknown, feld: string): number | null {
  const roh = (obj as Record<string, unknown> | null | undefined)?.[feld];
  const n = typeof roh === "number" ? roh : typeof roh === "string" && roh !== "" ? Number(roh) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function toIsoOrNull(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  const n = typeof ms === "string" ? parseInt(ms) : ms;
  if (!n || Number.isNaN(n)) return null;
  return new Date(n).toISOString();
}

// ── Marktdaten (collect-btc) ───────────────────────────────────────────────

export interface MarktWerte {
  last_price: number | null;
  mark_price: number | null;
  index_price: number | null;
  open_interest: number | null;
  open_interest_usd: number | null;
  funding_rate: number | null;
  next_funding_time_utc: string | null;
}

// deno-lint-ignore no-explicit-any
type Json = any;

export function parseBybitTicker(json: Json): MarktWerte {
  const t = json?.result?.list?.[0];
  if (!t) throw new Error("Keine Ticker-Daten in der Bybit-Antwort");
  const last = pflichtZahl(t, "lastPrice", "Bybit");
  const oi = pflichtZahl(t, "openInterest", "Bybit");
  return {
    last_price: last,
    mark_price: pflichtZahl(t, "markPrice", "Bybit"),
    index_price: pflichtZahl(t, "indexPrice", "Bybit"),
    open_interest: oi,
    open_interest_usd: oi * last,
    funding_rate: pflichtZahl(t, "fundingRate", "Bybit"),
    next_funding_time_utc: toIsoOrNull(t.nextFundingTime),
  };
}

// USDT-M Futures: premiumIndex (Mark/Index/Funding) + openInterest + ticker/price (Last)
export function parseBinanceMarkt(premium: Json, oiJson: Json, price: Json): MarktWerte {
  const last = pflichtZahl(price, "price", "Binance ticker/price");
  const oi = pflichtZahl(oiJson, "openInterest", "Binance openInterest");
  return {
    last_price: last,
    mark_price: pflichtZahl(premium, "markPrice", "Binance premiumIndex"),
    index_price: pflichtZahl(premium, "indexPrice", "Binance premiumIndex"),
    open_interest: oi,
    open_interest_usd: oi * last,
    funding_rate: pflichtZahl(premium, "lastFundingRate", "Binance premiumIndex"),
    next_funding_time_utc: toIsoOrNull(premium?.nextFundingTime),
  };
}

// Keine oeffentliche Open-Interest-Route -> open_interest bleibt null.
//
// WICHTIG (per Live-Vergleich verifiziert, siehe get_funding_intelligence-
// Audit): Bitunix liefert fundingRate NICHT als Dezimalbruch wie alle
// anderen Boersen (z.B. 0.0001 = 0.01%), sondern bereits als Prozentzahl
// (0.008687 = 0.008687%). Beleg: Bitunix' eigene maxFundingRate/
// minFundingRate-Grenzen liegen bei +/-0.3 -- als Dezimalbruch waere das
// ein absurdes +/-30%-Funding-Limit, als Prozentzahl ein plausibles
// +/-0.3%-Limit. Die Division normalisiert auf dieselbe Dezimalbruch-Skala.
// Nochmals bestaetigt 29.10.2026: Bitunix 0.007013 gegen Binance 0.00007008.
//
// indexPrice liefert Bitunix inzwischen mit (Fixture 29.10.2026); fehlt er,
// bleibt er null.
export function parseBitunixFunding(json: Json, symbol: string): MarktWerte {
  // deno-lint-ignore no-explicit-any
  const e = (json?.data ?? []).find((d: any) => d?.symbol === symbol);
  if (!e) throw new Error(`Kein Bitunix-Eintrag fuer ${symbol}`);
  return {
    last_price: pflichtZahl(e, "lastPrice", "Bitunix"),
    mark_price: pflichtZahl(e, "markPrice", "Bitunix"),
    index_price: kannZahl(e, "indexPrice"),
    open_interest: null,
    open_interest_usd: null,
    funding_rate: pflichtZahl(e, "fundingRate", "Bitunix") / 100,
    next_funding_time_utc: toIsoOrNull(e.nextFundingTime),
  };
}

export function parsePionexMarkt(indexJson: Json, oiJson: Json, tickerJson: Json, symbol: string): MarktWerte {
  const idx = indexJson?.data?.indexes?.[0];
  if (!idx) throw new Error(`Keine Pionex-Indexdaten fuer ${symbol}`);
  // deno-lint-ignore no-explicit-any
  const oiEntry = (oiJson?.data?.openInterests ?? []).find((d: any) => d?.symbol === symbol);
  const ticker = tickerJson?.data?.tickers?.[0];
  const mark = pflichtZahl(idx, "markPrice", "Pionex indexes");
  const last = ticker ? pflichtZahl(ticker, "close", "Pionex tickers") : mark;
  const oi = oiEntry ? pflichtZahl(oiEntry, "openInterest", "Pionex openInterests") : null;
  return {
    last_price: last,
    mark_price: mark,
    index_price: pflichtZahl(idx, "indexPrice", "Pionex indexes"),
    open_interest: oi,
    open_interest_usd: oi !== null ? oi * last : null,
    funding_rate: pflichtZahl(idx, "nextFundingRate", "Pionex indexes"),
    next_funding_time_utc: toIsoOrNull(idx.nextFundingTime),
  };
}

// OI kommt direkt in BTC (oiCcy) und USD (oiUsd). Index-Preis braeuchte eine
// eigene Route (BTC-USDT statt BTC-USDT-SWAP) und bleibt null.
//
// Funding-Zeitpunkt: OKX v5 nennt die NAECHSTE Abrechnung "fundingTime";
// "nextFundingTime" ist die danach (Fixture 29.10.2026: fundingTime =
// 16:00 UTC wie bei Bybit/Binance, nextFundingTime = 00:00 UTC). Bis
// 29.10.2026 wurde nextFundingTime gespeichert, also 8 Std zu spaet.
export function parseOkxMarkt(ticker: Json, oiJson: Json, funding: Json, markJson: Json): MarktWerte {
  const t = ticker?.data?.[0];
  const oi = oiJson?.data?.[0];
  const f = funding?.data?.[0];
  const m = markJson?.data?.[0];
  if (!t || !oi || !f) throw new Error("Unvollstaendige OKX-Antwort");
  return {
    last_price: pflichtZahl(t, "last", "OKX ticker"),
    mark_price: m ? pflichtZahl(m, "markPx", "OKX mark-price") : null,
    index_price: null,
    open_interest: pflichtZahl(oi, "oiCcy", "OKX open-interest"),
    open_interest_usd: pflichtZahl(oi, "oiUsd", "OKX open-interest"),
    funding_rate: pflichtZahl(f, "fundingRate", "OKX funding-rate"),
    next_funding_time_utc: toIsoOrNull(f.fundingTime ?? f.nextFundingTime),
  };
}

// Ein Ticker liefert Preis/Mark/Index/Funding/OI (holdingAmount, in BTC).
// Kein naechster Funding-Zeitpunkt im Ticker -> null.
export function parseBitgetTicker(json: Json, symbol: string): MarktWerte {
  const e = json?.data?.[0];
  if (!e) throw new Error(`Kein Bitget-Eintrag fuer ${symbol}`);
  const last = pflichtZahl(e, "lastPr", "Bitget");
  const oi = pflichtZahl(e, "holdingAmount", "Bitget");
  return {
    last_price: last,
    mark_price: pflichtZahl(e, "markPrice", "Bitget"),
    index_price: pflichtZahl(e, "indexPrice", "Bitget"),
    open_interest: oi,
    open_interest_usd: oi * last,
    funding_rate: pflichtZahl(e, "fundingRate", "Bitget"),
    next_funding_time_utc: null,
  };
}

// ── Positionierung (collect-positioning) ───────────────────────────────────

export interface PositionierungWerte {
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
}

export const LEERE_POSITIONIERUNG: PositionierungWerte = {
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
};

export function parseBinancePositionierung(
  global: Json,
  topAccount: Json,
  topPosition: Json,
  taker: Json,
): PositionierungWerte {
  const g = global?.[0];
  const ta = topAccount?.[0];
  const tp = topPosition?.[0];
  const tk = taker?.[0];
  if (!g || !ta || !tp || !tk) throw new Error("Unvollstaendige Binance-Positioning-Antwort");
  return {
    global_long_account_ratio: pflichtZahl(g, "longAccount", "Binance global"),
    global_short_account_ratio: pflichtZahl(g, "shortAccount", "Binance global"),
    global_account_long_short_ratio: pflichtZahl(g, "longShortRatio", "Binance global"),
    top_trader_long_account_ratio: pflichtZahl(ta, "longAccount", "Binance topAccount"),
    top_trader_short_account_ratio: pflichtZahl(ta, "shortAccount", "Binance topAccount"),
    top_trader_account_long_short_ratio: pflichtZahl(ta, "longShortRatio", "Binance topAccount"),
    // Die Positions-Route nennt ihre Felder wie die Account-Route (longAccount/shortAccount).
    top_trader_long_position_ratio: pflichtZahl(tp, "longAccount", "Binance topPosition"),
    top_trader_short_position_ratio: pflichtZahl(tp, "shortAccount", "Binance topPosition"),
    top_trader_position_long_short_ratio: pflichtZahl(tp, "longShortRatio", "Binance topPosition"),
    taker_buy_vol: pflichtZahl(tk, "buyVol", "Binance taker"),
    taker_sell_vol: pflichtZahl(tk, "sellVol", "Binance taker"),
    taker_buy_sell_ratio: pflichtZahl(tk, "buySellRatio", "Binance taker"),
  };
}

export function parseBybitPositionierung(json: Json): PositionierungWerte {
  const e = json?.result?.list?.[0];
  if (!e) throw new Error("Keine Bybit-Positioning-Daten");
  const buy = pflichtZahl(e, "buyRatio", "Bybit account-ratio");
  const sell = pflichtZahl(e, "sellRatio", "Bybit account-ratio");
  return {
    ...LEERE_POSITIONIERUNG,
    global_long_account_ratio: buy,
    global_short_account_ratio: sell,
    global_account_long_short_ratio: sell !== 0 ? buy / sell : null,
  };
}

// OKX liefert nur das Verhaeltnis long/short als [ts, ratio].
// Rueckrechnung ueber long+short=1: long = ratio/(1+ratio), short = 1-long.
export function parseOkxPositionierung(json: Json): PositionierungWerte {
  if (json?.code !== "0") throw new Error(`OKX API-Fehler: ${json?.msg || json?.code}`);
  const e = json?.data?.[0];
  if (!e) throw new Error("Keine OKX-Positioning-Daten");
  const ratio = pflichtZahl(e, "1", "OKX long-short-account-ratio");
  const long = ratio / (1 + ratio);
  return {
    ...LEERE_POSITIONIERUNG,
    global_long_account_ratio: long,
    global_short_account_ratio: 1 - long,
    global_account_long_short_ratio: ratio,
  };
}

// 5-Min-Zeitreihe (30 Eintraege, aelteste zuerst, Stand 29.10.2026). Gewaehlt
// wird der Eintrag mit dem groessten ts statt "der letzte", damit eine
// geaenderte Sortierung nicht still einen alten Wert liefert.
export function parseBitgetPositionierung(json: Json): PositionierungWerte {
  const list = json?.data;
  if (!Array.isArray(list) || list.length === 0) throw new Error("Keine Bitget-Positioning-Daten");
  const e = list.reduce((a, b) => (Number(b?.ts) > Number(a?.ts) ? b : a));
  const lsr = kannZahl(e, "longShortAccountRatio");
  return {
    ...LEERE_POSITIONIERUNG,
    global_long_account_ratio: pflichtZahl(e, "longAccountRatio", "Bitget account-long-short"),
    global_short_account_ratio: pflichtZahl(e, "shortAccountRatio", "Bitget account-long-short"),
    global_account_long_short_ratio: lsr,
  };
}
