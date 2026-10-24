import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 4 Market-Intelligence-Engine: Makro-Collector.
//
// Zwei unabhaengige Quellen, beide schreiben in dieselbe macro_snapshots-
// Tabelle (gleiches Zeilenformat, keine neue Tabelle noetig):
//
// 1) Die oeffentliche Yahoo-Finance-Chart-Route (query1.finance.yahoo.com/
//    v8/finance/chart) -- kein API-Key noetig, per Live-Aufruf verifiziert
//    (S&P 500, Nasdaq Composite, VIX, US-Dollar-Index, 10J-US-Treasury-
//    Yield liefern alle plausible Realwerte). INOFFIZIELLE, nicht formal
//    dokumentierte Route -- im Gegensatz zu den Boersen-APIs in den anderen
//    Collectoren keine Garantie auf Stabilitaet. Faellt sie aus, wird das
//    als status='error' je Symbol gespeichert, nie ein erfundener Wert.
//
// 2) Die FRED-API (St. Louis Fed, api.stlouisfed.org) -- kostenloser,
//    vom Nutzer selbst angelegter API-Key (siehe get_secret('FRED_API_KEY'),
//    aus Supabase Vault gelesen, niemals im Code/Repo). Deckt Fed-
//    Bilanzsumme, TGA, Reverse Repo, Fed Funds Rate, 2J-Treasury-Yield, M2,
//    CPI, PCE und Nonfarm Payrolls ab. ISM/NAPM bewusst NICHT abgedeckt --
//    FRED hat diese Serien im Juni 2016 wegen Lizenzaenderungen komplett
//    entfernt (verifiziert), keine kostenlose Alternative gefunden.
//    Wirtschaftskalender (FOMC-Termine etc.) ebenfalls nicht abgedeckt --
//    FRED liefert Zeitreihen, keinen Termin-Kalender; eigenes Thema fuer
//    spaeter.
//
// 12.09.2026 -- JPY=X (USD/JPY) und GC=F (COMEX-Gold-Future) ergaenzt
// (Nutzer-Wunsch: Cross-Asset-Korrelationsforschung fuers Gesamteinschaetzung-
// Score-Protokoll, Runde 4 -- Yen-Carry-Trade- und Gold-Ko-Bewegungs-
// Hypothesen). XAUUSD=X (Spot-Gold-FX-Syntax) live getestet -> 404, existiert
// auf Yahoo nicht; GC=F funktioniert (verifiziert). Futures-Rollover-Luecken
// sind fuer taegliche %-Bewegungen ein bekannter, aber kleiner Store-Fehler --
// keine bessere kostenlose Quelle gefunden.
const YAHOO_SYMBOLS: YahooSymbol[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq Composite" },
  { symbol: "^VIX", label: "VIX" },
  { symbol: "DX-Y.NYB", label: "US-Dollar-Index" },
  { symbol: "^TNX", label: "10J US-Treasury-Yield" },
  { symbol: "JPY=X", label: "USD/JPY" },
  { symbol: "GC=F", label: "Gold (COMEX-Future)" },
];

interface YahooSymbol {
  symbol: string;
  label: string;
}

interface FredSeries {
  seriesId: string;
  label: string;
}

