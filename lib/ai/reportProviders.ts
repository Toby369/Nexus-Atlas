import type { AIProviderId } from "./types";

// Nutzer-Vorgabe (14.09.2026, im selben Atemzug wie "bis zu 3 Zeiten
// planen"): "muss kostenlos sein, gesamte AI report!" -- die AI Report
// Engine (report_configs Slot 1-4) darf NUR Provider mit echtem Gratis-Tier
// anbieten, dieselbe Haltung wie bereits bei trade-debate-referee/
// custom-query in lib/ai/tileConfig.ts ("komplett kostenlose Kette").
// OpenAI/Anthropic/xAI/Perplexity/DeepSeek sind kostenpflichtig ohne
// Gratis-Tier und werden hier bewusst NICHT aufgenommen, auch nicht als
// Fallback -- mehr geplante Laeufe pro Tag (bis zu 3x je Slot) erhoehen das
// Risiko unbemerkter Kosten, falls ein bezahlter Provider gewaehlt wuerde.
export const FREE_TIER_REPORT_PROVIDERS: AIProviderId[] = ["google", "groq", "mistral", "openrouter"];

export function isFreeTierReportProvider(id: string): id is AIProviderId {
  return (FREE_TIER_REPORT_PROVIDERS as string[]).includes(id);
}
