import { fetchWithRetry } from "./fetchWithRetry";

// Chart-Vision (Umsetzungsplan "Chart-Vision: Trendlinien lesen", Phase 3
// des Trading-Entscheidungsunterstuetzungs-Fahrplans) -- bewusst NICHT
// ueber den generischen AI-Router (lib/ai/router.ts/AIProvider-Interface):
// dessen generateStructured() nimmt nur einen reinen Text-Prompt entgegen,
// hier wird aber ein hochgeladenes Bild per inline_data direkt an Gemini
// uebergeben (multimodaler Content-Block). Gleiches Grundmuster wie
// lib/ai/youtubeVideoAnalysis.ts (dort file_data/file_uri fuer eine Video-
// URL) -- hier inline_data/base64 fuer ein tatsaechlich hochgeladenes Bild
// statt einer oeffentlichen URL.
//
// Hintergrund: Tobys frei Hand eingezeichnete Trendlinien existieren
// ausschliesslich als Pixel in seiner TradingView-Ansicht -- anders als
// GUSS/VWAP-Vector/CVD (deren Regeln vollstaendig bekannt und in
// lib/tradingIndicatorsContext.ts als reine Berechnung nachgebaut sind)
// gibt es dafuer keine zugrunde liegende Formel, die Nexus selbst
// nachrechnen koennte -- nur das bereits gezeichnete Ergebnis kann gelesen
// werden.
//
// Umbau 25.09.2026 (Nutzer-Vorgabe "systematisch, strukturiert", LSOB
// raus): frueher analysierte diese Kachel zusaetzlich LSOB ("Liquidity
// Sweep Order Block")-Zonen eines geschlossenen Drittanbieter-Indikators
// (Claudius Vertesi) -- LSOB wurde ersatzlos entfernt (Nutzer-Entscheidung,
// keine fachliche Begruendung noetig). Gleichzeitig von "ein Zaehler + ein
// Freitext" auf eine strukturierte Liste (ein Objekt je erkannter Linie)
// umgestellt, siehe ChartVisionTrendline unten.
//
// Env-Vars: GOOGLE_API_KEY (bereits fuer andere Kacheln konfiguriert),
// GOOGLE_VISION_MODEL optional (Flash-Modell mit Bild-Unterstuetzung --
// faellt auf GOOGLE_MODEL zurueck, wenn nicht gesetzt). Bewusst eine
// EIGENE Variable statt GOOGLE_VIDEO_MODEL wiederzuverwenden: dessen
// Kommentar bindet es explizit an "Video-URL-Unterstuetzung" (file_data/
// file_uri) -- ein kuenftiger Modellwechsel aus Video-Gruenden soll nicht
// versehentlich auch die Bild-Analyse hier beeinflussen (und umgekehrt).

// Traegt den HTTP-Status des fehlgeschlagenen Gemini-Aufrufs mit -- der
// Aufrufer (app/api/chart-vision/generate/route.ts) muss zwischen einem
// Kontingent-Fehler (429) und einem sonstigen Fehler unterscheiden koennen,
// ohne den Fehlertext zu parsen (gleiches Prinzip wie
// YoutubeVideoAnalysisError).
export class ChartVisionAnalysisError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ChartVisionAnalysisError";
    this.status = status;
  }
}

// Eine erkannte Trendlinie -- ein Objekt je sichtbarer Linie statt (wie vor
// dem 25.09.2026-Umbau) ein einzelner Zaehler + ein Freitext fuer alle
// Linien zusammen.
export interface ChartVisionTrendline {
  direction: "up" | "down" | "horizontal";
  priceRelation: "above" | "below" | "touching" | "broken_through";
}

