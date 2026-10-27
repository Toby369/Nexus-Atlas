import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// POST /api/own-zones { price }  -> Zone anlegen
// DELETE /api/own-zones { id }   -> Zone loeschen
//
// Auth: proxy.ts sperrt jede /api/*-Route hinter eine Login-Session.
// Schreiben nur mit Service-Role (own_zones ist fuer anon nur lesbar).

const MAX_ZONES = 12;

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const price = typeof body?.price === "number" ? body.price : Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ success: false, error: "Ungültiger Preis." }, { status: 400 });
  }
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { count } = await supabaseAdmin.from("own_zones").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_ZONES) {
      return NextResponse.json({ success: false, error: `Höchstens ${MAX_ZONES} Zonen.` }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("own_zones").insert({ price });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ success: false, error: "Ungültige ID." }, { status: 400 });
  }
  try {
    const { error } = await getSupabaseAdmin().from("own_zones").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
