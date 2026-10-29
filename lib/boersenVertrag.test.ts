import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  kannZahl,
  parseBinanceMarkt,
  parseBinancePositionierung,
  parseBitgetPositionierung,
  parseBitgetTicker,
  parseBitunixFunding,
  parseBybitPositionierung,
  parseBybitTicker,
  parseOkxMarkt,
  parseOkxPositionierung,
  parsePionexMarkt,
  pflichtZahl,
  type MarktWerte,
} from "../supabase/functions/_shared/boersenParser";

// Datenvertrag mit den Boersen (Vorbild: AutarkTrades __selftest-datenvertrag,
// docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md, Punkt C).
//
// Die anderen Tests pruefen Rechnungen. Dieser prueft die andere Haelfte:
// WELCHE FELDER die Sammler collect-btc und collect-positioning voraussetzen.
// Er laeuft gegen gespeicherte echte Antworten (supabase/functions/_fixtures/,
// aufgezeichnet 29.10.2026), ohne Netz. Aendert eine Boerse ihr Schema, faellt
// es beim naechsten Auffrischen der Fixtures auf (tools/fixtures-auffrischen/)
// -- nicht erst, wenn eine Kachel still falsch rechnet.

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "../supabase/functions/_fixtures", `${name}.json`), "utf8"));

// Plausibler BTC-Bereich: faengt Einheitenfehler (Faktor 100/1000) und
// vertauschte Felder ab, ohne bei jedem Kursrutsch zu brechen.
function plausibelBtc(w: MarktWerte) {
  for (const preis of [w.last_price, w.mark_price, w.index_price]) {
    if (preis !== null) {
      expect(preis).toBeGreaterThan(5_000);
      expect(preis).toBeLessThan(1_000_000);
    }
  }
  if (w.last_price !== null && w.mark_price !== null) {
    // Mark und Last liegen bei BTC nie mehr als 2 % auseinander.
    expect(Math.abs(w.mark_price / w.last_price - 1)).toBeLessThan(0.02);
  }
  // Funding als Dezimalbruch je Periode: |rate| < 1 % (0.01).
  expect(w.funding_rate).not.toBeNull();
  expect(Math.abs(w.funding_rate!)).toBeLessThan(0.01);
  if (w.open_interest !== null && w.open_interest_usd !== null && w.last_price !== null) {
    expect(w.open_interest).toBeGreaterThan(0);
    expect(w.open_interest_usd / w.open_interest).toBeCloseTo(w.last_price, -3);
  }
}

describe("Marktdaten (collect-btc)", () => {
  it("Bybit: Ticker", () => {
    const w = parseBybitTicker(fixture("bybit_ticker"));
    plausibelBtc(w);
    expect(w.next_funding_time_utc).toBe("2026-10-29T16:00:00.000Z");
  });

  it("Binance: premiumIndex + openInterest + ticker/price", () => {
    const w = parseBinanceMarkt(fixture("binance_premium"), fixture("binance_oi"), fixture("binance_price"));
    plausibelBtc(w);
    expect(w.next_funding_time_utc).toBe("2026-10-29T16:00:00.000Z");
  });

  it("Bitunix: Funding kommt in Prozent und wird auf Dezimalbruch gebracht", () => {
    const w = parseBitunixFunding(fixture("bitunix_funding"), "BTCUSDT");
    plausibelBtc(w);
    // Roh 0.007013 (Prozent) -> 0.00007013, gleiche Groessenordnung wie Binance (0.00007008).
    expect(w.funding_rate).toBeCloseTo(0.00007013, 10);
    expect(w.index_price).toBe(80135);
    expect(w.open_interest).toBeNull();
  });

  it("Bitunix: waehlt BTCUSDT aus der Liste aller Paare, nicht den ersten Eintrag", () => {
    const w = parseBitunixFunding(fixture("bitunix_funding"), "BTCUSDT");
    expect(w.last_price).toBeGreaterThan(5_000); // ETH liegt im Fixture davor
  });

  it("Pionex: indexes + openInterests + tickers", () => {
    const w = parsePionexMarkt(fixture("pionex_index"), fixture("pionex_oi"), fixture("pionex_ticker"), "BTC_USDT_PERP");
    plausibelBtc(w);
    expect(w.open_interest).toBeCloseTo(1729.0438, 4);
  });

  it("OKX: Funding-Zeitpunkt ist die NAECHSTE Abrechnung (fundingTime), wie bei Bybit/Binance", () => {
    const w = parseOkxMarkt(fixture("okx_ticker"), fixture("okx_oi"), fixture("okx_funding"), fixture("okx_mark"));
    plausibelBtc(w);
    expect(w.next_funding_time_utc).toBe(parseBybitTicker(fixture("bybit_ticker")).next_funding_time_utc);
  });

  it("Bitget: Ticker", () => {
    plausibelBtc(parseBitgetTicker(fixture("bitget_ticker"), "BTCUSDT"));
  });
});