export interface ChartVisionResult {
  overallReadability: "clear" | "partial" | "illegible";
  // Leeres Array = keine Trendlinie erkannt (nicht null/undefined -- ein
  // eindeutiger, immer vorhandener Zustand statt eines dritten "visible"-
  // Flags).
  trendlines: ChartVisionTrendline[];
  // Nur gesetzt, wenn im Bild eindeutig als Achsen-/Preis-Label lesbar --
  // NIE aus der Pixel-Position eines Elements geschaetzt (keine erfundene
  // Praezision).
  visiblePriceLabel: string | null;
  confidence: number;
  caveats: string[];
  summary: string;
}

// Bug 24.09.2026 (von Toby per Screenshot gemeldet): die Anweisung
// "antworte AUSSCHLIESSLICH mit JSON" im Prompt reichte nicht -- die Antwort
// enthielt zusaetzlich sichtbaren Reasoning-Flusstext vor dem eigentlichen
// JSON-Objekt (z.B. "5. Final Polish: Let's double-check values..."), was
// den reinen Anker-Regex (nur Codefence exakt am Stringanfang/-ende) zum
// Scheitern brachte. Fix zweigleisig: (1) generationConfig.responseMimeType
// unten erzwingt bei Gemini reines JSON serverseitig (behebt die Ursache),
// (2) hier zusaetzlich als Fallback die erste {...}-Klammer im Rohtext
// herausschneiden, falls trotzdem noch Text drumherum steht.
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // faellt durch zum Fehler unten
      }
    }
    throw new Error(
      `chartVisionAnalysis: Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}

const READABILITY_VALUES = ["clear", "partial", "illegible"];
const TRENDLINE_DIRECTION_VALUES = ["up", "down", "horizontal"];
const TRENDLINE_PRICE_RELATION_VALUES = ["above", "below", "touching", "broken_through"];

function validate(data: unknown): string[] {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;

  if (!READABILITY_VALUES.includes(d?.overallReadability as string)) {
    errors.push(`"overallReadability" muss einer von ${READABILITY_VALUES.join(", ")} sein.`);
  }

  if (!Array.isArray(d?.trendlines)) {
    errors.push(`"trendlines" muss ein Array sein.`);
  } else {
    d.trendlines.forEach((entry, i) => {
      const t = entry as Record<string, unknown>;
      if (!TRENDLINE_DIRECTION_VALUES.includes(t?.direction as string)) {
        errors.push(`"trendlines[${i}].direction" muss einer von ${TRENDLINE_DIRECTION_VALUES.join(", ")} sein.`);
      }
      if (!TRENDLINE_PRICE_RELATION_VALUES.includes(t?.priceRelation as string)) {
        errors.push(
          `"trendlines[${i}].priceRelation" muss einer von ${TRENDLINE_PRICE_RELATION_VALUES.join(", ")} sein.`
        );
      }
    });
  }

  if (d?.visiblePriceLabel !== null && typeof d?.visiblePriceLabel !== "string") {
    errors.push(`"visiblePriceLabel" muss ein String oder null sein.`);
  }
  if (typeof d?.confidence !== "number" || d.confidence < 0 || d.confidence > 100) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }
  if (!Array.isArray(d?.caveats) || !d.caveats.every((c) => typeof c === "string")) {
    errors.push(`"caveats" muss ein Array von Strings sein.`);
  }
  if (typeof d?.summary !== "string" || d.summary.length === 0) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }

  return errors;
}

const SYSTEM_PROMPT =
  "Du analysierst einen Chart-Screenshot aus TradingView fuer Nexus, ein persoenliches BTC-" +
  "Marktueberwachungs-Tool. Der Screenshot zeigt vom Nutzer selbst per Hand eingezeichnete " +
  "Trendlinien -- diese existieren ausschliesslich als Pixel in seiner TradingView-Ansicht, nicht " +
  "strukturiert zugaenglich. Du siehst NUR das Pixelbild, keine Rohdaten.\n\n" +
  "Gehe systematisch in dieser Reihenfolge vor:\n" +
  "1. Schaetze zuerst die Gesamt-Lesbarkeit des Screenshots ein.\n" +
  "2. Identifiziere JEDE einzelne sichtbar eingezeichnete Trendlinie einzeln (nicht als eine " +
  "zusammengefasste Beschreibung). Bestimme fuer jede: Richtung (steigend/fallend/horizontal) und " +
  "Verhaeltnis zum aktuellen Kurs (Kurs liegt darueber, liegt darunter, beruehrt die Linie gerade, " +
  "oder hat sie bereits durchbrochen). Ist keine Trendlinie sichtbar, liefere eine leere Liste, " +
  "erfinde keine.\n" +
  "3. Falls ein aktueller Kurs/Preis-Label eindeutig als Achsen-/Preis-Beschriftung im Bild " +
  "lesbar ist, gib ihn wieder (als Kontext, nicht als praezise Marktdatenquelle -- Nexus hat " +
  "dafuer eigene Live-Daten). Erfinde KEINEN Preiswert aus der Pixel-Position einer Linie.\n" +
  "4. Sei ehrlich ueber Unsicherheit: ist der Screenshot unscharf oder eine Linie nicht eindeutig " +
  "zuordenbar, spiegle das in overallReadability und caveats wider, statt zu raten oder Praezision " +
  "vorzutaeuschen, die du nicht hast.\n\n" +
  "WICHTIG: Das hier ist reine Entscheidungsunterstuetzung, KEIN Handelssignal und keine " +
  "Anlageberatung. Du bewertest nicht, ob ein Trade sinnvoll ist -- du beschreibst nur, was die " +
  "Trendlinien aktuell zeigen.\n\n" +
  "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: overallReadability (\"clear\"|\"partial\"|" +
  "\"illegible\"), trendlines (Array, ein Objekt je sichtbarer Linie: direction " +
  "[\"up\"|\"down\"|\"horizontal\"], priceRelation [\"above\"|\"below\"|\"touching\"|" +
  "\"broken_through\"]), visiblePriceLabel (string oder null), confidence (0-100), caveats " +
  "(string[]), summary (string, deutsch, 2-4 Saetze).";

export async function analyzeChartVision(
  imageBase64: string,
  mimeType: string,
  note: string | null
): Promise<{ result: ChartVisionResult; model: string }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("chartVisionAnalysis: kein API-Key gesetzt (erwartet Env-Var GOOGLE_API_KEY).");
  }

  const model = process.env.GOOGLE_VISION_MODEL ?? process.env.GOOGLE_MODEL;
  if (!model) {
    throw new Error(
      "chartVisionAnalysis: kein Modell konfiguriert. Bitte GOOGLE_VISION_MODEL (empfohlen: " +
        "aktuelles Gemini-Flash-Modell mit Bild-Unterstuetzung) oder GOOGLE_MODEL setzen."
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const contextText = note && note.trim().length > 0
    ? `Zusaetzliche Notiz von Toby zu diesem Screenshot: ${note.trim()}`
    : "Keine zusaetzliche Notiz -- analysiere ausschliesslich anhand des Bildes.";

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: contextText }],
        },
      ],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.3, maxOutputTokens: 1536, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ChartVisionAnalysisError(
      `chartVisionAnalysis: HTTP ${res.status} bei Modell "${model}" -- ${errText.slice(0, 300)} ` +
        `(falls das Modell keine Bild-Analyse unterstuetzt: GOOGLE_VISION_MODEL auf ein aktuelles ` +
        `Gemini-Flash-Modell setzen, siehe Google AI Studio).`,
      res.status
    );
  }

  const json = await res.json();
  const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("chartVisionAnalysis: unerwartetes Antwortformat (keine Textantwort).");
  }

  const data = extractJson(content);
  const errors = validate(data);
  if (errors.length > 0) {
    throw new Error(`chartVisionAnalysis: Antwort entspricht nicht dem Schema: ${errors.join("; ")}`);
  }

  return { result: data as ChartVisionResult, model };
}
