#!/usr/bin/env node
// Holt die echten Antworten aller Boersen-Endpunkte, die collect-btc und
// collect-positioning abfragen, und legt sie als Fixtures ab
// (supabase/functions/_fixtures/). Danach `npm test` laufen lassen: faellt
// lib/boersenVertrag.test.ts, hat eine Boerse ihr Schema geaendert.
//
// Muss auf einem Rechner mit Zugang zu den Boersen laufen (PC, VPS) -- nicht
// in der Claude-Cloud-Umgebung, die die Boersen sperrt. Nur Node >= 18,
// keine Abhaengigkeiten. Aufruf aus dem Repo-Wurzelordner:
//   node tools/fixtures-auffrischen/fixtures-auffrischen.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ZIEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions/_fixtures");

// Dieselben Adressen wie in den Sammlern (Symbol BTCUSDT).
const ENDPUNKTE = {
  bybit_ticker: "https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT",
  binance_premium: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
  binance_oi: "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT",
  binance_price: "https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT",
  bitunix_funding: "https://fapi.bitunix.com/api/v1/futures/market/funding_rate/batch",
  pionex_index: "https://api.pionex.com/api/v1/market/indexes?symbol=BTC_USDT_PERP",
  pionex_oi: "https://api.pionex.com/api/v1/market/openInterests",
  pionex_ticker: "https://api.pionex.com/api/v1/market/tickers?symbol=BTC_USDT_PERP&type=PERP",
  okx_ticker: "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP",
  okx_oi: "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP",
  okx_funding: "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP",
  okx_mark: "https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP",
  bitget_ticker: "https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES",
  binance_pos_global: "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1",
  binance_pos_top_account: "https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1",
  binance_pos_top_position: "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1",
  binance_pos_taker: "https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1",
  bybit_pos: "https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=5min&limit=1",
  okx_pos: "https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=BTC-USDT-SWAP&period=5m&limit=1",
  bitget_pos: "https://api.bitget.com/api/v2/mix/market/account-long-short?symbol=BTCUSDT&productType=USDT-FUTURES",
};

// Listen mit allen Paaren kuerzen (BTC plus ein Nachbar, damit der Test die
// Auswahl nach Symbol prueft), Reihenfolge der Boerse beibehalten.
const KUERZEN = {
  bitunix_funding: (j) => ({ ...j, data: j.data.filter((e) => ["BTCUSDT", "ETHUSDT"].includes(e.symbol)) }),
  pionex_oi: (j) => ({
    ...j,
    data: { ...j.data, openInterests: j.data.openInterests.filter((e) => ["BTC_USDT_PERP", "ETH_USDT_PERP"].includes(e.symbol)) },
  }),
  bitget_pos: (j) => ({ ...j, data: j.data.slice(-3) }),
};

let fehler = 0;
for (const [name, url] of Object.entries(ENDPUNKTE)) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let json = await res.json();
    if (KUERZEN[name]) json = KUERZEN[name](json);
    writeFileSync(path.join(ZIEL, `${name}.json`), JSON.stringify(json, null, 2) + "\n");
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fehler++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}
console.log(fehler ? `${fehler} Endpunkt(e) fehlgeschlagen, alte Fixture bleibt.` : "Alle Fixtures aufgefrischt. Jetzt: npm test");
process.exit(fehler ? 1 : 0);