// Serien-IDs gegen die FRED-Dokumentation geprueft (fred.stlouisfed.org/
// series/<ID>). Taegliche/woechentliche/monatliche Frequenz je nach
// Serie -- die observations-Route liefert unabhaengig davon einfach die
// juengsten tatsaechlich veroeffentlichten Werte, kein Resampling noetig.
const FRED_SERIES: FredSeries[] = [
  { seriesId: "DGS2", label: "2J US-Treasury-Yield" },
  { seriesId: "DFF", label: "Fed Funds Rate (effektiv)" },
  { seriesId: "WALCL", label: "Fed-Bilanzsumme" },
  { seriesId: "WTREGEN", label: "US-Treasury General Account (TGA)" },
  { seriesId: "RRPONTSYD", label: "Overnight Reverse Repo (Fed)" },
  { seriesId: "M2SL", label: "Geldmenge M2" },
  { seriesId: "CPIAUCSL", label: "Verbraucherpreisindex (CPI)" },
  { seriesId: "PCEPI", label: "PCE-Preisindex" },
  { seriesId: "PAYEMS", label: "Nonfarm Payrolls" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Yahoo's inoffizielle Route reagiert auf gebuendelte, kopflose Anfragen
// (5 parallele Deno-Deploy-Requests ohne User-Agent) mit HTTP 429 --
// verifiziert per Live-Test. Ein browser-aehnlicher User-Agent + serielle
// Abfragen mit kleinem Abstand (STAGGER_MS) statt Promise.all reduzieren
// das deutlich. Trotzdem keine Garantie -- s. Kommentar oben.
const STAGGER_MS = 600;
// FRED erlaubt 120 Requests/Minute -- deutlich unkritischer als Yahoo,
// trotzdem seriell mit kleinem Abstand aus Konsistenz zum Rest der
// Function und um keinen unnoetigen Burst zu erzeugen.
const FRED_STAGGER_MS = 300;

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
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

interface MacroRow {
  symbol: string;
  label: string;
  last_price: number | null;
  prev_close: number | null;
  change_pct: number | null;
  market_time_utc: string | null;
  status: "ok" | "error";
  error: string | null;
}

async function collectYahooSymbol(symbol: string, label: string): Promise<MacroRow> {
  try {
    const json = await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    );
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") {
      throw new Error(`Unvollstaendige Yahoo-Antwort fuer ${symbol}`);
    }
    const lastPrice = meta.regularMarketPrice;
    const prevClose = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null;
    const changePct = prevClose !== null && prevClose !== 0 ? ((lastPrice - prevClose) / prevClose) * 100 : null;
    const marketTimeUtc =
      typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000).toISOString() : null;

    return {
      symbol,
      label,
      last_price: lastPrice,
      prev_close: prevClose,
      change_pct: changePct,
      market_time_utc: marketTimeUtc,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return {
      symbol,
      label,
      last_price: null,
      prev_close: null,
      change_pct: null,
      market_time_utc: null,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// FRED liefert fehlende Werte (z.B. Wochenenden/noch nicht veroeffentlicht)
// als value="." statt einer Zahl -- diese Beobachtungen werden uebersprungen,
// damit last_price/prev_close immer die beiden juengsten ECHTEN Werte sind.
async function collectFredSeries(apiKey: string, seriesId: string, label: string): Promise<MacroRow> {
  try {
    const json = await fetchJson(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
        seriesId,
      )}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`,
    );
    const observations = (json?.observations ?? []).filter(
      (o: any) => o?.value !== undefined && o.value !== "." && !Number.isNaN(parseFloat(o.value)),
    );
    if (observations.length === 0) {
      throw new Error(`Keine gueltigen FRED-Beobachtungen fuer ${seriesId}`);
    }
    const lastPrice = parseFloat(observations[0].value);
    const prevClose = observations.length > 1 ? parseFloat(observations[1].value) : null;
    const changePct = prevClose !== null && prevClose !== 0 ? ((lastPrice - prevClose) / prevClose) * 100 : null;
    const marketTimeUtc = observations[0].date ? new Date(`${observations[0].date}T00:00:00Z`).toISOString() : null;

    return {
      symbol: seriesId,
      label,
      last_price: lastPrice,
      prev_close: prevClose,
      change_pct: changePct,
      market_time_utc: marketTimeUtc,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return {
      symbol: seriesId,
      label,
      last_price: null,
      prev_close: null,
      change_pct: null,
      market_time_utc: null,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();
  const rows: MacroRow[] = [];

  // 1) Yahoo -- seriell statt Promise.all (siehe STAGGER_MS-Kommentar
  // oben), ein Symbolausfall blockiert die anderen nicht.
  for (let i = 0; i < YAHOO_SYMBOLS.length; i++) {
    if (i > 0) await sleep(STAGGER_MS);
    const { symbol, label } = YAHOO_SYMBOLS[i];
    rows.push(await collectYahooSymbol(symbol, label));
  }

  // 2) FRED -- Key aus Vault lesen (get_secret ist service_role-only,
  // siehe Migration add_get_secret_function). Fehlt der Key (z.B. noch
  // nicht hinterlegt), werden die FRED-Zeilen transparent als status=
  // 'error' markiert statt die Function abzubrechen -- Yahoo-Daten bleiben
  // trotzdem erhalten.
  const { data: fredApiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "FRED_API_KEY",
  });

  if (keyError || !fredApiKey) {
    for (const { seriesId, label } of FRED_SERIES) {
      rows.push({
        symbol: seriesId,
        label,
        last_price: null,
        prev_close: null,
        change_pct: null,
        market_time_utc: null,
        status: "error",
        error: keyError ? keyError.message : "FRED_API_KEY nicht in Vault hinterlegt",
      });
    }
  } else {
    for (let i = 0; i < FRED_SERIES.length; i++) {
      if (i > 0) await sleep(FRED_STAGGER_MS);
      const { seriesId, label } = FRED_SERIES[i];
      rows.push(await collectFredSeries(fredApiKey, seriesId, label));
    }
  }

  const { error: insertError } = await supabase.from("macro_snapshots").insert(
    rows.map((r) => ({
      timestamp_utc: now,
      symbol: r.symbol,
      label: r.label,
      last_price: r.last_price,
      prev_close: r.prev_close,
      change_pct: r.change_pct,
      market_time_utc: r.market_time_utc,
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

  return new Response(
    JSON.stringify({ success: true, results: rows.map((r) => ({ symbol: r.symbol, status: r.status, error: r.error })) }),
    { headers: { "Content-Type": "application/json" } },
  );
});
