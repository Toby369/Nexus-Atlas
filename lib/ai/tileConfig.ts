import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// Alle Eintraege sind produktiv angebunden (nie genutzte Profile wurden
// entfernt).
//
// Anthropic steht in KEINER Kette: die App soll durchgehend kostenlos
// bleiben (Anthropic hat kein Gratis-Tier). Ein frueherer Fallback landete
// bei einem Google-503 beim bezahlten Anthropic und verursachte Kosten, obwohl
// der Aufruf scheiterte. Faellt die kostenlose Kette einer Kachel komplett
// aus, schlaegt sie deshalb fehl statt bezahlt auszuweichen -- bewusst.
// eines bezahlten Fallbacks -- bewusst in Kauf genommen.

// 2 Provider je Kette * 40s = 80s fuer die parallelen Teile, dasselbe fuer
// die Synthese -- 160s, unter maxDuration=300 der Briefing-Route.
const BRIEFING_TIMEOUT_MS = 40_000;

// Gemini-Gratis-Tarif: jedes Modell hat ein EIGENES Limit von 20 Anfragen pro
// Tag und 5 pro Minute (Google AI Studio, Stand 14.10.2026). Bis dahin lagen
// fast alle Aufrufe auf 3.6/3.7/3.8 Flash und rissen deren Tageslimit (30/20,
// 30/20, 23/20), waehrend 2.5 Flash und 2.5 Flash Lite ungenutzt blieben.
// Deshalb feste Zuteilung je Aufgabe und eine Gemini-interne Ausweichkette
// (googleModels), bevor ein anderer Provider einspringt.
export const GEMINI_MODELS = {
  /** Briefing: Regelwerk. */
  flash37: "gemini-3.7-flash",
  /** Briefing: Synthese. */
  flash38: "gemini-3.8-flash",
  /** YouTube-Monitor (Video per URL, viele Tokens) -- siehe youtubeVideoAnalysis.ts. */
  flash36: "gemini-3.6-flash",
  /** Trade-Debate, Rueckblick, Eskalation und Ersatz fuers Briefing. */
  flash25: "gemini-2.5-flash",
  /** Letzter Gemini-Ersatz (10 Anfragen pro Minute). */
  flashLite25: "gemini-2.5-flash-lite",
} as const;

const GEMINI_SHARED = [GEMINI_MODELS.flash25, GEMINI_MODELS.flashLite25];

