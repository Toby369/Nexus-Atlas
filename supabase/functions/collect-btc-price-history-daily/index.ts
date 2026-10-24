import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Umsetzungsplan Phase 5 (05.09.2026): taeglicher Import der vollen
// taeglichen BTC/USD-Schlusskurs-Historie (CoinGecko) fuer den
// Rainbow-Chart -- Nexus' eigene candles-Tabelle deckt nur ~2 Jahre seit
// dem Binance-Backfill, fuer eine log-Regression ueber den vollen
// Marktzyklus reicht das nicht.
//
// STAND 05.09.2026: CoinGecko verlangt inzwischen auch fuer den kostenlosen
// "Demo"-Tarif einen (kostenlos erstellbaren) API-Key im Header
// x-cg-demo-api-key -- ganz ohne Key liefert selbst /ping nur noch 404
// "Incorrect path". Ohne COINGECKO_API_KEY (Supabase Vault, wie
// FRED_API_KEY/BGEOMETRICS_API_KEY) bricht diese Funktion daher bewusst
// mit einer klaren Fehlermeldung ab, statt still leer zu bleiben. Sobald
// der Key hinterlegt ist, funktioniert der Rest unveraendert -- keine
// weitere Code-Aenderung noetig.
Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: apiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "COINGECKO_API_KEY",
  });

  if (keyError || !apiKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "COINGECKO_API_KEY nicht in Vault hinterlegt -- CoinGecko verlangt seit der API-Umstellung auch fuer den kostenlosen Demo-Tarif einen Key (kostenlos erstellbar auf coingecko.com/en/developers/dashboard).",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let res: Response;
  try {
    res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=daily",
      { headers: { "x-cg-demo-api-key": apiKey } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!res.ok) {
    return new Response(JSON.stringify({ success: false, error: `CoinGecko HTTP ${res.status}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const json = await res.json();
  const prices: [number, number][] = json.prices ?? [];

  if (prices.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "CoinGecko lieferte keine Preisdaten." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = prices.map(([ts, price]) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    close_price_usd: price,
    source: "coingecko",
    updated_at: new Date().toISOString(),
  }));

  // Chunked Upsert -- days=max liefert mehrere tausend Zeilen, ein
  // einzelnes Insert-Statement waere zu gross.
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("btc_price_history_daily").upsert(chunk, { onConflict: "date" });
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, upserted }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    upserted += chunk.length;
  }

  return new Response(JSON.stringify({ success: true, upserted }), {
    headers: { "Content-Type": "application/json" },
  });
});
