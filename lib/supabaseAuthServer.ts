import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Session-bewusster Supabase-Client fuer Server Components und Route
// Handler -- im Unterschied zu lib/supabase.ts (fester Anon-Key-Client
// ohne Session, fuer alle oeffentlichen Lese-Panels) liest dieser Client
// die Session aus den Request-Cookies, damit Server-seitig geprueft werden
// kann, ob ein eingeloggter Nutzer vorliegt (Vorgabe: Auth-Gate fuer
// /reports). Nutzt weiterhin den Anon-Key -- RLS bleibt unveraendert,
// dieser Client bekommt keine erweiterten Rechte, nur eine Session-Identitaet.
//
// "server-only" wie in supabaseAdmin.ts: next/headers ist ohnehin nur
// serverseitig nutzbar, ein versehentlicher Client-Import bricht den Build.
export async function getSupabaseAuthServer() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase-Umgebungsvariablen fehlen. Bitte NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY setzen."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In einer Server Component (nicht in einem Route Handler/Server
        // Action) wirft cookies().set() -- die Session-Erneuerung passiert
        // dort bereits im middleware.ts, dieser Aufruf hier ist dann ein
        // no-op-Versuch und darf den Seitenaufbau nicht crashen lassen.
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Siehe Kommentar oben -- erwartbar in Server Components.
        }
      },
    },
  });
}
