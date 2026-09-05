// Krypto-YouTube-Monitor (05.09.2026) -- bewusst NICHT ueber den generischen
// AI-Router (lib/ai/router.ts/AIProvider-Interface): dessen
// generateStructured() nimmt nur einen reinen Text-Prompt entgegen, hier
// wird aber ein Video per file_data/file_uri direkt an Gemini uebergeben
// (multimodaler Content-Block) -- Gemini analysiert Bild+Ton+Text des
// YouTube-Videos direkt per URL, ohne Download/Transkript-Schritt. Laut
// Google aktuell in Preview und kostenlos (Stand Recherche 05.09.2026),
// nur mit Flash-Modellen der aktuellen Generation.
//
// Env-Vars: GOOGLE_API_KEY (bereits fuer andere Kacheln konfiguriert),
// GOOGLE_VIDEO_MODEL optional (Flash-Modell mit Video-URL-Unterstuetzung --
// faellt auf GOOGLE_MODEL zurueck, wenn nicht gesetzt. Ein Pro-Modell in
// GOOGLE_MODEL wuerde hier vermutlich fehlschlagen oder nicht mehr im
// kostenlosen Kontingent laufen -- im Zweifel GOOGLE_VIDEO_MODEL explizit
// auf ein aktuelles Flash-Modell setzen, siehe Google AI Studio).

export interface YoutubeVideoAnalysisResult {
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  relevance: "high" | "medium" | "low";
  summary: string;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      `youtubeVideoAnalysis: Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}

const BIAS_VALUES = ["bullish", "bearish", "neutral"];
const RELEVANCE_VALUES = ["high", "medium", "low"];

function validate(data: unknown): string[] {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;
  if (!BIAS_VALUES.includes(d?.bias as string)) {
    errors.push(`"bias" muss einer von ${BIAS_VALUES.join(", ")} sein.`);
  }
  if (typeof d?.confidence !== "number" || d.confidence < 0 || d.confidence > 100) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }
  if (!RELEVANCE_VALUES.includes(d?.relevance as string)) {
    errors.push(`"relevance" muss einer von ${RELEVANCE_VALUES.join(", ")} sein.`);
  }
  if (typeof d?.summary !== "string" || d.summary.length === 0) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }
  return errors;
}

const SYSTEM_PROMPT =
  "Du analysierst ein YouTube-Video fuer Nexus, ein persoenliches BTC-Marktueberwachungs-Tool. " +
  "Du bekommst das Video direkt (Bild, Ton, ggf. eingeblendeten Text) sowie Titel/Kanal als Zusatzinfo. " +
  "Fasse zusammen, was im Video inhaltlich zu Bitcoin/Krypto gesagt wird, relevant fuer den BTC-Markt " +
  "-- keine Meinung von dir selbst, sondern was das Video tatsaechlich aussagt. Ist das Video nicht " +
  "wirklich BTC-/Krypto-marktrelevant (z.B. Anfaenger-Tutorial ohne Marktbezug, Off-Topic), sag das " +
  "explizit und setze relevance auf 'low' statt eine Relevanz zu konstruieren. Erfinde keine Aussagen, " +
  "die im Video nicht vorkommen. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: " +
  "bias (bullish|bearish|neutral -- die im Video vertretene Markteinschaetzung, neutral wenn keine klare " +
  "Richtung erkennbar ist), confidence (0-100, wie eindeutig diese Einschaetzung im Video vertreten wird), " +
  "relevance (high|medium|low, wie marktrelevant der Inhalt ist), summary (string, deutsch, 2-4 Saetze).";

export async function analyzeYoutubeVideo(
  videoUrl: string,
  contextText: string
): Promise<{ result: YoutubeVideoAnalysisResult; model: string }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("youtubeVideoAnalysis: kein API-Key gesetzt (erwartet Env-Var GOOGLE_API_KEY).");
  }

  const model = process.env.GOOGLE_VIDEO_MODEL ?? process.env.GOOGLE_MODEL;
  if (!model) {
    throw new Error(
      "youtubeVideoAnalysis: kein Modell konfiguriert. Bitte GOOGLE_VIDEO_MODEL (empfohlen: aktuelles " +
        "Gemini-Flash-Modell mit Video-URL-Unterstuetzung) oder GOOGLE_MODEL setzen."
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ file_data: { file_uri: videoUrl } }, { text: contextText }],
        },
      ],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `youtubeVideoAnalysis: HTTP ${res.status} bei Modell "${model}" -- ${errText.slice(0, 300)} ` +
        `(falls das Modell keine Video-URL-Analyse unterstuetzt: GOOGLE_VIDEO_MODEL auf ein aktuelles ` +
        `Gemini-Flash-Modell setzen, siehe Google AI Studio).`
    );
  }

  const json = await res.json();
  const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("youtubeVideoAnalysis: unerwartetes Antwortformat (keine Textantwort).");
  }

  const data = extractJson(content);
  const errors = validate(data);
  if (errors.length > 0) {
    throw new Error(`youtubeVideoAnalysis: Antwort entspricht nicht dem Schema: ${errors.join("; ")}`);
  }

  return { result: data as YoutubeVideoAnalysisResult, model };
}
