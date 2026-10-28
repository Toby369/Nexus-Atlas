import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Alarme aus AutarkTrade (Toby 28.10.2026, docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).
// AutarkTrade schickt jeden ausgeloesten Alarm ueber seinen Webhook-Kanal
// (Einstellungen › Benachrichtigungen) als POST mit
//   {quelle, regel, schwere, symbol, chain, meldung, daten, ts}
// (server/hype-radar/zustellung.js, webhook()). Chart-Alarme: quelle "chart",
// regel "chartAlarm", daten {alarmId, art, symbol, preis, niveau}.
//
// AutarkTrade setzt keine eigenen Header, deshalb steht das Geheimnis in der
// Adresse (?key=...). Die Adresse liegt in AutarkTrade verschluesselt. Wie
// webhook-tradingview eine eigene Edge Function (verify_jwt=false), damit das
// Auth-Gate in proxy.ts nicht aufgeweicht werden muss.

const KEEP_DAYS = 180;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function str(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "Nur POST erlaubt." }, 405);

  const expected = Deno.env.get("AUTARK_WEBHOOK_SECRET") ?? "";
  if (!expected) return json({ success: false, error: "Webhook serverseitig nicht konfiguriert." }, 500);
  const provided = new URL(req.url).searchParams.get("key") ?? "";
  if (!provided || !sameSecret(provided, expected)) return json({ success: false, error: "Nicht authentifiziert." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Ungültiges JSON." }, 400);
  }
  const meldung = str(body.meldung, 2000);
  if (!meldung) return json({ success: false, error: 'Feld "meldung" fehlt.' }, 400);
  if (JSON.stringify(body).length > 20_000) return json({ success: false, error: "Payload zu gross." }, 413);

  const daten = body.daten && typeof body.daten === "object" ? (body.daten as Record<string, unknown>) : {};
  const tsMs = numOrNull(body.ts);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.from("autark_alarms").insert({
    sent_at: tsMs ? new Date(tsMs).toISOString() : null,
    quelle: str(body.quelle, 50),
    regel: str(body.regel, 50),
    schwere: str(body.schwere, 20),
    symbol: str(body.symbol, 40) ?? str(daten.symbol, 40),
    meldung,
    preis: numOrNull(daten.preis),
    niveau: numOrNull(daten.niveau),
    payload: body,
  });
  if (error) return json({ success: false, error: error.message }, 500);

  // Alte Eintraege beim Schreiben mit aufraeumen (wenige Zeilen pro Tag).
  await supabase
    .from("autark_alarms")
    .delete()
    .lt("received_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());

  return json({ success: true }, 200);
});
