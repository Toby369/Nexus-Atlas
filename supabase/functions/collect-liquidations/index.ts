import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// NEXUS Liquidations Collector (Phase 5).
//
// Binance und Bybit bieten fuer BTC-Perpetual-Liquidationen ausschliesslich
// kostenlose WebSocket-Feeds an -- eine kostenlose globale REST-Historie
// gibt es bei keiner der beiden Boersen mehr (Binance hat
// GET /fapi/v1/allForceOrders eingestellt; GET /fapi/v1/forceOrders liefert
// nur die eigenen Orders des API-Keys, keine globalen Marktliquidationen --
// das war eine explizite Vorgabe aus Tobys Audit, diesen Endpunkt NICHT zu
// verwenden. Bybit hatte fuer Liquidationen nie eine REST-Route).
//
// Diese Funktion oeffnet daher bei jedem Cron-Lauf (alle 5 Min) kurzzeitig
// beide WebSockets, sammelt Events fuer ein festes Zeitfenster und schliesst
// dann wieder. Das ist bewusst eine Stichprobe (Sampling), keine
// luecklose Erfassung -- Ereignisse ausserhalb des Fensters gehen verloren,
// da beide Feeds reine Pushes ohne Backfill/History sind. Das Frontend
// kommuniziert das transparent (Punkt 3 der generellen Projekt-Prinzipien:
// Datenqualitaet immer transparent machen).
const CAPTURE_WINDOW_MS = 25_000;
const SYMBOL = "BTCUSDT";

interface LiquidationRow {
  event_time_utc: string;
  exchange: string;
  symbol: string;
  // side spiegelt die Richtung der liquidierten POSITION wider (Vorgabe aus
  // dem bestehenden Tabellenschema: CHECK side IN ('long','short','unknown')).
  side: "long" | "short" | "unknown";
  price: number | null;
  quantity: number | null;
  notional_usd: number | null;
  order_type: string | null;
  source_event_id: string;
  status: "ok";
  error: null;
}

// deno-lint-ignore no-explicit-any
type JsonRecord = Record<string, any>;

// Kommt keine Verbindung zustande, wird das jetzt als Fehler gemeldet
// (errors in der Antwort) statt als leere Liste -- eine falsche Adresse sah
// sonst genau wie ein ruhiger Markt aus (so geschehen bei Binance, siehe
// collectBinance).
function collectFromWebSocket(
  url: string,
  onOpen: ((ws: WebSocket) => void) | null,
  parse: (raw: string) => LiquidationRow | LiquidationRow[] | null,
): Promise<LiquidationRow[]> {
  return new Promise((resolve, reject) => {
    const rows: LiquidationRow[] = [];
    let settled = false;
    let opened = false;
    let ws: WebSocket | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch (_err) {
        // noop
      }
      if (opened) resolve(rows);
      else reject(new Error(`Keine WebSocket-Verbindung zu ${url}`));
    };

    const timeout = setTimeout(finish, CAPTURE_WINDOW_MS);

    try {
      ws = new WebSocket(url);
    } catch (_err) {
      clearTimeout(timeout);
      finish();
      return;
    }

    ws.onopen = () => {
      opened = true;
      try {
        onOpen?.(ws!);
      } catch (_err) {
        // noop
      }
    };

    ws.onmessage = (event) => {
      try {
        const parsed = parse(String(event.data));
        if (!parsed) return;
        if (Array.isArray(parsed)) rows.push(...parsed);
        else rows.push(parsed);
      } catch (_err) {
        // noop
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      finish();
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      finish();
    };
  });
}