export const tileConfigs: Record<string, TileAIConfig> = {
  // System-Briefing (siehe promptProfiles.ts/systemBriefingContext.ts):
  // deckt auch Handelslage und den Konsistenz-Check der frueheren Signal
  // Engine ab. Strukturell vier Teil-Aufrufe (siehe Kopfkommentar in
  // promptProfiles.ts); kostenloser Fallback je Teil, kein bezahlter
  // Provider (siehe Anthropic-Linie oben).
  //
  // Verteilung -- gemessen in den Vercel-Logs (Live-Laeufe nach Umstellung
  // auf 40s-Limit):
  // - Groq: 1,5-4s je Teil, jeder Versuch erfolgreich -- aber Gratis-Tier
  //   mit Tageslimit, das auch Eskalation, Trade-Debate-Referee und mehrere
  //   Fallbacks nutzen. Daher nur die zwei kleinen Teile (Chart, Trigger).
  // - Google: 19-25s, teils Zeitueberschreitung. Traegt Regelwerk (3.7 Flash)
  //   und Synthese (3.8 Flash), je mit 2.5 Flash und 2.5 Flash Lite als
  //   Gemini-Ersatz (siehe GEMINI_MODELS). Groq springt erst ein, wenn kein
  //   Gemini-Modell antwortet.
  // - Mistral: jeder Versuch HTTP 429 (Rate limit exceeded) -- vermutlich
  //   durch den frueheren Mistral-Slot der AI Reports ausgelastet.
  // - OpenRouter: Antwort "User Safety: safe" (Moderations-Modell statt
  //   JSON) oder Zeitueberschreitung; hing schon frueher bei Kursziel-
  //   Szenarien (siehe promptProfiles.ts).
  // Mistral, OpenRouter und DeepSeek (nicht konfiguriert) stehen deshalb in
  // keiner Briefing-Kette.
  "system-briefing-regelwerk": {
    tileId: "system-briefing-regelwerk",
    aiProvider: "google",
    googleModels: [GEMINI_MODELS.flash37, ...GEMINI_SHARED],
    promptProfile: "system-briefing-regelwerk",
    fallbackProviders: ["groq"],
    timeoutMs: BRIEFING_TIMEOUT_MS,
  },
  "system-briefing-chart": {
    tileId: "system-briefing-chart",
    aiProvider: "groq",
    promptProfile: "system-briefing-chart",
    fallbackProviders: ["google"],
    googleModels: GEMINI_SHARED,
    timeoutMs: BRIEFING_TIMEOUT_MS,
  },
  "system-briefing-trigger": {
    tileId: "system-briefing-trigger",
    aiProvider: "groq",
    promptProfile: "system-briefing-trigger",
    fallbackProviders: ["google"],
    googleModels: GEMINI_SHARED,
    timeoutMs: BRIEFING_TIMEOUT_MS,
  },
  "system-briefing-synthese": {
    tileId: "system-briefing-synthese",
    aiProvider: "google",
    googleModels: [GEMINI_MODELS.flash38, ...GEMINI_SHARED],
    promptProfile: "system-briefing-synthese",
    fallbackProviders: ["groq"],
    timeoutMs: BRIEFING_TIMEOUT_MS,
  },
  // Eskalation: aiProvider ist nur ein Platzhalter --
  // app/api/escalation/generate/route.ts ruft runTileAnalysis() mehrfach mit
  // explizitem providerOverride auf (je ein unabhaengiger Provider). Bewusst
  // KEINE fallbackProviders: ein ausgefallener Provider gilt als
  // fehlgeschlagen, sonst waere die "unabhaengige" Meinung heimlich eine
  // zweite Meinung desselben Vendors. Kostenlos gehalten, falls er doch
  // direkt griffe.
  escalation: {
    tileId: "escalation",
    aiProvider: "groq",
    promptProfile: "escalation-analysis",
    fallbackProviders: [],
    googleModels: GEMINI_SHARED,
  },
  // Trade-Debate: app/api/trade-debate/generate/route.ts ruft Bull und Bear
  // mit ABSICHTLICH unterschiedlichem primaeren Vendor auf (kein gemeinsamer
  // Modell-Bias), danach den Referee mit beiden Ergebnissen. Anders als bei
  // "escalation" MIT fallbackProviders -- mit nur 2 Analysten soll ein
  // einzelner Ausfall nicht die ganze Debatte platzen lassen.
  "trade-debate-bull": {
    tileId: "trade-debate-bull",
    aiProvider: "google",
    promptProfile: "trade-bull-analyst",
    fallbackProviders: ["openrouter"],
    googleModels: GEMINI_SHARED,
  },
  "trade-debate-bear": {
    tileId: "trade-debate-bear",
    aiProvider: "openrouter",
    promptProfile: "trade-bear-analyst",
    fallbackProviders: ["google"],
    googleModels: GEMINI_SHARED,
  },
  // Referee: Groq (erwartet GROQ_MODEL="openai/gpt-oss-120b", Free-Tier) --
  // stark bei Reasoning/Mathe und ein von Bull (Google) und Bear (OpenRouter)
  // unabhaengiger dritter Vendor. Fallback-Kette bewusst ohne bezahlte
  // Provider.
  "trade-debate-referee": {
    tileId: "trade-debate-referee",
    aiProvider: "groq",
    promptProfile: "trade-referee",
    fallbackProviders: ["google", "openrouter"],
    googleModels: GEMINI_SHARED,
  },
  // Periodischer KI-Rueckblick: liest ausschliesslich signal_stats_results,
  // kein eigener Bias -- ein "zweites Paar Augen" auf bereits berechnete
  // Zahlen. Woechentlich vom signal-review-scheduler-Cron ausgeloest.
  "signal-review": {
    tileId: "signal-review",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "signal-review",
    fallbackProviders: ["openrouter", "deepseek"],
    googleModels: GEMINI_SHARED,
  },
};

// Provider-Ensemble fuer die Eskalation -- vier unabhaengige, kostenlose
// Vendors, bewusst ohne Perplexity (Web-Suche wuerde externe Informationen
// einbringen statt einer unabhaengigen Lesart DERSELBEN Daten).
// computeEscalationConsensus() und die "min. 2 Reads"-Schwelle sind
// unabhaengig von der Ensemble-Groesse.
export const ESCALATION_PROVIDER_ENSEMBLE = ["groq", "google", "mistral", "openrouter"] as const;

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
