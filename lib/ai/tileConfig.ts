import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// Die meisten Eintraege hier sind weiterhin vorbereitete Konfiguration ohne
// UI-Anbindung (die jeweilige Kachel bleibt regelbasiert). "handelslage" ist
// seit Umsetzungsplan Phase 3 (05.09.2026) die erste tatsaechlich produktiv
// aufgerufene -- siehe app/api/handelslage/generate/route.ts.

export const tileConfigs: Record<string, TileAIConfig> = {
  "open-interest": {
    tileId: "open-interest",
    aiProvider: "auto", // -> xai (market-mechanics), siehe Rollen-Doku
    promptProfile: "oi-analysis",
    fallbackProviders: ["google", "anthropic"],
  },
  funding: {
    tileId: "funding",
    aiProvider: "auto",
    promptProfile: "funding-analysis",
    fallbackProviders: ["google", "anthropic"],
  },
  liquidations: {
    tileId: "liquidations",
    aiProvider: "auto",
    promptProfile: "liquidation-analysis",
    fallbackProviders: ["google", "anthropic"],
  },
  "market-structure": {
    tileId: "market-structure",
    aiProvider: "auto",
    promptProfile: "market-structure",
    fallbackProviders: ["google", "anthropic"],
  },
  news: {
    tileId: "news",
    aiProvider: "auto", // -> perplexity (research)
    promptProfile: "news-analysis",
    fallbackProviders: ["google"],
  },
  macro: {
    tileId: "macro",
    aiProvider: "auto",
    promptProfile: "macro-analysis",
    fallbackProviders: ["google"],
  },
  "etf-flows": {
    tileId: "etf-flows",
    aiProvider: "auto",
    promptProfile: "etf-analysis",
    fallbackProviders: ["google"],
  },
  "ai-market-analysis": {
    tileId: "ai-market-analysis",
    aiProvider: "auto", // -> openai (orchestration)
    promptProfile: "market-intelligence",
    fallbackProviders: ["anthropic"],
  },
  "signal-engine": {
    tileId: "signal-engine",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "signal-analysis",
    // Anthropic bewusst ans ENDE verschoben (Nutzer-Entscheidung 07.09.2026,
    // nach einem Anthropic-Ausfall am selben Tag): springt nur noch ein,
    // wenn OpenRouter UND DeepSeek (letzterer ohne gesetzten Key ohnehin
    // ein Sofort-Fehlschlag) beide scheitern -- nicht mehr primaer.
    fallbackProviders: ["openrouter", "deepseek", "anthropic"],
  },
  // Umsetzungsplan Phase 3 (05.09.2026): erste tatsaechlich aus der UI
  // aufgerufene Kachel dieser Konfiguration (siehe app/api/handelslage/
  // generate/route.ts) -- Provider-Aufloesung/Fallback-Kette waren zuvor
  // nur ueber runReportAnalysis() (report_configs-Slots) im produktiven
  // Einsatz, hier zum ersten Mal ueber runTileAnalysis()/"auto".
  handelslage: {
    tileId: "handelslage",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "handelslage",
    // Anthropic bewusst ans ENDE verschoben, siehe Kommentar bei
    // "signal-engine" oben -- dieselbe Nutzer-Entscheidung, google ist
    // jetzt primaer statt Fallback.
    fallbackProviders: ["openai", "anthropic"],
  },
  // Eskalations-Kachel ("gezielte Eskalation", 05.09.2026): aiProvider hier
  // ist nur ein Platzhalter -- app/api/escalation/generate/route.ts ruft
  // runTileAnalysis() mehrfach mit explizitem providerOverride auf (je ein
  // konfigurierter, unabhaengiger Provider). Bewusst KEINE fallbackProviders:
  // faellt einer der drei Provider aus, soll er als fehlgeschlagen gelten
  // statt durch einen anderen Vendor ersetzt zu werden -- sonst waere die
  // "unabhaengige dritte Meinung" heimlich eine zweite Meinung desselben
  // Vendors wie ein anderer Ensemble-Slot.
  escalation: {
    tileId: "escalation",
    aiProvider: "anthropic",
    promptProfile: "escalation-analysis",
    fallbackProviders: [],
  },
  // Trade-Debate-Kachel (Nutzer-Idee 07.09.2026): app/api/trade-debate/
  // generate/route.ts ruft Bull und Bear mit je eigenem, ABSICHTLICH
  // unterschiedlichem primaeren Vendor auf (kein gemeinsamer Modell-Bias
  // in beiden "Seiten" der Debatte), danach den Referee mit beiden
  // Ergebnissen im Kontext. Anders als bei "escalation" MIT
  // fallbackProviders -- hier soll ein einzelner Provider-Ausfall nicht
  // gleich die ganze Debatte platzen lassen (es gibt nur 2 Analysten, kein
  // Ensemble mit Redundanz).
  "trade-debate-bull": {
    tileId: "trade-debate-bull",
    aiProvider: "google",
    promptProfile: "trade-bull-analyst",
    fallbackProviders: ["openrouter"],
  },
  "trade-debate-bear": {
    tileId: "trade-debate-bear",
    aiProvider: "openrouter",
    promptProfile: "trade-bear-analyst",
    fallbackProviders: ["google"],
  },
  // Referee-Provider (Nutzer-Entscheidung 08.09.2026, "ich moechte
  // kostenlos"): Anthropic (kostenpflichtig, kein Gratis-Tier) durch Groq
  // ersetzt -- erwartetes Modell GROQ_MODEL="openai/gpt-oss-120b" (Groq
  // Free-Tier, kein Kreditkarten-Zwang). Laut Recherche (Artificial-
  // Analysis-Intelligence-Index, 08.09.2026) klar staerker bei Reasoning/
  // Mathe als Mistral Small (Index 24 vs. 15-20) und ein von Bull (Google)
  // und Bear (OpenRouter) unabhaengiger dritter Vendor -- kein Modell-Bias
  // mit einer der beiden Debatten-Seiten. Fallback-Kette bewusst OHNE
  // Anthropic: die ganze Trade-Debate-Kachel soll durchgehend kostenlos
  // bleiben, auch im Fallback-Fall.
  "trade-debate-referee": {
    tileId: "trade-debate-referee",
    aiProvider: "groq",
    promptProfile: "trade-referee",
    fallbackProviders: ["google", "openrouter"],
  },
};

// Provider-Ensemble fuer die Eskalations-Kachel -- unabhaengige Vendors,
// bewusst ohne Perplexity (Web-Suche wuerde hier externe, nicht im Kontext
// enthaltene Informationen einbringen statt einer unabhaengigen Lesart
// DERSELBEN Daten). OpenRouter als viertes Mitglied ergaenzt (Nutzer-Wunsch
// 07.09.2026) -- computeEscalationConsensus()/die "min. 2 Reads"-Schwelle in
// der Route sind unabhaengig von der Ensemble-Groesse, keine Anpassung dort
// noetig.
export const ESCALATION_PROVIDER_ENSEMBLE = ["anthropic", "google", "mistral", "openrouter"] as const;

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
