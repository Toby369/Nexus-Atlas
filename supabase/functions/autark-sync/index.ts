import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Zonen aus AutarkTrade (Toby 28.10.2026, docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).
// tools/autark-sync/autark_sync.py liest Tobys Zeichnungen (Rechtecke,
// Horizontale) nur lesend aus autarktrade.db und schickt sie hierher:
//   POST  Authorization: Bearer <AUTARK_SYNC_SECRET>
//   {"symbol": "BTCUSDT", "zones": [{"id": 12, "lo": 81000, "hi": 81300, "label": "..."}]}
// Die Zonen ersetzen own_zones vollstaendig (replace_own_zones_from_autark,
// atomar, nur bei Aenderung; autark_sync_status fuehrt den letzten Sync).
// Eine leere Liste nur mit "allow_empty": true. Eigene Edge Function mit
// verify_jwt=false wie webhook-tradingview.

const MAX_ZONES = 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "Nur POST erlaubt." }, 405);

  const expected = Deno.env.get("AUTARK_SYNC_SECRET") ?? "";
  if (!expected) return json({ success: false, error: "Sync serverseitig nicht konfiguriert." }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !sameSecret(provided, expected)) return json({ success: false, error: "Nicht authentifiziert." }, 401);

  let body: { symbol?: unknown; zones?: unknown; allow_empty?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Ungültiges JSON." }, 400);
  }
  if (body.symbol !== "BTCUSDT") return json({ success: false, error: "Nur BTCUSDT wird übernommen." }, 400);
  if (!Array.isArray(body.zones) || body.zones.length > MAX_ZONES) {
    return json({ success: false, error: `zones muss eine Liste mit höchstens ${MAX_ZONES} Einträgen sein.` }, 400);
  }

  const zones = [];
  for (const raw of body.zones as Record<string, unknown>[]) {
    const lo = Number(raw?.lo);
    const hi = Number(raw?.hi);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
      return json({ success: false, error: "Zone mit ungültigem Bereich." }, 400);
    }
    const id = Number(raw?.id);
    zones.push({
      id: Number.isInteger(id) ? id : null,
      lo,
      hi,
      label: typeof raw?.label === "string" ? raw.label.slice(0, 120) : "",
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("replace_own_zones_from_autark", {
    p_zones: zones,
    p_allow_empty: body.allow_empty === true,
  });
  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, zones: data }, 200);
});
