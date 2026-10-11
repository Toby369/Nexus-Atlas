import type {
  AIGenerateOptions,
  AIProvider,
  AIStructuredResult,
} from "../types";
import { fetchWithRetry, PROVIDER_TIMEOUT_MS } from "../fetchWithRetry";
import { extractJson } from "../extractJson";

// Env-Vars: GOOGLE_API_KEY, GOOGLE_MODEL (z.B. "gemini-..." – aktuelles
// Modell zum Zeitpunkt der Aktivierung eintragen, kein Default hier).
//
// Free-Tier, kein Billing-Konto verknuepft -- Anfragen ueber dem
// Gratis-Kontingent werden abgelehnt, nicht abgerechnet. Teil der bewusst
// kostenlos gehaltenen Kacheln (siehe tileConfig.ts) und darf nicht ohne
// Absprache durch einen kostenpflichtigen Anbieter ersetzt werden.

async function callGenerateContent(
  systemPrompt: string | undefined,
  userPrompt: string,
  options?: AIGenerateOptions
): Promise<{ content: string; model: string }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("google: kein API-Key gesetzt (erwartet Env-Var GOOGLE_API_KEY).");
  }

  const model = options?.model ?? process.env.GOOGLE_MODEL;
  if (!model) {
    throw new Error(
      "google: kein Modell konfiguriert. Bitte GOOGLE_MODEL setzen oder options.model uebergeben."
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const contents = [{ role: "user", parts: [{ text: userPrompt }] }];
  const timeoutMs = options?.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  // Siehe openaiCompatible.ts: AbortSignal.timeout() in fetchWithRetry() gilt
  // fuer die GESAMTE Fetch-Lebensdauer inkl. res.json() -- EIN try/catch um
  // den gesamten Ablauf, damit auch ein Timeout beim Body-Lesen sauber als
  // "google: Zeitueberschreitung..." gemeldet wird.
  try {
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: systemPrompt
          ? { parts: [{ text: systemPrompt }] }
          : undefined,
        generationConfig: {
          temperature: options?.temperature,
          maxOutputTokens: options?.maxTokens,
        },
      }),
    }, timeoutMs);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`google: HTTP ${res.status} – ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string") {
      throw new Error("google: unerwartetes Antwortformat.");
    }

    return { content, model };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`google: Zeitueberschreitung nach ${timeoutMs / 1000}s (keine Antwort).`);
    }
    throw err;
  }
}

export const googleProvider: AIProvider = {
  id: "google",
  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_API_KEY);
  },
  async generate(prompt: string, options?: AIGenerateOptions): Promise<string> {
    const { content } = await callGenerateContent(options?.systemPrompt, prompt, options);
    return content;
  },
  async generateStructured<T = unknown>(
    prompt: string,
    options?: AIGenerateOptions
  ): Promise<AIStructuredResult<T>> {
    const jsonInstruction =
      "Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt, ohne Markdown-Codeblock, ohne Erklaertext davor oder danach.";
    const systemPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${jsonInstruction}`
      : jsonInstruction;

    const { content, model } = await callGenerateContent(systemPrompt, prompt, options);

    return {
      provider: "google",
      model,
      data: extractJson(content) as T,
      raw: content,
    };
  },
};
