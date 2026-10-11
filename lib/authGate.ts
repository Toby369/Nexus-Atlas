// Phase 4: welche Pfade das vollstaendige Auth-Gate in proxy.ts OHNE
// Session passieren duerfen. Als reine, von Next.js/Supabase entkoppelte
// Funktion ausgelagert, damit sie unit-testbar ist (proxy.ts selbst laesst
// sich nicht sinnvoll mit vitest testen, da es echte NextRequest/
// NextResponse-Objekte sowie einen Netzwerkzugriff auf Supabase braucht).

// Exakte Pfade, die OHNE Session erreichbar bleiben muessen:
// - /login: die Login-Seite selbst -- sonst Redirect-Schleife.
// - /auth/confirm: serverseitiger Bestaetigungs-Endpoint fuer Einladungs-/
//   Passwort-Reset-Mails (app/auth/confirm/route.ts) --
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

// Server-zu-Server-Aufrufe ohne Nutzer-Session (Supabase Edge Functions per
// pg_cron) duerfen sich mit CRON_SECRET als Bearer-Token ausweisen:
// - /api/reports/run: report-scheduler (alle 5 Min). Ohne diese Ausnahme
//   lehnte das Gate die Laeufe unbemerkt mit 401 ab -- report_runs bekam
//   wochenlang keine neue Zeile.
// - /api/youtube-monitor/generate: youtube-monitor-scheduler (taeglicher
//   Check + Push).
// - /api/signal-review/generate: signal-review-scheduler (woechentlich,
//   direkt nach compute_signal_stats()).
// - /api/divergence-radar/snapshot: divergence-radar-scheduler (alle 15 Min,
//   persistiert einen Radar-Snapshot).
//
// Bewusst ein dediziertes, eng geschnittenes CRON_SECRET statt des
// SUPABASE_SERVICE_ROLE_KEY: der Service-Role-Key (voller DB-Bypass) als
// HTTP-Bearer-Token waere ein unnoetig hohes Risiko und funktionierte in
// Produktion auch nicht zuverlaessig. CRON_SECRET ist ein eigener Wert
// (Vercel-Env + Edge-Function-Secret), unabhaengig rotierbar.
export const SERVICE_ROLE_BEARER_PATHS: ReadonlySet<string> = new Set([
  "/api/reports/run",
  "/api/youtube-monitor/generate",
  "/api/signal-review/generate",
  "/api/divergence-radar/snapshot",
]);

export function isAuthorizedServiceRoleRequest(
  pathname: string,
  authorizationHeader: string | null,
  expectedCronSecret: string | undefined
): boolean {
  if (!SERVICE_ROLE_BEARER_PATHS.has(pathname)) return false;
  if (!expectedCronSecret || !authorizationHeader) return false;
  return authorizationHeader === `Bearer ${expectedCronSecret}`;
}
