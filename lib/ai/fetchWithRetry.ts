// Kurzer Retry-Helfer fuer den "Modell gerade ueberlastet"-Fall (Gemini HTTP
// 503, { status: "UNAVAILABLE" }) -- meist nur Sekunden-kurz unter hoher Last.
// Ohne Retry waeren Kacheln ohne Fallback-Provider sofort gescheitert.
//
// Nur 503 wird retried -- 4xx-Fehler (z.B. 429 Rate-Limit, 400 ungueltige
// Anfrage) aendern sich durch sofortiges Wiederholen nicht.
// Drei Versuche mit wachsendem Abstand: zwei kurze reichten am 12.10.2026
// nicht, Gemini meldete ueber mehrere Sekunden "high demand".
const RETRY_DELAYS_MS = [1500, 4000, 8000];

// Eigenes Zeitlimit je Fetch-Versuch: ohne Limit konnte ein haengender
// Provider das gesamte 60s-Budget einer Vercel-Funktion (Hobby-Plan)
// verbrauchen, bevor die Kette (router.ts) auf den naechsten Provider
// auswich. 12s war zu knapp (Gratis-Modelle brauchen unter Last 15-25s).
// Budget mit 20s: max. zwei echte Provider je Kette, drei System-Briefing-
// Teile laufen parallel (schlimmster Fall 2*20s=40s), danach eine kurze
// Synthese -- bleibt mit Puffer unter 60s. Kacheln mit hoeherem
// maxDuration duerfen per TileAIConfig.timeoutMs laenger warten.
export const PROVIDER_TIMEOUT_MS = 20000;

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS
): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Zeitueberschreitung nach ${timeoutMs / 1000}s (keine Antwort).`);
      }
      throw err;
    }
    if (res.status !== 503 || attempt >= RETRY_DELAYS_MS.length) return res;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
