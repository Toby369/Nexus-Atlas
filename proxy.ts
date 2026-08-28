import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Auth-Gate fuer /reports (Seite + alle zugehoerigen API-Route-Handler).
// Der Rest des Dashboards bleibt bewusst oeffentlich (reine Lese-Panels,
// Anon-Key, RLS "Public read access") -- nur der Report-Bereich loest
// echte LLM-Kosten pro Aufruf aus und wird deshalb serverseitig gesperrt,
// nicht nur im UI versteckt (Vorgabe: "keine UI-Renderung ohne Session").
//
// Unauthentifizierte API-Aufrufe bekommen strikt 401 (JSON, kein Redirect --
// ein Redirect waere fuer einen fetch()-Aufruf nutzlos und wuerde den
// Fehler verschleiern). Seiten-Aufrufe werden auf /login umgeleitet.
//
// Datei heisst "proxy.ts", nicht "middleware.ts" -- dieses Next.js 16
// (siehe AGENTS.md-Warnung) hat die Konvention umbenannt ("middleware" ist
// seit v16.0.0 deprecated, "proxy" ist der Ersatz, per next build-Hinweis
// und node_modules/next/dist/docs/.../proxy.md verifiziert). API
// (NextRequest/NextResponse/config.matcher) ist identisch geblieben, nur
// Dateiname und Funktionsname aendern sich.
const PROTECTED_PAGE_PREFIX = "/reports";
const PROTECTED_API_PREFIX = "/api/reports";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedApi = pathname.startsWith(PROTECTED_API_PREFIX);
  const isProtectedPage = pathname.startsWith(PROTECTED_PAGE_PREFIX);

  if (!isProtectedApi && !isProtectedPage) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Fehlende Env-Vars sind ein Konfigurationsfehler, kein "kein Nutzer
    // eingeloggt" -- klar als 500 statt eines irrefuehrenden 401.
    if (isProtectedApi) {
      return NextResponse.json(
        { success: false, error: "Supabase-Auth-Konfiguration fehlt serverseitig." },
        { status: 500 }
      );
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() (nicht getSession()) -- verifiziert das Session-Token gegen
  // den Supabase-Auth-Server statt nur das lokal gespeicherte Cookie zu
  // vertrauen (Supabase-eigene Empfehlung fuer Proxy/Middleware-Checks).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isProtectedApi) {
      return NextResponse.json(
        { success: false, error: "Nicht authentifiziert. Bitte zuerst einloggen." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/reports/:path*", "/api/reports/:path*"],
};
