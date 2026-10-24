import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Einmaliger Backfill (kein Cron) -- Option A: sowohl Yahoo Finance (VIX/
// S&P500/Nasdaq/DXY/JPY/Gold) als auch FRED (Fed-Bilanz/TGA/Reverse-Repo/
// M2/CPI/PCE) liefern kostenlose historische Zeitreihen, die collect-macro
// bisher nicht nutzt (der Live-Collector fragt nur den jeweils aktuellsten
// Punkt ab). Schreibt in dieselbe macro_snapshots-Tabelle/Spalten wie
// collect-macro -- eine Zeile pro tatsaechlichem historischem
// Beobachtungsdatum je Symbol/Serie, damit get_macro_regime_asof()
// (distinct on symbol, juengste Zeile <= asof) zu jedem historischen
// Zeitpunkt den damals tatsaechlich bekannten Wert findet -- keine
// Look-Ahead-Verzerrung.
//
// 12.09.2026 -- JPY=X (USD/JPY) und GC=F (COMEX-Gold-Future) ergaenzt,
// gleicher Grund wie in collect-macro (Runde 4 Cross-Asset-Korrelation).
// XAUUSD=X existiert auf Yahoo nicht (404, live verifiziert) -- GC=F
// funktioniert.
//
// 12.09.2026 -- M2SL/CPIAUCSL/PCEPI ergaenzt (Runde 5, Liquiditaet/
// Inflation). WICHTIG: monatliche Regierungsstatistik wird erst WOCHEN
// nach dem Stichmonat veroeffentlicht (anders als die woechentlichen
// WALCL/TGA/RRP mit nur wenigen Tagen Verzug) -- FRED speichert den Wert
// unter dem STICHMONAT-Datum, nicht dem Veroeffentlichungsdatum. Ein
// naiver Backfill mit obs.date als timestamp_utc waere Look-Ahead-Bias.
// PUBLICATION_LAG_DAYS unten verschiebt den Backfill-Zeitstempel um einen
// konservativen, recherchierten Verzug je Serie (CPI ~6 Wochen, PCE ~8
// Wochen, M2 ~7 Wochen nach Monatsbeginn). Betrifft NUR den Backfill --
// collect-macro (Live-Collector) fragt FRED live nach dem "aktuellsten
// veroeffentlichten Wert" ab, das respektiert den echten
// Veroeffentlichungszeitpunkt automatisch, keine Anpassung noetig.
//
// 12.09.2026 -- Datenluecke geschlossen: ^VIX/^GSPC/^IXIC/DX-Y.NYB/WALCL/
// WTREGEN/RRPONTSYD waren urspruenglich nur ab 2024-09-04 zurueckbefuellt,
// obwohl das Regime-Score-Bewertungsraster bis 2022-09-04 zurueckreicht --
// die aeltere Haelfte hatte dadurch GAR KEINE Daten (faelschlich als
// "inaktiv" statt "unbekannt" gewertet). Rueckwirkend mit separatem Lauf
// (startDate=2022-09-04, endDate=2024-09-03) geschlossen, Runde 4 danach
// neu berechnet.
//
// ACHTUNG bei erneutem Aufruf: macro_snapshots hat KEINEN Unique-Constraint
// auf (symbol, timestamp_utc) -- ein erneuter Lauf mit bereits abgedeckten
// Symbolen/Zeitraeumen erzeugt Duplikate. Vor einem erneuten Vollbackfill
// ggf. die betroffenen Zeilen vorher loeschen.

const YAHOO_SYMBOLS = [
  { symbol: "^VIX", label: "VIX" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq Composite" },
  { symbol: "DX-Y.NYB", label: "US-Dollar-Index" },
  { symbol: "JPY=X", label: "USD/JPY" },
  { symbol: "GC=F", label: "Gold (COMEX-Future)" },
];

const FRED_SERIES = [
  { seriesId: "WALCL", label: "Fed-Bilanzsumme", publicationLagDays: 0 },
  { seriesId: "WTREGEN", label: "US-Treasury General Account (TGA)", publicationLagDays: 0 },
  { seriesId: "RRPONTSYD", label: "Overnight Reverse Repo (Fed)", publicationLagDays: 0 },
  { seriesId: "M2SL", label: "Geldmenge M2", publicationLagDays: 49 },
  { seriesId: "CPIAUCSL", label: "Verbraucherpreisindex (CPI)", publicationLagDays: 45 },
  { seriesId: "PCEPI", label: "PCE-Preisindex", publicationLagDays: 58 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function backfillYahoo(symbol: string, label: string, period1: number, period2: number) {
  const json = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`,
  );
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];

  const rows = [];
  let prevClose: number | null = null;
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== "number") continue;
    const changePct = prevClose !== null && prevClose !== 0 ? ((close - prevClose) / prevClose) * 100 : null;
    rows.push({
      timestamp_utc: new Date(timestamps[i] * 1000).toISOString(),
      symbol,
      label,
      last_price: close,
      prev_close: prevClose,
      change_pct: changePct,
      market_time_utc: new Date(timestamps[i] * 1000).toISOString(),
      status: "ok",
      error: null,
    });
    prevClose = close;
  }
  return rows;
}

async function backfillFred(
  apiKey: string,
  seriesId: string,
  label: string,
  startDate: string,
  publicationLagDays: number,
) {
  const json = await fetchJson(
    `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
      seriesId,
    )}&api_key=${apiKey}&file_type=json&sort_order=asc&observation_start=${startDate}&limit=100000`,
  );
  const observations = (json?.observations ?? []).filter(
    (o: any) => o?.value !== undefined && o.value !== "." && !Number.isNaN(parseFloat(o.value)),
  );

  const rows = [];
  let prevValue: number | null = null;
  for (const obs of observations) {
    const value = parseFloat(obs.value);
    const changePct = prevValue !== null && prevValue !== 0 ? ((value - prevValue) / prevValue) * 100 : null;
    // publicationLagDays verschiebt NUR timestamp_utc (den "ab wann bekannt"
    // Zeitpunkt fuer den asof-Join) -- market_time_utc bleibt das echte
    // Stichmonat-/Stichtag-Datum der Beobachtung, unveraendert.
    const knownAt = new Date(`${obs.date}T00:00:00Z`);
    knownAt.setUTCDate(knownAt.getUTCDate() + publicationLagDays);
    rows.push({
      timestamp_utc: knownAt.toISOString(),
      symbol: seriesId,
      label,
      last_price: value,
      prev_close: prevValue,
      change_pct: changePct,
      market_time_utc: new Date(`${obs.date}T00:00:00Z`).toISOString(),
      status: "ok",
      error: null,
    });
    prevValue = value;
  }
  return rows;
}

interface BackfillBody {
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD, default heute
}

Deno.serve(async (req: Request) => {
  let body: BackfillBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Ungueltiges JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const period1 = Math.floor(new Date(`${body.startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = body.endDate
    ? Math.floor(new Date(`${body.endDate}T23:59:59Z`).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const allRows: any[] = [];
  const errors: string[] = [];

  for (let i = 0; i < YAHOO_SYMBOLS.length; i++) {
    const { symbol, label } = YAHOO_SYMBOLS[i];
    try {
      const rows = await backfillYahoo(symbol, label, period1, period2);
      allRows.push(...rows);
    } catch (err) {
      errors.push(`Yahoo ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i < YAHOO_SYMBOLS.length - 1) await sleep(600);
  }

  const { data: fredApiKey, error: keyError } = await supabase.rpc("get_secret", { secret_name: "FRED_API_KEY" });
  if (keyError || !fredApiKey) {
    errors.push(`FRED_API_KEY: ${keyError ? keyError.message : "nicht in Vault hinterlegt"}`);
  } else {
    for (let i = 0; i < FRED_SERIES.length; i++) {
      const { seriesId, label, publicationLagDays } = FRED_SERIES[i];
      try {
        const rows = await backfillFred(fredApiKey, seriesId, label, body.startDate, publicationLagDays);
        allRows.push(...rows);
      } catch (err) {
        errors.push(`FRED ${seriesId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (i < FRED_SERIES.length - 1) await sleep(300);
    }
  }

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("macro_snapshots").insert(chunk);
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, inserted, errors }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    inserted += chunk.length;
  }

  return new Response(JSON.stringify({ success: true, totalFetched: allRows.length, inserted, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
