import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 3 Market-Intelligence-Engine: Options-Collector (Deribit).
//
// Deribit stellt eine oeffentliche, kostenlose Marktdaten-API ohne Auth
// bereit (verifiziert per Live-Aufruf: GET /public/get_book_summary_by_
// currency?currency=BTC&kind=option liefert ~950 Instrumente mit mark_iv,
// open_interest, underlying_price). Keine neue Zahlungspflicht, keine
// TradingView-Daten (spec-Vorgabe: TradingView als Quelle verboten).
//
// Bewusst modular gehalten (spec-Vorgabe): schlaegt Deribit fehl oder liefert
// unvollstaendige Daten, wird NICHTS gespeichert (status='error'), statt
// erfundene Werte einzutragen -- der Rest des Dashboards wird davon nicht
// beeinflusst, da diese Function komplett unabhaengig von den uebrigen
// Collectoren laeuft.
//
// 2026-10-14: zusaetzlich iv_30d / skew_30d / expiries_30d -- 30-Tage-ATM-IV
// und 30-Tage-Skew, exakt wie die Volatilitaets-Kachel rechnet
// (lib/volatility.ts::thirtyDayOptions): Verfaelle unter 7 Tagen fallen weg,
// ATM-IV per Gesamtvarianz-Interpolation auf genau 30 Tage, Skew = IV(Put
// ~10 % unter Forward) - IV(Call ~10 % ueber Forward), linear interpoliert.
// Zweck: Vorwaertstest des Skew-Pfeils (docs/research/SKEW-PFEIL-
// VORWAERTSTEST.md). atm_iv/skew_proxy (naechster Verfall) bleiben
// unveraendert. Quellcode seit 2026-10-14 im Repo
// (supabase/functions/collect-options/index.ts).

const DERIBIT_URL = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option";

// Wie weit (in % des Spot-Preises) die fuer den Skew-Proxy verglichenen
// Put-/Call-Strikes vom Geld entfernt liegen sollen (ungefaehr "10% OTM").
const SKEW_OTM_PCT = 10;

// 30-Tage-Werte (identisch zu lib/volatility.ts)
const TARGET_DAYS = 30;
const MIN_DAYS = 7;
const SKEW_MONEYNESS = 0.1;
const STRIKE_TOLERANCE = 0.03;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

interface OptionEntry {
  expiry: string; // z.B. "25DEC26"
  strike: number;
  type: "C" | "P";
  markIv: number | null;
  openInterest: number;
  underlyingPrice: number | null;
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

// Deribit-Instrumentennamen: {BASE}-{EXPIRY}-{STRIKE}-{C|P}, z.B.
// "BTC-25DEC26-95000-P". EXPIRY im Format DDMMMYY.
function parseInstrumentName(name: string): { expiry: string; strike: number; type: "C" | "P" } | null {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [, expiry, strikeStr, typeChar] = parts;
  const strike = parseFloat(strikeStr);
  if (Number.isNaN(strike) || (typeChar !== "C" && typeChar !== "P")) return null;
  return { expiry, strike, type: typeChar };
}

function parseExpiryDate(expiry: string): Date | null {
  const match = expiry.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;
  const [, dayStr, monStr, yearStr] = match;
  const month = MONTHS[monStr];
  if (month === undefined) return null;
  const day = parseInt(dayStr, 10);
  const year = 2000 + parseInt(yearStr, 10);
  // Deribit-Optionen verfallen um 08:00 UTC.
  return new Date(Date.UTC(year, month, day, 8, 0, 0));
}

// Max Pain: der Strike aus der Liste der gehandelten Strikes dieser
// Verfallsperiode, bei dem die gesamte intrinsische Auszahlung an
// Optionsinhaber (Calls im Geld + Puts im Geld) minimal waere -- Standard-
// Definition, keine Handelsempfehlung.
function computeMaxPain(entries: OptionEntry[]): number | null {
  const strikes = [...new Set(entries.map((e) => e.strike))];
  if (strikes.length === 0) return null;

  let bestStrike: number | null = null;
  let bestPayout = Infinity;

  for (const candidate of strikes) {
    let payout = 0;
    for (const e of entries) {
      if (e.type === "C" && candidate > e.strike) {
        payout += (candidate - e.strike) * e.openInterest;
      } else if (e.type === "P" && candidate < e.strike) {
        payout += (e.strike - candidate) * e.openInterest;
      }
    }
    if (payout < bestPayout) {
      bestPayout = payout;
      bestStrike = candidate;
    }
  }
  return bestStrike;
}

function closestByStrike(entries: OptionEntry[], type: "C" | "P", targetPrice: number): OptionEntry | null {
  const candidates = entries.filter((e) => e.type === type && e.markIv !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, e) =>
    Math.abs(e.strike - targetPrice) < Math.abs(best.strike - targetPrice) ? e : best,
  );
}