describe("Positionierung (collect-positioning)", () => {
  const anteile = (long: number | null, short: number | null) => {
    expect(long).not.toBeNull();
    expect(short).not.toBeNull();
    expect(long! + short!).toBeCloseTo(1, 3);
    expect(long!).toBeGreaterThan(0);
    expect(long!).toBeLessThan(1);
  };

  it("Binance: alle zwoelf Werte, Anteile ergeben 1", () => {
    const w = parseBinancePositionierung(
      fixture("binance_pos_global"),
      fixture("binance_pos_top_account"),
      fixture("binance_pos_top_position"),
      fixture("binance_pos_taker"),
    );
    for (const v of Object.values(w)) expect(v).not.toBeNull();
    anteile(w.global_long_account_ratio, w.global_short_account_ratio);
    anteile(w.top_trader_long_account_ratio, w.top_trader_short_account_ratio);
    anteile(w.top_trader_long_position_ratio, w.top_trader_short_position_ratio);
    expect(w.taker_buy_sell_ratio).toBeCloseTo(w.taker_buy_vol! / w.taker_sell_vol!, 2);
  });

  it("Bybit: buyRatio/sellRatio", () => {
    const w = parseBybitPositionierung(fixture("bybit_pos"));
    anteile(w.global_long_account_ratio, w.global_short_account_ratio);
    expect(w.global_account_long_short_ratio).toBeCloseTo(0.6584 / 0.3416, 6);
  });

  it("OKX: Verhaeltnis wird in Anteile zurueckgerechnet", () => {
    const w = parseOkxPositionierung(fixture("okx_pos"));
    anteile(w.global_long_account_ratio, w.global_short_account_ratio);
    expect(w.global_long_account_ratio! / w.global_short_account_ratio!).toBeCloseTo(w.global_account_long_short_ratio!, 6);
  });

  it("Bitget: neuester Eintrag nach ts, unabhaengig von der Sortierung", () => {
    const json = fixture("bitget_pos");
    const neuester = parseBitgetPositionierung(json);
    anteile(neuester.global_long_account_ratio, neuester.global_short_account_ratio);
    expect(neuester.global_long_account_ratio).toBe(0.7073); // ts 1793268900000
    const umgedreht = parseBitgetPositionierung({ ...json, data: [...json.data].reverse() });
    expect(umgedreht).toEqual(neuester);
  });
});

describe("Pflichtfelder", () => {
  it("ein umbenanntes Feld wirft mit Feldnamen statt still NaN zu speichern", () => {
    const json = fixture("bybit_ticker");
    delete json.result.list[0].markPrice;
    expect(() => parseBybitTicker(json)).toThrow(/Bybit: Feld "markPrice" fehlt/);
  });

  it("leerer String gilt als fehlend", () => {
    expect(() => pflichtZahl({ a: "" }, "a", "Test")).toThrow(/Feld "a"/);
    expect(kannZahl({ a: "" }, "a")).toBeNull();
  });

  it("Zahl und Zahl-String werden gelesen", () => {
    expect(pflichtZahl({ a: 1.5 }, "a", "Test")).toBe(1.5);
    expect(pflichtZahl({ a: "0.00002563" }, "a", "Test")).toBe(0.00002563);
  });

  it("eine Fehlerantwort der Boerse wirft", () => {
    expect(() => parseOkxPositionierung({ code: "50011", msg: "Too Many Requests" })).toThrow(/OKX API-Fehler/);
    expect(() => parseBinanceMarkt({ code: -1121, msg: "Invalid symbol." }, {}, {})).toThrow(/Binance/);
  });
});
