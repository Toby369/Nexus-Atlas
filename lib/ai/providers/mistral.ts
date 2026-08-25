import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: MISTRAL_API_KEY, MISTRAL_MODEL (z.B. "mistral-small-..." –
// aktuelles Free-Tier-Modell zum Zeitpunkt der Aktivierung eintragen, kein
// Default hier). OpenAI-kompatible Chat-Completions-API.
export const mistralProvider = createOpenAiCompatibleProvider({
  id: "mistral",
  apiKeyEnvVar: "MISTRAL_API_KEY",
  baseUrl: "https://api.mistral.ai/v1",
  modelEnvVar: "MISTRAL_MODEL",
});
