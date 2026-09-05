import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedServiceRoleRequest, isPublicPath } from "@/lib/authGate";

// Phase 4: vollstaendiges Auth-Gate fuer die gesamte Anwendung (vorher nur
// /reports + /api/reports -- siehe Git-Historie fuer die urspruengliche,
// bewusst enger gefasste Begruendung "nur der Report-Bereich loest echte
// LLM-Kosten aus"). Diese Einschraenkung wurde ausdruecklich aufgehoben:
// Nexus Atlas ist ein persoenliches Marktueberwachungs-Tool (siehe Footer),
// kein oeffentliches Produkt -- jetzt ist buchstaeblich jede Seite/API-Route
// gesperrt, mit Ausnahme der Login-Seite selbst und statischer Assets, die
// der Browser/Service-Worker OHNE Session abrufen koennen muss (siehe
// lib/authGate.ts fuer die genaue Begruendung je Pfad und dessen Tests).
//
// Unauthentifizierte API-Aufrufe bekommen weiterhin strikt 401 (JSON, kein
// Redirect -- ein Redirect waere fuer einen fetch()-Aufruf nutzlos und
// wuerde den Fehler verschleiern). Seiten-Aufrufe werden auf /login
// umgeleitet.
//
// Datei heisst "proxy.ts", nicht "middleware.ts" -- dieses Next.js 16
// (siehe AGENTS.md-Warnung) hat die Konvention umbenannt ("middleware" ist
// seit v16.0.0 deprecated, "proxy" ist der Ersatz, per next build-Hinweis
// und node_modules/next/dist/docs/.../proxy.md verifiziert). API
// (NextRequest/NextResponse/config.matcher) ist identisch geblieben, nur
// Dateiname und Funktionsname aendern sich.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Server-zu-Server-Aufrufe (aktuell nur report-scheduler) duerfen sich
  // statt einer Nutzer-Session mit dem SUPABASE_SERVICE_ROLE_KEY als Bearer-
  // Token ausweisen -- siehe lib/authGate.ts fuer die vollstaendige
  // Begruendung (Audit-Fund 05.09.2026).
  if (
    isAuthorizedServiceRoleRequest(
      pathname,
      request.headers.get("Authorization"),
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  ) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api");

  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Fehlende Env-Vars sind ein Konfigurationsfehler, kein "kein Nutzer
    // eingeloggt" -- klar als 500 statt eines irrefuehrenden 401.
    if (isApi) {
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
    if (isApi) {
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
  // Alles ausser den Next.js-Build-internen Pfaden -- die eigentliche
  // Public/Protected-Unterscheidung passiert in isPublicPath()
  // (lib/authGate.ts), nicht hier im Matcher, damit die vollstaendige
  // Liste an einer testbaren Stelle steht.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
