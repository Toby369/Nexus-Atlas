import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// POST /api/push/subscribe
// Body: { endpoint, keys: { p256dh, auth } } -- das rohe Browser-
// PushSubscription-Objekt (JSON.stringify(subscription) liefert genau
// dieses Format). Schreibt ueber den Service-Role-Client, da push_
// subscriptions bewusst keine Client-Policies hat (siehe Migration
// add_push_subscriptions_table) -- gleiche Begruendung wie report_configs.
//
// Upsert auf "endpoint" (unique): ein Geraet, das sich erneut anmeldet
// (z.B. nach Browser-Neustart), erzeugt keine doppelte Zeile.

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(req: NextRequest) {
  let body: SubscribeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { success: false, error: "endpoint, keys.p256dh und keys.auth sind erforderlich." },
      { status: 400 }
    );
  }

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert(
      { endpoint, p256dh, auth, user_agent: req.headers.get("user-agent") },
      { onConflict: "endpoint" }
    );

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
