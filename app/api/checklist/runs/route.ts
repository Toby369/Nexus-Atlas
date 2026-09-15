import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Snapshot-Protokoll der Wissens-Checklisten (Nutzer-Wunsch 15.09.2026,
// siehe Migration create_checklist_runs_table). Gleiches Muster wie
// /api/quiz/cards: Lesen laeuft direkt ueber den Anon-Key aus den
// Client-Komponenten (Public read access, siehe LernenDashboard.tsx),
// Schreiben ausschliesslich hier ueber den Service-Role-Client -- deshalb
// nur POST, kein GET (kein zweiter Lese-Pfad neben dem etablierten Muster).

const VALID_MODULES = new Set(["welz", "salomon", "mein_system"]);

// POST /api/checklist/runs -- neuen Snapshot anlegen ("Fertig"-Klick).
export async function POST(req: NextRequest) {
  let body: { module?: string; checkedItems?: string[]; totalCount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  if (!body.module || !VALID_MODULES.has(body.module)) {
    return NextResponse.json({ success: false, error: "module muss welz/salomon/mein_system sein." }, { status: 400 });
  }
  const checkedItems = Array.isArray(body.checkedItems) ? body.checkedItems : [];
  const totalCount = Number(body.totalCount);
  if (!Number.isFinite(totalCount) || totalCount < 0) {
    return NextResponse.json({ success: false, error: "totalCount ist erforderlich." }, { status: 400 });
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { data, error } = await admin
    .from("checklist_runs")
    .insert({
      module: body.module,
      checked_items: checkedItems,
      checked_count: checkedItems.length,
      total_count: totalCount,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, run: data });
}
