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
// /api/youtube-monitor/generate ergaenzt (08.09.2026, Nutzer-Wunsch:
// taeglich automatischer YouTube-Check 30 Min nach dem verlaesslichsten
// Kanal-Post + Push-Benachrichtigung) -- dieselbe Begruendung, neue Edge
// Function "youtube-monitor-scheduler" ruft die Route per pg_cron ohne
// Nutzer-Session auf.
//
// Fund 09.09.2026 (Nutzer-Meldung "keine Push-Nachricht bekommen"): die
// urspruengliche Loesung (SUPABASE_SERVICE_ROLE_KEY als Bearer-Token, "kein
// neues Secret") hat in Produktion NIE zuverlaessig funktioniert -- Live-Test
// gegen youtube-monitor-scheduler ergab weiterhin 401 "Nicht authentifiziert",
// UND report_runs hatte trotz des angeblichen Fixes seit dem 27.08.2026 immer
// noch keine neue Zeile. Ursache nicht abschliessend geklaert (moeglich:
// process.env.SUPABASE_SERVICE_ROLE_KEY in proxy.ts driftet vom aktuellen,
// automatisch von Supabase injizierten Wert der Edge Functions ab) --
// unabhaengig davon ist das Wiederverwenden des Service-Role-Keys (voller
// DB-Bypass) als HTTP-Bearer-Token ohnehin ein unnoetig hohes Risiko fuer
// einen reinen Cron-Trigger. Ersetzt durch ein dediziertes, eng geschnittenes
// CRON_SECRET -- eigener Wert, eigenes Vercel-Env-Var, eigenes Supabase-Edge-
// Function-Secret, unabhaengig vom DB-Master-Key rotierbar.
export const SERVICE_ROLE_BEARER_PATHS: ReadonlySet<string> = new Set([
  "/api/reports/run",
  "/api/youtube-monitor/generate",
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
