import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: PERPLEXITY_API_KEY, PERPLEXITY_MODEL (z.B. "sonar" o.ae. –
// aktuelles Modell zum Zeitpunkt der Aktivierung eintragen).
export const perplexityProvider = createOpenAiCompatibleProvider({
  id: "perplexity",
  apiKeyEnvVar: "PERPLEXITY_API_KEY",
  baseUrl: "https://api.perplexity.ai",
  modelEnvVar: "PERPLEXITY_MODEL",
});
