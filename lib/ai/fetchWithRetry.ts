// Kurzer Retry-Helfer fuer den "Modell gerade ueberlastet"-Fall (Gemini HTTP
// 503, { status: "UNAVAILABLE" }) -- ein bekanntes, meist Sekunden-kurzes
// Phaenomen bei Googles Flash-Modellen unter hoher Last, KEIN dauerhafter
// Ausfall (Live-Vorfall 18.09.2026: Chart-Vision UND System-Briefing
// scheiterten gleichzeitig an genau diesem 503, obwohl beide Kacheln
// bewusst OHNE Fallback-Provider konfiguriert sind -- "kostenlos"-Linie,
// siehe tileConfig.ts -- und ohne Retry damit komplett ohne Ausweg waren).
//
// Nur 503 wird retried -- 4xx-Fehler (z.B. 429 Rate-Limit, 400 ungueltige
// Anfrage) aendern sich durch sofortiges Wiederholen nicht, ein Retry dort
// waere nur verschwendete Zeit/Kontingent.
const RETRY_DELAYS_MS = [1000, 2500];

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, init);
    if (res.status !== 503 || attempt >= RETRY_DELAYS_MS.length) return res;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}
