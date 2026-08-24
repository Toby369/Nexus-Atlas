import type { AIProvider, AIProviderId } from "../types";
import { openaiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { xaiProvider } from "./xai";
import { googleProvider } from "./google";
import { deepseekProvider } from "./deepseek";
import { perplexityProvider } from "./perplexity";

// Zentrale Registry: neuen Provider hinzufuegen = neue Datei unter
// lib/ai/providers/ anlegen (AIProvider-Interface implementieren) und hier
// eintragen. Kacheln und Router referenzieren Provider ausschliesslich ueber
// diese Registry, nie direkt.
export const providerRegistry: Record<AIProviderId, AIProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  xai: xaiProvider,
  google: googleProvider,
  deepseek: deepseekProvider,
  perplexity: perplexityProvider,
};

export function getProvider(id: AIProviderId): AIProvider {
  const provider = providerRegistry[id];
  if (!provider) {
    throw new Error(`Unbekannter AI Provider: ${id}`);
  }
  return provider;
}
