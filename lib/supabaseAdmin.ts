import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase-Client mit Service-Role-Key -- umgeht RLS und darf
// NIEMALS aus einer "use client"-Komponente importiert werden (das
// "server-only"-Paket erzwingt das bereits zur Build-Zeit: ein versehentlicher
// Import aus Client-Code bricht den Build). Ausschliesslich fuer
// Server-Routen, die report_configs/report_runs schreiben -- alles Lesen im
// Dashboard laeuft weiterhin ueber den normalen Anon-Key-Client (lib/supabase.ts),
// RLS "Public read access" reicht dafuer aus (siehe Vorgabe Teil V: Keys nur
// serverseitig, nie im Client-Bundle).
//
// Der Client wird bewusst erst BEIM ERSTEN AUFRUF (nicht beim Modul-Import)
// erzeugt: Next.js wertet Route-Module bereits waehrend "next build" aus
// ("Collecting page data"), ohne dass zur Build-Zeit echte Request-Umgebungs-
// variablen vorliegen muessen. Ein Fehler beim Modul-Import wuerde dadurch den
// gesamten Build brechen, statt erst bei einem tatsaechlichen Request klar
// zu scheitern.
let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase-Service-Role-Umgebungsvariablen fehlen. Bitte SUPABASE_SERVICE_ROLE_KEY " +
        "server-seitig setzen (z.B. als Vercel Environment Variable, niemals mit " +
        "NEXT_PUBLIC_-Praefix)."
    );
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
