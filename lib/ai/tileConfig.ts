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
    aiProvider: "auto", // -> anthropic (signal-logic)
    promptProfile: "signal-analysis",
    fallbackProviders: ["deepseek"],
  },
  // Umsetzungsplan Phase 3 (05.09.2026): erste tatsaechlich aus der UI
  // aufgerufene Kachel dieser Konfiguration (siehe app/api/handelslage/
  // generate/route.ts) -- Provider-Aufloesung/Fallback-Kette waren zuvor
  // nur ueber runReportAnalysis() (report_configs-Slots) im produktiven
  // Einsatz, hier zum ersten Mal ueber runTileAnalysis()/"auto".
  handelslage: {
    tileId: "handelslage",
    aiProvider: "auto", // -> anthropic (signal-logic)
    promptProfile: "handelslage",
    fallbackProviders: ["google", "openai"],
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
};

// Provider-Ensemble fuer die Eskalations-Kachel -- drei unabhaengige
// Vendors, bewusst ohne Perplexity (Web-Suche wuerde hier externe, nicht im
// Kontext enthaltene Informationen einbringen statt einer unabhaengigen
// Lesart DERSELBEN Daten).
export const ESCALATION_PROVIDER_ENSEMBLE = ["anthropic", "google", "mistral"] as const;

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
