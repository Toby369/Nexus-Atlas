import type { AIProviderId } from "./types";

// Die AI Report Engine (report_configs Slot 1-4) darf NUR Provider mit echtem
// Gratis-Tier anbieten -- dieselbe Haltung wie bei den Kacheln in
// lib/ai/tileConfig.ts. OpenAI/Anthropic/xAI/Perplexity/DeepSeek sind
// kostenpflichtig und bewusst NICHT aufgenommen, auch nicht als Fallback --
// mehrere geplante Laeufe pro Tag erhoehen das Risiko unbemerkter Kosten.
export const FREE_TIER_REPORT_PROVIDERS: AIProviderId[] = ["google", "groq", "mistral", "openrouter"];

export function isFreeTierReportProvider(id: string): id is AIProviderId {
  return (FREE_TIER_REPORT_PROVIDERS as string[]).includes(id);
}
