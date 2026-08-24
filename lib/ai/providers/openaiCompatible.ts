import type {
  AIGenerateOptions,
  AIProvider,
  AIProviderId,
  AIStructuredResult,
} from "../types";

// Mehrere Anbieter (OpenAI, xAI/Grok, DeepSeek, Perplexity) bieten eine
// weitgehend identische "/chat/completions"-API im OpenAI-Format an.
// Dieser Helper implementiert das gemeinsame Verhalten einmal, damit nicht
// vier Provider-Dateien denselben Fetch-Code duplizieren.

export interface OpenAiCompatibleConfig {
  id: AIProviderId;
  apiKeyEnvVar: string;
  baseUrl: string;
  /** Env-Var, ueber die das Default-Modell konfiguriert wird (z.B. "XAI_MODEL"). */
  modelEnvVar: string;
}

function extractJson(raw: string): unknown {
  // Manche Modelle umschliessen JSON trotz Anweisung mit ```json ... ```.
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleConfig
): AIProvider {
  function apiKey(): string | undefined {
    return process.env[config.apiKeyEnvVar];
  }

  function defaultModel(): string | undefined {
    return process.env[config.modelEnvVar];
  }

  async function callChatCompletion(
    messages: { role: string; content: string }[],
    options?: AIGenerateOptions
  ): Promise<{ content: string; model: string; usage?: { promptTokens?: number; completionTokens?: number } }> {
    const key = apiKey();
    if (!key) {
      throw new Error(
        `${config.id}: kein API-Key gesetzt (erwartet Env-Var ${config.apiKeyEnvVar}).`
      );
    }

    const model = options?.model ?? defaultModel();
    if (!model) {
      throw new Error(
        `${config.id}: kein Modell konfiguriert. Bitte ${config.modelEnvVar} setzen oder options.model uebergeben.`
      );
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${config.id}: HTTP ${res.status} – ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`${config.id}: unerwartetes Antwortformat.`);
    }

    return {
      content,
      model,
      usage: json?.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
          }
        : undefined,
    };
  }

  return {
    id: config.id,
    isConfigured(): boolean {
      return Boolean(apiKey());
    },
    async generate(prompt: string, options?: AIGenerateOptions): Promise<string> {
      const messages = options?.systemPrompt
        ? [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: prompt },
          ]
        : [{ role: "user", content: prompt }];
      const { content } = await callChatCompletion(messages, options);
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

      const { content, model, usage } = await callChatCompletion(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        options
      );

      return {
        provider: config.id,
        model,
        data: extractJson(content) as T,
        raw: content,
        usage,
      };
    },
  };
}
