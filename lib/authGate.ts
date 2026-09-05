// Phase 4: welche Pfade das vollstaendige Auth-Gate in proxy.ts OHNE
// Session passieren duerfen. Als reine, von Next.js/Supabase entkoppelte
// Funktion ausgelagert, damit sie unit-testbar ist (proxy.ts selbst laesst
// sich nicht sinnvoll mit vitest testen, da es echte NextRequest/
// NextResponse-Objekte sowie einen Netzwerkzugriff auf Supabase braucht).

// Exakte Pfade, die OHNE Session erreichbar bleiben muessen:
// - /login: die Login-Seite selbst -- sonst Redirect-Schleife.
// - /auth/confirm: serverseitiger Bestaetigungs-Endpoint fuer Einladungs-/
//   Passwort-Reset-Mails (app/auth/confirm/route.ts, 01.09.2026) --
//   verifiziert token_hash+type BEVOR ueberhaupt eine Session existiert;
//   waere er hier nicht gelistet, wuerde proxy.ts den Aufruf samt Token
//   sofort nach /login umleiten, ohne dass verifyOtp() je laeuft.
// - /favicon.ico, /apple-icon.png, /manifest.webmanifest: von Next.js
//   generierte Metadaten-Routen, die Browser/OS ohne jeden App-Kontext
//   abrufen (Tab-Icon, "Zum Homescreen hinzufuegen").
// - /sw.js, /offline.html: der Service Worker (public/sw.js) wird von
//   ServiceWorkerRegister.tsx im Root-Layout auf JEDER Seite inkl. /login
//   registriert, und cacht /offline.html + die Icons unten waehrend seines
//   eigenen "install"-Events via cache.addAll() -- ein einziger
//   401/Redirect in dieser Liste laesst cache.addAll() insgesamt
//   fehlschlagen (siehe MDN: Cache.addAll wirft, wenn irgendeine Antwort
//   nicht ok ist), womit die komplette Offline-Faehigkeit fuer
//   nicht eingeloggte Aufrufe der Login-Seite bricht.
export const PUBLIC_EXACT_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/auth/confirm",
  "/favicon.ico",
  "/apple-icon.png",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
]);

// Pfad-Praefixe, die OHNE Session erreichbar bleiben muessen:
// - /_next/static, /_next/image: Next.js-Build-Assets/Bildoptimierung,
//   enthalten nie App-/Nutzerdaten.
// - /icons/: PWA-Icons (manifest.ts), vom Service Worker in denselben
//   cache.addAll()-Aufruf wie /offline.html eingeschlossen (s.o.).
export const PUBLIC_PREFIXES: readonly string[] = ["/_next/static", "/_next/image", "/icons/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Audit-Fund 05.09.2026: /api/reports/run ist zu Recht NICHT public (siehe
// oben), aber report-scheduler (Supabase Edge Function, pg_cron alle 5 Min)
// ruft genau diese Route als Server-zu-Server-fetch OHNE Nutzer-Session auf --
// das Auth-Gate hat das seit Phase 4 (vollstaendiges Gate statt nur /reports)
// ausnahmslos mit 401 abgelehnt, unbemerkt, weil report-scheduler den Fehler
// nur in seiner eigenen (nirgends gelesenen) Response protokolliert statt ihn
// sichtbar zu machen. report_runs hatte dadurch seit dem 27.08.2026 keine neue
// Zeile mehr, obwohl alle 4 Report-Slots aktiv und terminiert sind.
//
// Fix: report-scheduler darf sich stattdessen mit dem SUPABASE_SERVICE_ROLE_KEY
// als Bearer-Token ausweisen -- KEIN neues Secret, sondern derselbe Key, den
// die Edge Function ohnehin automatisch von der Supabase-Plattform injiziert
// bekommt und den /api/reports/run selbst schon fuer supabaseAdmin nutzt
// (lib/supabaseAdmin.ts). Vertrauensniveau ist identisch zu einem direkten
// DB-Zugriff mit diesem Key -- nur eben ueber HTTP statt Postgres-Wire-
// Protokoll. Der normale Login-Session-Weg (z.B. der "Jetzt ausfuehren"-
// Button im Dashboard) bleibt fuer alle anderen Aufrufer unveraendert.
export const SERVICE_ROLE_BEARER_PATHS: ReadonlySet<string> = new Set(["/api/reports/run"]);

export function isAuthorizedServiceRoleRequest(
  pathname: string,
  authorizationHeader: string | null,
  expectedServiceRoleKey: string | undefined
): boolean {
  if (!SERVICE_ROLE_BEARER_PATHS.has(pathname)) return false;
  if (!expectedServiceRoleKey || !authorizationHeader) return false;
  return authorizationHeader === `Bearer ${expectedServiceRoleKey}`;
}
