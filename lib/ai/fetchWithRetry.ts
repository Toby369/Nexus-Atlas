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

// 08.10.2026 -- Live-Vorfall: System-Briefing (drei parallele Teil-Aufrufe,
// danach ein sequenzieller Synthese-Aufruf, je bis zu zwei Provider in der
// Fallback-Kette) riss trotz des bereits auf PARALLEL umgestellten Aufbaus
// (siehe app/api/system-briefing/generate/route.ts) wieder Vercels harte
// 60s-Grenze (Hobby-Plan) -- bestaetigt per Vercel Runtime-Error-Log
// ("Task timed out after 60 seconds"), NICHT der zuvor behobene ungefangene
// Rate-Limit-Fehler. Ursache: kein Aufruf hatte je ein eigenes Zeitlimit --
// ein haengender/sehr langsamer Provider konnte die GESAMTE 60s-Budget
// alleine aufbrauchen, bevor ueberhaupt auf den naechsten Provider in der
// Kette ausgewichen wurde. Jetzt bekommt jeder einzelne Fetch-Versuch ein
// eigenes Zeitlimit -- ueberschritten, faellt die Kette (router.ts) sofort
// auf den naechsten Provider zurueck statt zu haengen.
//
// Erster Wert (12s) war zu knapp -- Live-Beweis noch am selben Tag: bei
// genau derselben Anfrage liefen SOWOHL Google ALS AUCH OpenRouter nach
// exakt 12s raus, beide offenbar noch an einer legitimen (nur etwas
// langsamen) Antwort arbeitend, kein echtes Haengenbleiben. Freie Gratis-
// Modelle brauchen unter Last gerne 15-25s. Jetzt 20s -- Budget-Rechnung:
// pro Kachel max. zwei echte Provider in der Kette (Google + OpenRouter,
// Deepseek ist unkonfiguriert und faellt ohne Netzwerk-Aufruf sofort durch),
// drei Kacheln laufen PARALLEL (schlimmster Fall also 2*20s=40s fuer die
// langsamste), danach EIN sequenzieller Synthese-Call (im Normalfall beim
// ersten Versuch erfolgreich, also nur wenige Sekunden) -- bleibt so mit
// Puffer unter den 60s, selbst wenn eine einzelne Kachel beide Provider
// braucht.
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
