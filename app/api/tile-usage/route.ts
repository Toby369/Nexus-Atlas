import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isUsageItem } from "@/lib/tileUsage";

// POST /api/tile-usage { item } -- zaehlt eine Nutzung (Reiter, Kachel, Schritt).
// Auth: proxy.ts sperrt jede /api/*-Route hinter eine Login-Session.
export async function POST(request: Request) {
  let item: unknown;
  try {
    item = (await request.json())?.item;
  } catch {
    item = null;
  }
  if (!isUsageItem(item)) {
    return NextResponse.json({ success: false, error: "Ungültiger Eintrag." }, { status: 400 });
  }
  try {
    const { error } = await getSupabaseAdmin().from("tile_usage").insert({ item });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
