// Datenbeschaffung fuer die Volatilitaets-Kachel. Server-only -- niemals aus
// einer "use client"-Komponente importieren.
//
// Deribit wird direkt serverseitig abgefragt (oeffentliche Marktdaten-API,
// kostenlos, ohne Schluessel), nicht ueber einen eigenen Sammler: Entscheid
// Toby 14.10.2026 -- keine Migration, kein neuer Cron, keine zusaetzliche
// Log-Ingestion in Supabase. Die Antworten werden einige Minuten im
// Next.js-Data-Cache gehalten (fetch-Option next.revalidate), damit nicht
// jeder Seitenaufruf Deribit trifft. Faellt Deribit aus, zeigt die Kachel
// nur die realisierte Volatilitaet aus der eigenen candles-Tabelle.
//
// options_snapshots.atm_iv/skew_proxy (collect-options) werden hier bewusst
// NICHT genutzt: sie stammen aus dem naechsten Verfall (oft < 1 Tag
// Restlaufzeit) und springen beim Verfallswechsel stark.

import { supabase } from "./supabase";
import {
  classifyDvolPercentile,
  classifyIvRvSpread,
  classifySkew,
  expectedDailyMovePct,
  expectedRange,
  percentileRank,
  realizedVolPct,
  thirtyDayOptions,
  type Assessment,
  type DeribitOptionSummary,
  type ExpectedRange,
  type SkewAssessment,
  type ThirtyDayOptions,
} from "./volatility";

const DERIBIT = "https://www.deribit.com/api/v2/public";
const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Einordnung des DVOL gegen das letzte Jahr (Tagesschluesse).
const DVOL_HISTORY_DAYS = 365;
const RV_SHORT_HOURS = 7 * 24;
const RANGE_DAYS = [1, 7, 30];
const RV_LONG_HOURS = 30 * 24;

export interface VolatilitySnapshot {
  dvol: number | null;
  dvolChange7d: number | null;
  dvolPercentile1y: number | null;
  dvolAssessment: Assessment | null;
  expectedDailyMovePct: number | null;
  expectedDailyMoveUsd: number | null;
  // 1-Sigma-Spannen fuer 1, 7 und 30 Tage aus dem DVOL (30-Tage-Erwartung).
  expectedRanges: ExpectedRange[];
  options30d: ThirtyDayOptions | null;
  skewAssessment: SkewAssessment | null;
  realizedVol7d: number | null;
  realizedVol30d: number | null;
  ivRvSpread: number | null;
  ivRvAssessment: Assessment | null;
  price: number | null;
  deribitAvailable: boolean;
  fetchedAt: string;
}

async function deribit<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  try {
    const res = await fetch(`${DERIBIT}/${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) {
      console.error(`Deribit ${path.split("?")[0]}: HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    return (body?.result ?? null) as T | null;
  } catch (err) {
    console.error(`Deribit ${path.split("?")[0]}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// DVOL-Kerzen: [Zeitstempel ms, Open, High, Low, Close]
type DvolCandle = [number, number, number, number, number];

async function fetchDvolDaily(nowMs: number): Promise<DvolCandle[]> {
  const start = nowMs - (DVOL_HISTORY_DAYS + 10) * DAY_MS;
  const result = await deribit<{ data: DvolCandle[] }>(
    `get_volatility_index_data?currency=BTC&start_timestamp=${start}&end_timestamp=${nowMs}&resolution=1D`,
    3600
  );
  return (result?.data ?? []).slice().sort((a, b) => a[0] - b[0]);
}

async function fetchDvolNow(nowMs: number): Promise<number | null> {
  const result = await deribit<{ data: DvolCandle[] }>(
    `get_volatility_index_data?currency=BTC&start_timestamp=${nowMs - 2 * 60 * 60 * 1000}&end_timestamp=${nowMs}&resolution=60`,
    60
  );
  const rows = (result?.data ?? []).slice().sort((a, b) => a[0] - b[0]);
  return rows.length ? rows[rows.length - 1][4] : null;
}

async function fetchOptionSummaries(): Promise<DeribitOptionSummary[]> {
  return (await deribit<DeribitOptionSummary[]>("get_book_summary_by_currency?currency=BTC&kind=option", 300)) ?? [];
}

async function fetchHourlyCloses(): Promise<number[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, close")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1h")
    .order("open_time", { ascending: false })
    .limit(RV_LONG_HOURS + 1);
  if (error) {
    console.error("Volatilitaet: Fehler beim Laden der 1h-Kerzen:", error.message);
    return [];
  }
  return (data ?? []).map((r) => Number(r.close)).reverse();
}

export async function buildVolatilitySnapshot(nowMs: number = Date.now()): Promise<VolatilitySnapshot> {
  const [daily, dvolNow, summaries, closes] = await Promise.all([
    fetchDvolDaily(nowMs),
    fetchDvolNow(nowMs),
    fetchOptionSummaries(),
    fetchHourlyCloses(),
  ]);

  const dvol = dvolNow ?? (daily.length ? daily[daily.length - 1][4] : null);
  const history = daily.slice(-DVOL_HISTORY_DAYS).map((d) => d[4]);
  const weekAgo = daily.length > 7 ? daily[daily.length - 8][4] : null;
  const dvolPercentile1y = dvol !== null ? percentileRank(dvol, history) : null;

  const options30d = summaries.length ? thirtyDayOptions(summaries, nowMs) : null;
  const realizedVol7d = realizedVolPct(closes, RV_SHORT_HOURS);
  const realizedVol30d = realizedVolPct(closes, RV_LONG_HOURS);
  const price = closes.length ? closes[closes.length - 1] : null;
  // Vergleich auf gleicher Laufzeit: 30-Tage-ATM-IV gegen 30-Tage-realisiert.
  // Fehlt die ATM-IV, dient DVOL (ebenfalls 30 Tage) als Ersatz.
  const impliedForSpread = options30d?.atmIv ?? dvol;
  const ivRvSpread =
    impliedForSpread !== null && realizedVol30d !== null ? impliedForSpread - realizedVol30d : null;
  const dailyMovePct = dvol !== null ? expectedDailyMovePct(dvol) : null;

  return {
    dvol,
    dvolChange7d: dvol !== null && weekAgo !== null ? dvol - weekAgo : null,
    dvolPercentile1y,
    // Unter ~6 Monaten Historie ist ein Jahres-Perzentil nicht aussagekraeftig.
    dvolAssessment: dvolPercentile1y !== null && history.length >= 180 ? classifyDvolPercentile(dvolPercentile1y) : null,
    expectedDailyMovePct: dailyMovePct,
    expectedDailyMoveUsd: dailyMovePct !== null && price !== null ? (price * dailyMovePct) / 100 : null,
    expectedRanges:
      dvol !== null && price !== null ? RANGE_DAYS.map((d) => expectedRange(price, dvol, d)) : [],
    options30d,
    skewAssessment: options30d?.skew != null ? classifySkew(options30d.skew) : null,
    realizedVol7d,
    realizedVol30d,
    ivRvSpread,
    ivRvAssessment: ivRvSpread !== null ? classifyIvRvSpread(ivRvSpread) : null,
    price,
    deribitAvailable: dvol !== null || options30d !== null,
    fetchedAt: new Date(nowMs).toISOString(),
  };
}
