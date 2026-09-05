import { describe, it, expect } from "vitest";
import { computeEscalationConsensus, type EscalationRead } from "./escalationConsensus";

function read(bias: EscalationRead["bias"], overrides: Partial<EscalationRead> = {}): EscalationRead {
  return {
    provider: "anthropic",
    model: "test-model",
    bias,
    confidence: 70,
    summary: "test",
    ...overrides,
  };
}

describe("computeEscalationConsensus", () => {
  it("liefert INCONCLUSIVE bei 0 Reads", () => {
    expect(computeEscalationConsensus([])).toBe("INCONCLUSIVE");
  });

  it("liefert INCONCLUSIVE bei nur 1 Read (kein Konsens ohne zweite Meinung)", () => {
    expect(computeEscalationConsensus([read("bullish")])).toBe("INCONCLUSIVE");
  });

  it("liefert AGREEMENT wenn alle Reads denselben bias haben", () => {
    expect(
      computeEscalationConsensus([
        read("bullish", { provider: "anthropic" }),
        read("bullish", { provider: "google" }),
        read("bullish", { provider: "mistral" }),
      ])
    ).toBe("AGREEMENT");
  });

  it("liefert AGREEMENT bei gleichem bias trotz unterschiedlicher confidence", () => {
    expect(
      computeEscalationConsensus([
        read("bearish", { confidence: 90 }),
        read("bearish", { confidence: 40 }),
      ])
    ).toBe("AGREEMENT");
  });

  it("liefert DIVERGENCE wenn die Reads unterschiedliche bias-Werte haben", () => {
    expect(
      computeEscalationConsensus([
        read("bullish", { provider: "anthropic" }),
        read("bearish", { provider: "google" }),
        read("neutral", { provider: "mistral" }),
      ])
    ).toBe("DIVERGENCE");
  });

  it("liefert DIVERGENCE bei genau 2 abweichenden Reads", () => {
    expect(computeEscalationConsensus([read("bullish"), read("neutral")])).toBe("DIVERGENCE");
  });
});
