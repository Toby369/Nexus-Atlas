import { fetchWithRetry } from "./fetchWithRetry";

// Chart-Vision (Umsetzungsplan "Chart-Vision: LSOB & Trendlinien lesen",
// Phase 3 des Trading-Entscheidungsunterstuetzungs-Fahrplans) -- bewusst
// NICHT ueber den generischen AI-Router (lib/ai/router.ts/AIProvider-
// Interface): dessen generateStructured() nimmt nur einen reinen Text-
// Prompt entgegen, hier wird aber ein hochgeladenes Bild per inline_data
// direkt an Gemini uebergeben (multimodaler Content-Block). Gleiches
// Grundmuster wie lib/ai/youtubeVideoAnalysis.ts (dort file_data/file_uri
// fuer eine Video-URL) -- hier inline_data/base64 fuer ein tatsaechlich
// hochgeladenes Bild statt einer oeffentlichen URL.
//
// Hintergrund: LSOB ("Liquidity Sweep Order Block", Claudius Vertesi) ist
// ein closed-source TradingView-Indikator -- anders als GUSS (dessen Regel
// vollstaendig bekannt und in lib/tradingIndicatorsContext.ts als reine
// Berechnung nachgebaut ist) kann LSOB nicht reverse-engineered werden, nur
// sein bereits korrektes visuelles Ergebnis gelesen werden. Gleiches gilt
// fuer Tobys frei Hand gezeichnete Trendlinien -- die existieren
// ausschliesslich als Pixel in seiner TradingView-Ansicht.
//
// WICHTIG (Namens-Kollision): Nexus hat bereits ein UNVERWANDTES, selbst
// gebautes TradingView-Alert-Feature namens "Liquidity Sweep"
// (docs/tradingview/nexus-liquidity-sweep.pine, lib/webhookTradingView.ts,
// lib/tradingViewSignal.ts, Divergence Radar) -- dieses Modul heisst
// bewusst "chartVision"/"lsob", nicht "liquiditySweep", um Verwechslung zu
// vermeiden.
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

export interface ChartVisionResult {
  overallReadability: "clear" | "partial" | "illegible";
  lsob: {
    visible: boolean;
    zoneCount: number | null;
    description: string;
    relationToPrice: "above" | "below" | "at" | "mixed" | "unclear";
  };
  trendlines: {
    visible: boolean;
    count: number | null;
    description: string;
    relationToPrice: string;
  };
  // Nur gesetzt, wenn im Bild eindeutig als Achsen-/Preis-Label lesbar --
  // NIE aus der Pixel-Position eines Elements geschaetzt (keine erfundene
  // Praezision).
  visiblePriceLabel: string | null;
  confidence: number;
  caveats: string[];
  summary: string;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      `chartVisionAnalysis: Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}

const READABILITY_VALUES = ["clear", "partial", "illegible"];
const PRICE_RELATION_VALUES = ["above", "below", "at", "mixed", "unclear"];

function validate(data: unknown): string[] {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;

  if (!READABILITY_VALUES.includes(d?.overallReadability as string)) {
    errors.push(`"overallReadability" muss einer von ${READABILITY_VALUES.join(", ")} sein.`);
  }

  const lsob = d?.lsob as Record<string, unknown> | undefined;
  if (typeof lsob?.visible !== "boolean") {
    errors.push(`"lsob.visible" muss ein Boolean sein.`);
  }
  if (lsob?.zoneCount !== null && typeof lsob?.zoneCount !== "number") {
    errors.push(`"lsob.zoneCount" muss eine Zahl oder null sein.`);
  }
  if (typeof lsob?.description !== "string") {
    errors.push(`"lsob.description" muss ein String sein.`);
  }
  if (!PRICE_RELATION_VALUES.includes(lsob?.relationToPrice as string)) {
    errors.push(`"lsob.relationToPrice" muss einer von ${PRICE_RELATION_VALUES.join(", ")} sein.`);
  }

  const trendlines = d?.trendlines as Record<string, unknown> | undefined;
  if (typeof trendlines?.visible !== "boolean") {
    errors.push(`"trendlines.visible" muss ein Boolean sein.`);
  }
  if (trendlines?.count !== null && typeof trendlines?.count !== "number") {
    errors.push(`"trendlines.count" muss eine Zahl oder null sein.`);
  }
  if (typeof trendlines?.description !== "string") {
    errors.push(`"trendlines.description" muss ein String sein.`);
  }
  if (typeof trendlines?.relationToPrice !== "string") {
    errors.push(`"trendlines.relationToPrice" muss ein String sein.`);
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
  "Marktueberwachungs-Tool. Der Screenshot zeigt zwei Elemente, die NICHT strukturiert berechnet " +
  "werden koennen, weil ihre Logik nicht offenliegt bzw. nur als Handzeichnung existiert: " +
  "(1) LSOB (\"Liquidity Sweep Order Block\")-Zonen, eingezeichnet von einem geschlossenen " +
  "Drittanbieter-Indikator, und (2) vom Nutzer selbst per Hand eingezeichnete Trendlinien. Du " +
  "siehst NUR das Pixelbild, keine Rohdaten.\n\n" +
  "Beschreibe was du siehst: Sind LSOB-Zonen sichtbar, wie viele, liegen sie ueber/unter/" +
  "unmittelbar am aktuellen Kurs? Wie viele Trendlinien sind erkennbar, in welche Richtung " +
  "verlaufen sie, naehert sich der Kurs einer Linie an oder hat er sie durchbrochen? Beschreibe " +
  "Lage/Charakter qualitativ -- erfinde KEINE exakten Preiswerte, wenn du sie nicht eindeutig aus " +
  "beschrifteten Achsen/Labels im Bild ablesen kannst. Falls ein aktueller Kurs/Preis-Label im " +
  "Bild lesbar ist, gib ihn wieder (als Kontext, nicht als praezise Marktdatenquelle -- Nexus hat " +
  "dafuer eigene Live-Daten).\n\n" +
  "Sei ehrlich ueber Unsicherheit: ist der Screenshot unscharf, ein Element nicht erkennbar oder " +
  "mehrdeutig, sag das explizit (overallReadability + caveats) statt zu raten oder Praezision " +
  "vorzutaeuschen, die du nicht hast.\n\n" +
  "WICHTIG: Das hier ist reine Entscheidungsunterstuetzung, KEIN Handelssignal und keine " +
  "Anlageberatung. Du bewertest nicht, ob ein Trade sinnvoll ist -- du beschreibst nur, was LSOB " +
  "und die Trendlinien aktuell zeigen.\n\n" +
  "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: overallReadability (\"clear\"|\"partial\"|" +
  "\"illegible\"), lsob (Objekt: visible [boolean], zoneCount [Zahl oder null], description " +
  "[string], relationToPrice [\"above\"|\"below\"|\"at\"|\"mixed\"|\"unclear\"]), trendlines " +
  "(Objekt: visible [boolean], count [Zahl oder null], description [string], relationToPrice " +
  "[string]), visiblePriceLabel (string oder null), confidence (0-100), caveats (string[]), " +
  "summary (string, deutsch, 2-4 Saetze).";

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
      generationConfig: { temperature: 0.3, maxOutputTokens: 1536 },
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
