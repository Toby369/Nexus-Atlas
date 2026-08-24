import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: OPENAI_API_KEY, OPENAI_MODEL (z.B. "gpt-4.1" o.ae. – aktuelles
// Modell zum Zeitpunkt der Aktivierung selbst eintragen, kein Default hier,
// da Modellbezeichnungen sich schnell aendern).
export const openaiProvider = createOpenAiCompatibleProvider({
  id: "openai",
  apiKeyEnvVar: "OPENAI_API_KEY",
  baseUrl: "https://api.openai.com/v1",
  modelEnvVar: "OPENAI_MODEL",
});
