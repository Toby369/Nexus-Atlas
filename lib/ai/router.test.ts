import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIGenerateOptions } from "./types";

const calls: { provider: string; model?: string; retryOnOverload?: boolean }[] = [];
let failing = new Set<string>();
let timingOut = new Set<string>();

function fakeProvider(id: string) {
  return {
    id,
    isConfigured: () => true,
    generate: async () => "",
    generateStructured: async (_prompt: string, options?: AIGenerateOptions) => {
      calls.push({ provider: id, model: options?.model, retryOnOverload: options?.retryOnOverload });
      const key = options?.model ? `${id}:${options.model}` : id;
      if (failing.has(key)) throw new Error(`${key}: HTTP 503`);
      if (timingOut.has(key)) throw new Error(`${key}: Zeitueberschreitung nach 40s (keine Antwort).`);
      return { provider: id, model: options?.model ?? "default", data: { ok: true }, raw: "{}" };
    },
  };
}

vi.mock("./providers", () => ({ getProvider: (id: string) => fakeProvider(id) }));
vi.mock("./promptProfiles", () => ({
  getPromptProfile: (id: string) => ({ id, category: "signal-logic", systemPrompt: "" }),
}));

import { runTileAnalysis } from "./router";
import { GEMINI_MODELS } from "./tileConfig";

beforeEach(() => {
  calls.length = 0;
  failing = new Set();
  timingOut = new Set();
});

describe("runTileAnalysis mit googleModels", () => {
  it("probiert erst alle Gemini-Modelle, dann Mistral und Groq -- ohne Wiederholungen davor", async () => {
    failing = new Set([
      "mistral",
      `google:${GEMINI_MODELS.flash38}`,
      `google:${GEMINI_MODELS.flashLite35}`,
      `google:${GEMINI_MODELS.flash36}`,
    ]);
    const result = await runTileAnalysis("system-briefing-synthese", { context: "x" });
    expect(result.provider).toBe("groq");
    expect(calls.map((c) => (c.model ? `${c.provider}:${c.model}` : c.provider))).toEqual([
      `google:${GEMINI_MODELS.flash38}`,
      `google:${GEMINI_MODELS.flashLite35}`,
      `google:${GEMINI_MODELS.flash36}`,
      "mistral",
      "groq",
    ]);
    expect(calls.map((c) => c.retryOnOverload)).toEqual([false, false, false, false, true]);
  });

  it("stoppt beim ersten Gemini-Modell, das antwortet", async () => {
    failing = new Set([`google:${GEMINI_MODELS.flash37}`]);
    const result = await runTileAnalysis("system-briefing-regelwerk", { context: "x" });
    expect(result.model).toBe(GEMINI_MODELS.flashLite35);
    expect(calls).toHaveLength(2);
  });

  it("nutzt Gemini als Ersatz nur mit den geteilten Modellen", async () => {
    failing = new Set(["groq", "mistral"]);
    const result = await runTileAnalysis("system-briefing-chart", { context: "x" });
    expect(result.model).toBe(GEMINI_MODELS.flashLite35);
    expect(calls[0]).toMatchObject({ provider: "groq", retryOnOverload: false });
  });

  it("springt nach einer Gemini-Zeitueberschreitung direkt zum naechsten Provider", async () => {
    timingOut = new Set([`google:${GEMINI_MODELS.flash38}`]);
    const result = await runTileAnalysis("system-briefing-synthese", { context: "x" });
    expect(result.provider).toBe("mistral");
    expect(calls.map((c) => c.provider)).toEqual(["google", "mistral"]);
  });
});
