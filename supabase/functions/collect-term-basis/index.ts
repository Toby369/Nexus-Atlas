import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Termin-Basis-Collector (Deribit): annualisierte Praemie des vordersten
// Futures gegenueber dem Deribit-Index. Naeherung fuer die
// CME-Basis, die es nicht kostenlos ueber eine offizielle API gibt.
// Deribit-Marktdaten sind oeffentlich und ohne Auth (wie collect-options).
//
// Auswahl des Kontrakts wie beim CME-Front-Monat: der naechste Future
// (Monats- oder Quartalsverfall) mit mindestens MIN_DAYS Restlaufzeit. Kurz
// vor dem Verfall wird die annualisierte Basis instabil (kleiner Nenner),
// deshalb rollt die Auswahl vorher auf den naechsten Kontrakt.
//
// Aufrufe:
//   POST /collect-term-basis                 -> ein Live-Snapshot (Cron, stuendlich)
//   POST /collect-term-basis?backfill=365    -> taegliche Historie nachladen
//     (Index-Naeherung ueber BTC-PERPETUAL, source = deribit_backfill)

const API = "https://www.deribit.com/api/v2/public";
const MIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 1500;

interface Instrument {
  instrument_name: string;
  expiration_timestamp: number;
  settlement_period?: string;
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

async function listFutures(expired: boolean): Promise<Instrument[]> {
  const raw = await fetchJson(`${API}/get_instruments?currency=BTC&kind=future&expired=${expired}`);
  const list = raw?.result;
  if (!Array.isArray(list)) throw new Error("Unerwartete get_instruments-Antwort");
  return list.filter((i: Instrument) => i.settlement_period !== "perpetual" && !i.instrument_name.endsWith("PERPETUAL"));
}

// Naechster Kontrakt mit >= MIN_DAYS Restlaufzeit.
function pickFront(instruments: Instrument[], atMs: number): Instrument | null {
  const eligible = instruments.filter((i) => (i.expiration_timestamp - atMs) / DAY_MS >= MIN_DAYS);
  eligible.sort((a, b) => a.expiration_timestamp - b.expiration_timestamp);
  return eligible[0] ?? null;
}

const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Deribit listet ueber get_instruments nur kuerzlich abgelaufene Kontrakte.
// Monats-Futures verfallen am letzten Freitag des Monats um 08:00 UTC und
// heissen BTC-{Tag ohne fuehrende Null}{MON}{YY} -- daraus lassen sich die
// aelteren Namen rekonstruieren. Liefert Deribit fuer einen Namen keine
// Kurse, faellt er beim Backfill einfach weg.
function monthlyExpiries(fromMs: number, toMs: number): Instrument[] {
  const out: Instrument[] = [];
  const start = new Date(fromMs);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const last = new Date(Date.UTC(y, m + 1, 0, 8));
    const offset = (last.getUTCDay() - 5 + 7) % 7;
    const expiry = Date.UTC(y, m, last.getUTCDate() - offset, 8);
    if (expiry > toMs) break;
    const day = new Date(expiry).getUTCDate();
    out.push({
      instrument_name: `BTC-${day}${MONTH_CODES[m]}${String(y).slice(2)}`,
      expiration_timestamp: expiry,
    });
  }
  return out;
}

function basisRow(
  timestampMs: number,
  inst: Instrument,
  futurePrice: number,
  indexPrice: number,
  source: string,
) {
  const days = (inst.expiration_timestamp - timestampMs) / DAY_MS;
  const basisPct = ((futurePrice - indexPrice) / indexPrice) * 100;
  return {
    timestamp_utc: new Date(timestampMs).toISOString(),
    instrument: inst.instrument_name,
    expiry_utc: new Date(inst.expiration_timestamp).toISOString(),
    days_to_expiry: Math.round(days * 100) / 100,
    future_price: futurePrice,
    index_price: indexPrice,
    basis_pct: basisPct,
    basis_annualized_pct: basisPct * (365 / days),
    source,
  };
}

