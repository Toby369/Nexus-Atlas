import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase-Client mit Service-Role-Key -- umgeht RLS und darf
// NIEMALS aus einer "use client"-Komponente importiert werden (das
// "server-only"-Paket erzwingt das bereits zur Build-Zeit: ein versehentlicher
// Import aus Client-Code bricht den Build). Ausschliesslich fuer
// Server-Routen, die report_configs/report_runs schreiben -- alles Lesen im
// Dashboard laeuft weiterhin ueber den normalen Anon-Key-Client (lib/supabase.ts),
// RLS "Public read access" reicht dafuer aus (siehe Vorgabe Teil V: Keys nur
// serverseitig, nie im Client-Bundle).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Supabase-Service-Role-Umgebungsvariablen fehlen. Bitte SUPABASE_SERVICE_ROLE_KEY " +
      "server-seitig setzen (z.B. als Vercel Environment Variable, niemals mit " +
      "NEXT_PUBLIC_-Praefix)."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
