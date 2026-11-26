import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// GET /api/journal?days=90  -> Trades aus dem AutarkTrade-Journal (Toby 26.11.2026)
//
// PRIVAT: autark_trades hat keine Lese-Policy, nur die Service-Role liest.
// Auth: proxy.ts sperrt jede /api/*-Route hinter eine Login-Session, diese
// Route steht bewusst NICHT in SERVICE_ROLE_BEARER_PATHS. Texte sind schon
// beim Sync zu reinem Text gemacht; die Oberflaeche zeigt sie nie als HTML.
// In AutarkTrade geloeschte Trades kommen nur mit ?deleted=1.

const MAX_DAYS = 400;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get("days")) || 90));
  const withDeleted = url.searchParams.get("deleted") === "1";
  try {
    let q = getSupabaseAdmin()
      .from("autark_trades")
      .select("*")
      .gte("entry_time", new Date(Date.now() - days * 86_400_000).toISOString())
      .order("entry_time", { ascending: false })
      .limit(1000);
    if (!withDeleted) q = q.is("deleted_in_autark_at", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, days, trades: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