async function collectLive(supabase: any) {
  const now = Date.now();
  const front = pickFront(await listFutures(false), now);
  if (!front) throw new Error("Kein Future mit ausreichender Restlaufzeit gefunden");
  const ticker = (await fetchJson(`${API}/ticker?instrument_name=${front.instrument_name}`))?.result;
  const mark = Number(ticker?.mark_price);
  const index = Number(ticker?.index_price);
  if (!(mark > 0) || !(index > 0)) throw new Error(`Ungueltiger Ticker fuer ${front.instrument_name}`);

  // Auf die volle Stunde runden: ein Datenpunkt pro Stunde, doppelte
  // Cron-Laeufe ueberschreiben sich statt Duplikate zu erzeugen.
  const hourMs = Math.floor(now / 3_600_000) * 3_600_000;
  const row = basisRow(hourMs, front, mark, index, "deribit");
  const { error } = await supabase.from("term_basis_snapshots").upsert(row, { onConflict: "timestamp_utc,instrument" });
  if (error) throw new Error(`term_basis_snapshots upsert: ${error.message}`);
  return row;
}

async function dailyCloses(instrument: string, fromMs: number, toMs: number): Promise<Map<number, number>> {
  const raw = await fetchJson(
    `${API}/get_tradingview_chart_data?instrument_name=${instrument}&start_timestamp=${fromMs}&end_timestamp=${toMs}&resolution=1D`,
    30000,
  );
  const ticks: number[] = raw?.result?.ticks ?? [];
  const closes: number[] = raw?.result?.close ?? [];
  const out = new Map<number, number>();
  ticks.forEach((t, i) => {
    if (closes[i] > 0) out.set(Math.floor(t / DAY_MS) * DAY_MS, closes[i]);
  });
  return out;
}

async function backfill(supabase: any, days: number) {
  const endMs = Math.floor(Date.now() / DAY_MS) * DAY_MS - DAY_MS; // gestern 00:00 UTC
  const startMs = endMs - days * DAY_MS;

  const byName = new Map<string, Instrument>();
  for (const i of monthlyExpiries(startMs, endMs + 200 * DAY_MS)) byName.set(i.instrument_name, i);
  for (const i of [...(await listFutures(true)), ...(await listFutures(false))]) byName.set(i.instrument_name, i);
  // Nur Kontrakte, die im Fenster mit >= MIN_DAYS Restlaufzeit vorkommen koennen.
  const candidates = [...byName.values()].filter(
    (i) => i.expiration_timestamp - MIN_DAYS * DAY_MS >= startMs && i.expiration_timestamp - 400 * DAY_MS <= endMs,
  );

  const index = await dailyCloses("BTC-PERPETUAL", startMs, endMs);

  const closesByInstrument = new Map<string, Map<number, number>>();
  const failed: string[] = [];
  for (const inst of candidates) {
    try {
      const closes = await dailyCloses(inst.instrument_name, startMs, Math.min(endMs, inst.expiration_timestamp));
      if (closes.size > 0) closesByInstrument.set(inst.instrument_name, closes);
    } catch {
      failed.push(inst.instrument_name);
    }
  }
  const withData = candidates.filter((i) => closesByInstrument.has(i.instrument_name));

  const rows = [];
  for (let d = startMs; d <= endMs; d += DAY_MS) {
    const idx = index.get(d);
    if (!idx) continue;
    // Vorderster Kontrakt mit >= MIN_DAYS Restlaufzeit, der an diesem Tag gehandelt wurde.
    const front = pickFront(
      withData.filter((i) => closesByInstrument.get(i.instrument_name)!.has(d)),
      d,
    );
    if (!front) continue;
    rows.push(basisRow(d, front, closesByInstrument.get(front.instrument_name)!.get(d)!, idx, "deribit_backfill"));
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("term_basis_snapshots")
      .upsert(rows.slice(i, i + 500), { onConflict: "timestamp_utc,instrument" });
    if (error) throw new Error(`Backfill upsert: ${error.message}`);
  }
  return {
    days,
    rowsWritten: rows.length,
    contractsTried: candidates.length,
    contractsWithData: withData.length,
    failedContracts: failed,
    firstDay: rows[0]?.timestamp_utc ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const backfillParam = new URL(req.url).searchParams.get("backfill");
  try {
    const result = backfillParam
      ? await backfill(supabase, Math.min(Math.max(parseInt(backfillParam, 10) || 365, 1), MAX_BACKFILL_DAYS))
      : await collectLive(supabase);
    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
