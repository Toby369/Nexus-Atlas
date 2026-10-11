// Gemeinsame JSON-Extraktion fuer alle Provider.
//
// Schneidet das erste vollstaendige {...}- oder [...]-Objekt aus dem Rohtext,
// bevor geparst wird -- manche Gratis-Modelle schicken trotz Anweisung
// ("AUSSCHLIESSLICH JSON") Praeambel-Text mit (z.B. "User Safety: safe").
// Die inhaltliche Validierung (promptProfiles.ts validate()) wird dadurch
// NICHT gelockert -- strukturell falsches JSON faellt dort weiterhin auf und
// loest den naechsten Fallback-Provider aus.
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
