import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizePlan } from "@/lib/dailyPlan";

// PUT /api/daily-plan { date: "YYYY-MM-DD", data }  -> Tagesplan speichern (upsert)
//
// Auth: proxy.ts sperrt jede /api/*-Route hinter eine Login-Session.
// Lesen laeuft direkt ueber den Anon-Key (Public read access), Schreiben nur
// hier mit Service-Role (daily_plans ist fuer anon nur lesbar).

const MAX_BYTES = 50_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PUT(request: Request) {
  let body: { date?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungültiges JSON im Request-Body." }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ success: false, error: "date muss im Format JJJJ-MM-TT sein." }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ success: false, error: "data fehlt." }, { status: 400 });
  }
  const data = normalizePlan(body.data);
  if (JSON.stringify(data).length > MAX_BYTES) {
    return NextResponse.json({ success: false, error: "Plan ist zu gross." }, { status: 413 });
  }
  try {
    const { error } = await getSupabaseAdmin()
      .from("daily_plans")
      .upsert({ plan_date: date, data, updated_at: new Date().toISOString() }, { onConflict: "plan_date" });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