// --- 30-Tage-Werte, Port von lib/volatility.ts::thirtyDayOptions ----------

interface ExpiryPoint {
  expiry: string;
  days: number;
  atmIv: number | null;
  skew: number | null;
}

function nearestWithin(entries: OptionEntry[], type: "C" | "P", target: number): OptionEntry | null {
  let best: OptionEntry | null = null;
  for (const e of entries) {
    if (e.type !== type || e.markIv === null || !(e.markIv > 0)) continue;
    if (!best || Math.abs(e.strike - target) < Math.abs(best.strike - target)) best = e;
  }
  if (!best || Math.abs(best.strike - target) / target > STRIKE_TOLERANCE) return null;
  return best;
}

function thirtyDayOptions(
  entries: OptionEntry[],
  nowMs: number,
): { expiries: string[]; atmIv: number | null; skew: number | null } | null {
  const byExpiry = new Map<string, { ms: number; list: OptionEntry[] }>();
  for (const e of entries) {
    if (e.underlyingPrice === null || !(e.underlyingPrice > 0)) continue;
    const date = parseExpiryDate(e.expiry);
    if (!date || (date.getTime() - nowMs) / DAY_MS < MIN_DAYS) continue;
    const slot = byExpiry.get(e.expiry) ?? { ms: date.getTime(), list: [] };
    slot.list.push(e);
    byExpiry.set(e.expiry, slot);
  }
  const points: ExpiryPoint[] = [];
  for (const [expiry, { ms, list }] of byExpiry) {
    const forward = list[0].underlyingPrice as number;
    const atm = [nearestWithin(list, "C", forward), nearestWithin(list, "P", forward)].filter(
      (o): o is OptionEntry => o !== null,
    );
    const otmPut = nearestWithin(list, "P", forward * (1 - SKEW_MONEYNESS));
    const otmCall = nearestWithin(list, "C", forward * (1 + SKEW_MONEYNESS));
    const atmIv = atm.length ? atm.reduce((s, o) => s + (o.markIv as number), 0) / atm.length : null;
    if (atmIv === null) continue;
    points.push({
      expiry,
      days: (ms - nowMs) / DAY_MS,
      atmIv,
      skew: otmPut && otmCall ? (otmPut.markIv as number) - (otmCall.markIv as number) : null,
    });
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.days - b.days);
  const below = points.filter((p) => p.days <= TARGET_DAYS).pop();
  const above = points.find((p) => p.days > TARGET_DAYS);
  if (below && above) {
    const w1 = below.atmIv! ** 2 * below.days;
    const w2 = above.atmIv! ** 2 * above.days;
    const share = (TARGET_DAYS - below.days) / (above.days - below.days);
    return {
      expiries: [below.expiry, above.expiry],
      atmIv: Math.sqrt((w1 + (w2 - w1) * share) / TARGET_DAYS),
      skew: below.skew !== null && above.skew !== null ? below.skew + (above.skew - below.skew) * share : null,
    };
  }
  const only = (below ?? above)!;
  return { expiries: [only.expiry], atmIv: only.atmIv, skew: only.skew };
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();

  try {
    const raw = await fetchJson(DERIBIT_URL);
    const list = raw?.result;
    if (!Array.isArray(list) || list.length === 0) throw new Error("Leere Deribit-Options-Antwort");

    const entries: OptionEntry[] = [];
    for (const item of list) {
      const parsed = parseInstrumentName(item.instrument_name ?? "");
      if (!parsed) continue;
      entries.push({
        expiry: parsed.expiry,
        strike: parsed.strike,
        type: parsed.type,
        markIv: typeof item.mark_iv === "number" ? item.mark_iv : null,
        openInterest: typeof item.open_interest === "number" ? item.open_interest : 0,
        underlyingPrice: typeof item.underlying_price === "number" ? item.underlying_price : null,
      });
    }
    if (entries.length === 0) throw new Error("Keine gueltigen Options-Instrumente geparst");

    // Put/Call-OI-Verhaeltnis ueber ALLE Verfallsperioden.
    const totalOiCalls = entries.filter((e) => e.type === "C").reduce((s, e) => s + e.openInterest, 0);
    const totalOiPuts = entries.filter((e) => e.type === "P").reduce((s, e) => s + e.openInterest, 0);
    const putCallOiRatio = totalOiCalls > 0 ? totalOiPuts / totalOiCalls : null;

    // Naechste Verfallsperiode bestimmen (kleinste Zeit bis Verfall, die noch
    // in der Zukunft liegt).
    const expiryDates = new Map<string, Date>();
    for (const e of entries) {
      if (!expiryDates.has(e.expiry)) {
        const d = parseExpiryDate(e.expiry);
        if (d) expiryDates.set(e.expiry, d);
      }
    }
    const nowMs = Date.now();
    let nearExpiry: string | null = null;
    let nearExpiryDate: Date | null = null;
    for (const [expiry, date] of expiryDates) {
      if (date.getTime() <= nowMs) continue;
      if (!nearExpiryDate || date.getTime() < nearExpiryDate.getTime()) {
        nearExpiry = expiry;
        nearExpiryDate = date;
      }
    }
    if (!nearExpiry || !nearExpiryDate) throw new Error("Keine zukuenftige Verfallsperiode gefunden");

    const nearEntries = entries.filter((e) => e.expiry === nearExpiry);
    const underlyingPrice = nearEntries.find((e) => e.underlyingPrice !== null)?.underlyingPrice ?? null;
    if (underlyingPrice === null) throw new Error("Kein Underlying-Preis fuer naechste Verfallsperiode");

    const atmCall = closestByStrike(nearEntries, "C", underlyingPrice);
    const atmPut = closestByStrike(nearEntries, "P", underlyingPrice);
    const atmIvValues = [atmCall?.markIv, atmPut?.markIv].filter((v): v is number => v !== null && v !== undefined);
    const atmIv = atmIvValues.length > 0 ? atmIvValues.reduce((a, b) => a + b, 0) / atmIvValues.length : null;

    const otmPutTarget = underlyingPrice * (1 - SKEW_OTM_PCT / 100);
    const otmCallTarget = underlyingPrice * (1 + SKEW_OTM_PCT / 100);
    const otmPut = closestByStrike(nearEntries, "P", otmPutTarget);
    const otmCall = closestByStrike(nearEntries, "C", otmCallTarget);
    const skewProxy =
      otmPut?.markIv !== null && otmPut?.markIv !== undefined && otmCall?.markIv !== null && otmCall?.markIv !== undefined
        ? otmPut.markIv - otmCall.markIv
        : null;

    const maxPainStrike = computeMaxPain(nearEntries);
    const nearExpiryDays = (nearExpiryDate.getTime() - nowMs) / (24 * 60 * 60 * 1000);
    const thirty = thirtyDayOptions(entries, nowMs);

    const { error: insertError } = await supabase.from("options_snapshots").insert({
      timestamp_utc: now,
      currency: "BTC",
      near_expiry: nearExpiry,
      near_expiry_days: Math.round(nearExpiryDays * 10) / 10,
      underlying_price: underlyingPrice,
      atm_iv: atmIv,
      skew_proxy: skewProxy,
      put_call_oi_ratio: putCallOiRatio,
      max_pain_strike: maxPainStrike,
      total_oi_calls_btc: totalOiCalls,
      total_oi_puts_btc: totalOiPuts,
      instrument_count: entries.length,
      iv_30d: thirty?.atmIv ?? null,
      skew_30d: thirty?.skew ?? null,
      expiries_30d: thirty ? thirty.expiries.join("/") : null,
      status: "ok",
      error: null,
    });
    if (insertError) throw new Error(`options_snapshots insert: ${insertError.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        nearExpiry,
        atmIv,
        putCallOiRatio,
        maxPainStrike,
        iv30d: thirty?.atmIv ?? null,
        skew30d: thirty?.skew ?? null,
        instrumentCount: entries.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("options_snapshots").insert({
      timestamp_utc: now,
      currency: "BTC",
      status: "error",
      error: message,
    });
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
