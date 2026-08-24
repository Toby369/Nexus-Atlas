import { createOpenAiCompatibleProvider } from "./openaiCompatible";

// Env-Vars: DEEPSEEK_API_KEY, DEEPSEEK_MODEL (z.B. "deepseek-chat" oder
// "deepseek-reasoner" – je nach Bedarf beim Aktivieren eintragen).
export const deepseekProvider = createOpenAiCompatibleProvider({
  id: "deepseek",
  apiKeyEnvVar: "DEEPSEEK_API_KEY",
  baseUrl: "https://api.deepseek.com",
  modelEnvVar: "DEEPSEEK_MODEL",
});
