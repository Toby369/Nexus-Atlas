import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: XAI_API_KEY, XAI_MODEL (z.B. "grok-..." – aktuelles Modell zum
// Zeitpunkt der Aktivierung eintragen).
export const xaiProvider = createOpenAiCompatibleProvider({
  id: "xai",
  apiKeyEnvVar: "XAI_API_KEY",
  baseUrl: "https://api.x.ai/v1",
  modelEnvVar: "XAI_MODEL",
});
