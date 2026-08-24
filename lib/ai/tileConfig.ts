import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// Aktuell wird KEINE dieser Konfigurationen von der UI aufgerufen – die
// Kacheln bestehen weiterhin unveraendert. Das ist die vorbereitete
// Konfiguration fuer den Moment, in dem AI-Kacheln aktiviert werden.

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
};

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
