import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: OPENROUTER_API_KEY, OPENROUTER_MODEL (z.B. ein Modell mit
// ":free"-Suffix fuer die kostenlosen Router-Modelle – aktuelles Angebot
// zum Zeitpunkt der Aktivierung eintragen, kein Default hier). OpenAI-
// kompatible Chat-Completions-API.
export const openrouterProvider = createOpenAiCompatibleProvider({
  id: "openrouter",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  baseUrl: "https://openrouter.ai/api/v1",
  modelEnvVar: "OPENROUTER_MODEL",
});
