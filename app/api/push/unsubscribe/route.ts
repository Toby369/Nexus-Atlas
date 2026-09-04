import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// POST /api/push/unsubscribe
// Body: { endpoint } -- entfernt genau diese eine Subscription (ein
// Geraet/Browser). Gleiche Service-Role-Begruendung wie subscribe/route.ts.

export async function POST(req: NextRequest) {
  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  if (!body.endpoint) {
    return NextResponse.json({ success: false, error: "endpoint ist erforderlich." }, { status: 400 });
  }

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", body.endpoint);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
