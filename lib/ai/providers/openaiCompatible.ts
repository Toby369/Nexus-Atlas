import type {
  AIGenerateOptions,
  AIProvider,
  AIProviderId,
  AIStructuredResult,
} from "../types";
import { extractJson } from "../extractJson";
import { PROVIDER_TIMEOUT_MS } from "../fetchWithRetry";

// Laengste Wartezeit, die bei einem 429 noch abgewartet wird -- passt mit dem
// Briefing-Zeitlimit je Versuch (40s) und maxDuration der Route zusammen.
const MAX_RATE_LIMIT_WAIT_SECONDS = 25;

/**
 * Wartezeit aus einer 429-Antwort: Retry-After-Header (Sekunden) oder der
 * Fehlertext ("Please try again in 18.525s" / "in 1m2.5s"). null = keine
 * Angabe gefunden.
 */
export function retryAfterSeconds(header: string | null, body: string): number | null {
  const fromHeader = header !== null ? Number(header) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) return fromHeader;
  const match = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(body);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]);
}

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
    const timeoutMs = options?.timeoutMs ?? PROVIDER_TIMEOUT_MS;
    if (!model) {
      throw new Error(
        `${config.id}: kein Modell konfiguriert. Bitte ${config.modelEnvVar} setzen oder options.model uebergeben.`
      );
    }

    // AbortSignal.timeout() gilt fuer die GESAMTE Fetch-Lebensdauer
    // (Verbindungsaufbau UND Body-Lesen). EIN try/catch umschliesst deshalb
    // den gesamten Ablauf (Fetch + Status-Check + JSON-Parsing) -- sonst
    // kaeme ein Timeout waehrend res.json() als roher DOMException-Text
    // durch.
    try {
      const send = () => fetch(`${config.baseUrl}/chat/completions`, {
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
        signal: AbortSignal.timeout(timeoutMs),
      });

      let res = await send();
      // Minutenlimit (HTTP 429, z.B. Groqs Token-pro-Minute-Grenze): nennt der
      // Anbieter eine kurze Wartezeit, einmal warten und erneut senden, statt
      // die Kette scheitern zu lassen (Vorfall 12.10.2026: Briefing-Teile
      // parallel auf Groq rissen das 8000-TPM-Limit, "try again in 18.5s").
      if (res.status === 429) {
        const waitSeconds = retryAfterSeconds(res.headers.get("retry-after"), await res.clone().text().catch(() => ""));
        if (waitSeconds !== null && waitSeconds <= MAX_RATE_LIMIT_WAIT_SECONDS) {
          await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 0.5) * 1000));
          res = await send();
        }
      }

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
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `${config.id}: Zeitueberschreitung nach ${timeoutMs / 1000}s (keine Antwort).`
        );
      }
      throw err;
    }
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
