import type { SupabaseClient } from "@supabase/supabase-js";

// Persistenter Rate-Limiter ueber die rate_limit_events-Tabelle (siehe
// Migration create_rate_limit_events) -- ein einfacher gleitendes-Fenster-
// Zaehler. Vercel Serverless Functions sind zustandslos, daher kein
// In-Memory-Zaehler; die Tabelle ist der gemeinsame Speicher ueber alle
// Function-Instanzen hinweg.
//
// Braucht einen Service-Role-Client (die Tabelle hat bewusst keine RLS-
// Policy fuer Anon-Zugriff, siehe Migration). Bewusst OHNE "server-only"
// (im Unterschied zu supabaseAdmin.ts/supabaseAuthServer.ts): diese
// Funktion liest weder process.env noch next/headers direkt, sondern nimmt
// einen bereits fertigen SupabaseClient als Parameter entgegen -- ein
// versehentlicher Client-Import waere hier toter Code, kein Secret-Leck.
// Ausserdem macht "server-only" das Modul unter Vitest (ausserhalb von
// Next.js' RSC-Bedingung) unbrauchbar, was direkte Unit-Tests (siehe
// rateLimit.test.ts) verhindern wuerde.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number | null;
}

export async function checkAndRecordRateLimit(
  supabaseAdmin: SupabaseClient,
  endpoint: string,
  windowMinutes: number,
  maxRequests: number
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count, error: countError } = await supabaseAdmin
    .from("rate_limit_events")
    .select("*", { count: "exact", head: true })
    .eq("endpoint", endpoint)
    .gte("created_at", windowStart);

  if (countError) {
    // Zaehler-Abfrage selbst fehlgeschlagen -- konservativ blockieren statt
    // eine defekte Rate-Limit-Pruefung stillschweigend zu umgehen.
    console.error(`Rate-Limit-Pruefung fuer "${endpoint}" fehlgeschlagen:`, countError.message);
    return { allowed: false, retryAfterSeconds: windowMinutes * 60 };
  }

  if ((count ?? 0) >= maxRequests) {
    return { allowed: false, retryAfterSeconds: windowMinutes * 60 };
  }

  // Zaehlt jeden AUFRUF-VERSUCH (nicht nur erfolgreiche Laeufe) -- ein
  // Angreifer, der gezielt Fehler ausloest, soll trotzdem geblockt werden.
  const { error: insertError } = await supabaseAdmin
    .from("rate_limit_events")
    .insert({ endpoint });
  if (insertError) {
    console.error(`Rate-Limit-Eintrag fuer "${endpoint}" konnte nicht geschrieben werden:`, insertError.message);
  }

  return { allowed: true, retryAfterSeconds: null };
}
