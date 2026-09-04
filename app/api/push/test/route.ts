import { NextResponse } from "next/server";

// POST /api/push/test -- ruft die send-state-change-push Edge Function mit
// { test: true } auf, die dann sofort eine feste Test-Nachricht an alle
// registrierten Subscriptions schickt, unabhaengig vom aktuellen Markt-
// zustand. Reiner Server-zu-Server-Aufruf (Edge Function hat verify_jwt:
// false, gleiches Muster wie alle Cron-Collectoren), kein Service-Role-
// Client noetig -- diese Route selbst liest/schreibt keine Tabelle.

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json(
      { success: false, error: "NEXT_PUBLIC_SUPABASE_URL fehlt." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-state-change-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    const data = await res.json();

    if (!res.ok || data.success === false) {
      return NextResponse.json(
        { success: false, error: data.error ?? `Edge Function antwortete mit ${res.status}` },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
