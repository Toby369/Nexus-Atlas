// Kurzer Retry-Helfer fuer den "Modell gerade ueberlastet"-Fall (Gemini HTTP
// 503, { status: "UNAVAILABLE" }) -- meist nur Sekunden-kurz unter hoher Last.
// Ohne Retry waeren Kacheln ohne Fallback-Provider sofort gescheitert.
//
// Nur 503 wird retried -- 4xx-Fehler (z.B. 429 Rate-Limit, 400 ungueltige
// Anfrage) aendern sich durch sofortiges Wiederholen nicht.
const RETRY_DELAYS_MS = [1000, 2500];

// Eigenes Zeitlimit je Fetch-Versuch: ohne Limit konnte ein haengender
// Provider das gesamte 60s-Budget einer Vercel-Funktion (Hobby-Plan)
// verbrauchen, bevor die Kette (router.ts) auf den naechsten Provider
// auswich. 12s war zu knapp (Gratis-Modelle brauchen unter Last 15-25s).
// Budget mit 20s: max. zwei echte Provider je Kette, drei System-Briefing-
// Teile laufen parallel (schlimmster Fall 2*20s=40s), danach eine kurze
// Synthese -- bleibt mit Puffer unter 60s.
export const PROVIDER_TIMEOUT_MS = 20000;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Zeitueberschreitung nach ${PROVIDER_TIMEOUT_MS / 1000}s (keine Antwort).`);
      }
      throw err;
    }
    if (res.status !== 503 || attempt >= RETRY_DELAYS_MS.length) return res;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
