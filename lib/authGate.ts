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
