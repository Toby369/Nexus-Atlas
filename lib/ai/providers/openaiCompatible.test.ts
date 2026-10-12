import { describe, expect, it } from "vitest";
import { retryAfterSeconds } from "./openaiCompatible";

describe("retryAfterSeconds", () => {
  it("liest den Retry-After-Header", () => {
    expect(retryAfterSeconds("12", "")).toBe(12);
  });
  it("liest Groqs Fehlertext", () => {
    const body = '{"error":{"message":"Rate limit reached ... Please try again in 18.525s. Need more tokens?"}}';
    expect(retryAfterSeconds(null, body)).toBeCloseTo(18.525);
    expect(retryAfterSeconds(null, "Please try again in 1m2.5s.")).toBeCloseTo(62.5);
  });
  it("gibt null ohne Angabe zurück", () => {
    expect(retryAfterSeconds(null, "Rate limit exceeded")).toBeNull();
  });
});
