import type {
  AIGenerateOptions,
  AIProvider,
  AIStructuredResult,
} from "../types";

// Env-Vars: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (Default unten ist der zum
// Zeitpunkt der Implementierung aktuelle Sonnet-Modellstring; per Env-Var
// override-bar, falls sich das aendert).
const DEFAULT_MODEL = "claude-sonnet-5";

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      `anthropic: Antwort war kein valides JSON. Rohtext (gekuerzt): ${cleaned.slice(0, 200)}`
    );
  }
}

async function callMessages(
  systemPrompt: string | undefined,
  userPrompt: string,
  options?: AIGenerateOptions
): Promise<{ content: string; model: string; usage?: { promptTokens?: number; completionTokens?: number } }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("anthropic: kein API-Key gesetzt (erwartet Env-Var ANTHROPIC_API_KEY).");
  }

  const model = options?.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`anthropic: HTTP ${res.status} – ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json?.content?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("anthropic: unerwartetes Antwortformat.");
  }

  return {
    content,
    model,
    usage: json?.usage
      ? {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
        }
      : undefined,
  };
}

export const anthropicProvider: AIProvider = {
  id: "anthropic",
  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },
  async generate(prompt: string, options?: AIGenerateOptions): Promise<string> {
    const { content } = await callMessages(options?.systemPrompt, prompt, options);
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

    const { content, model, usage } = await callMessages(systemPrompt, prompt, options);

    return {
      provider: "anthropic",
      model,
      data: extractJson(content) as T,
      raw: content,
      usage,
    };
  },
};
