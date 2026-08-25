import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: GROQ_API_KEY, GROQ_MODEL (z.B. "llama-..." – aktuelles Free-Tier-
// Modell zum Zeitpunkt der Aktivierung eintragen, kein Default hier, da
// Modell- und Limit-Angebote sich haeufig aendern). OpenAI-kompatible
// Chat-Completions-API, siehe openaiCompatible.ts.
export const groqProvider = createOpenAiCompatibleProvider({
  id: "groq",
  apiKeyEnvVar: "GROQ_API_KEY",
  baseUrl: "https://api.groq.com/openai/v1",
  modelEnvVar: "GROQ_MODEL",
});
