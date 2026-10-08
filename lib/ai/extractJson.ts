// Gemeinsame JSON-Extraktion fuer alle Provider (08.10.2026, aus google.ts
// und providers/openaiCompatible.ts zusammengefuehrt -- vorher zwei
// identische Kopien derselben Funktion).
//
// Live-Vorfall: ein kostenloses OpenRouter-Modell stellte seiner JSON-
// Antwort eine Sicherheits-Einstufung voran ("User Safety: safe"), OHNE
// dass es sich um eine Verweigerung handelte -- der bisherige strikte
// Parse (alles-oder-nichts nach dem Entfernen von ```-Fences) scheiterte
// trotzdem, weil die GESAMTE Antwort kein valides JSON mehr war. Jetzt wird
// zusaetzlich das erste vollstaendige {...}- oder [...]-Objekt aus dem
// Rohtext herausgeschnitten, bevor geparst wird -- toleriert Praeambel-/
// Nachsatz-Text drumherum, den manche Gratis-Modelle trotz expliziter
// Anweisung ("AUSSCHLIESSLICH JSON") noch mitschicken. Die inhaltliche
// Validierung (promptProfiles.ts validate()) wird dadurch NICHT gelockert
// -- ist das extrahierte JSON strukturell falsch, faellt das dort weiterhin
// auf und loest wie bisher den naechsten Fallback-Provider aus.
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    const starts = [firstBrace, firstBracket].filter((i) => i !== -1);

    if (starts.length > 0) {
      const start = Math.min(...starts);
      const isObject = cleaned[start] === "{";
      const end = cleaned.lastIndexOf(isObject ? "}" : "]");
      if (end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          // Faellt unten durch zum urspruenglichen, aussagekraeftigeren Fehler.
        }
      }
    }

    throw new Error(
      `Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}