// --- Binance: <symbol>@forceOrder ------------------------------------------
function parseBinance(raw: string): LiquidationRow | null {
  const msg = JSON.parse(raw) as JsonRecord;
  const o = msg?.o;
  if (msg?.e !== "forceOrder" || !o) return null;

  const price = o.ap ? parseFloat(o.ap) : o.p ? parseFloat(o.p) : null;
  const quantity = o.z ? parseFloat(o.z) : o.q ? parseFloat(o.q) : null;

  return {
    event_time_utc: new Date(o.T).toISOString(),
    exchange: "binance",
    symbol: o.s,
    // S = Seite der Liquidations-ORDER. SELL heisst: eine Long-Position
    // wurde zwangsweise verkauft (Long liquidiert), BUY heisst: eine
    // Short-Position wurde zwangsweise eingedeckt (Short liquidiert).
    side: o.S === "SELL" ? "long" : o.S === "BUY" ? "short" : "unknown",
    price,
    quantity,
    notional_usd:
      price !== null && quantity !== null ? price * quantity : null,
    order_type: o.o ?? null,
    source_event_id: `binance:${o.s}:${o.T}:${o.z ?? o.q}:${o.ap ?? o.p}`,
    status: "ok",
    error: null,
  };
}

// --- Bybit: allLiquidation.<symbol> ----------------------------------------
function parseBybit(raw: string): LiquidationRow[] | null {
  const msg = JSON.parse(raw) as JsonRecord;
  if (msg?.topic !== `allLiquidation.${SYMBOL}` || !Array.isArray(msg?.data)) {
    return null;
  }

  return msg.data.map((d: JsonRecord) => {
    const price = d.p ? parseFloat(d.p) : null;
    const quantity = d.v ? parseFloat(d.v) : null;
    return {
      event_time_utc: new Date(Number(d.T)).toISOString(),
      exchange: "bybit",
      symbol: d.s ?? SYMBOL,
      side: d.S === "Sell" ? "long" : d.S === "Buy" ? "short" : "unknown",
      price,
      quantity,
      notional_usd:
        price !== null && quantity !== null ? price * quantity : null,
      order_type: null,
      source_event_id: `bybit:${d.s}:${d.T}:${d.v}:${d.p}`,
      status: "ok",
      error: null,
    } as LiquidationRow;
  });
}

// Binance hat die USDT-M-Streams 2026 auf getrennte Basispfade verteilt
// (/public, /market); die alten Adressen ohne Pfad sind seit 23.04.2026
// abgeschaltet. forceOrder gehoert zu /market. Mit der alten Adresse kam
// seit dem Start dieses Sammlers (19.08.2026) keine einzige Binance-
// Liquidation an (Befund 29.10.2026). Seit 13.05.2026 liefert der Stream je
// Sekunde die GROESSTE Liquidation statt der juengsten -- weiterhin eine
// Stichprobe.
function collectBinance(): Promise<LiquidationRow[]> {
  const stream = SYMBOL.toLowerCase();
  return collectFromWebSocket(
    `wss://fstream.binance.com/market/ws/${stream}@forceOrder`,
    null,
    parseBinance,
  );
}

function collectBybit(): Promise<LiquidationRow[]> {
  return collectFromWebSocket(
    "wss://stream.bybit.com/v5/public/linear",
    (ws) => {
      ws.send(
        JSON.stringify({ op: "subscribe", args: [`allLiquidation.${SYMBOL}`] }),
      );
    },
    parseBybit,
  );
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results = await Promise.allSettled([collectBinance(), collectBybit()]);

  const rows: LiquidationRow[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") rows.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ success: true, inserted: 0, errors }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // ignoreDuplicates: falls sich Capture-Fenster an den Cron-Grenzen
  // ueberschneiden, keine Dubletten anlegen (unique index auf
  // (exchange, source_event_id)).
  const { error: insertError } = await supabase
    .from("liquidation_events")
    .upsert(
      rows.map((r) => ({
        event_time_utc: r.event_time_utc,
        exchange: r.exchange,
        symbol: r.symbol,
        side: r.side,
        price: r.price,
        quantity: r.quantity,
        notional_usd: r.notional_usd,
        order_type: r.order_type,
        source_event_id: r.source_event_id,
        status: r.status,
        error: r.error,
      })),
      { onConflict: "exchange,source_event_id", ignoreDuplicates: true },
    );

  if (insertError) {
    return new Response(
      JSON.stringify({ success: false, error: insertError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, inserted: rows.length, errors }),
    { headers: { "Content-Type": "application/json" } },
  );
});
