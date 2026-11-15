import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DWELL_MAX_SECONDS, isUsageItem } from "@/lib/tileUsage";

// POST /api/tile-usage { item, seconds? } -- zaehlt eine Nutzung (Reiter, Kachel,
// Schritt) oder meldet die Verweildauer eines Reiters ("dwell:*" mit Sekunden).
// Auth: proxy.ts sperrt jede /api/*-Route hinter eine Login-Session.
export async function POST(request: Request) {
  let item: unknown;
  let seconds: unknown;
  try {
    const body = await request.json();
    item = body?.item;
    seconds = body?.seconds;
  } catch {
    item = null;
  }
  if (!isUsageItem(item)) {
    return NextResponse.json({ success: false, error: "Ungültiger Eintrag." }, { status: 400 });
  }
  const isDwell = item.startsWith("dwell:");
  const secs = Number(seconds);
  if (isDwell && !(Number.isInteger(secs) && secs >= 1 && secs <= DWELL_MAX_SECONDS)) {
    return NextResponse.json({ success: false, error: "Ungültige Dauer." }, { status: 400 });
  }
  try {
    const { error } = await getSupabaseAdmin()
      .from("tile_usage")
      .insert(isDwell ? { item, seconds: secs } : { item });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
