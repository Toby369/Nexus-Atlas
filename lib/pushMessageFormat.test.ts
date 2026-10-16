import { describe, expect, it } from "vitest";
import { isPushMessageId, safeInternalLink, shortTitle } from "./pushMessageFormat";

describe("isPushMessageId", () => {
  it("akzeptiert nur UUIDs", () => {
    expect(isPushMessageId("3f13f3fe-d306-424f-8f4b-583462106c8e")).toBe(true);
    expect(isPushMessageId("abc")).toBe(false);
    expect(isPushMessageId("3f13f3fe-d306-424f-8f4b-583462106c8e'--")).toBe(false);
  });
});

describe("safeInternalLink", () => {
  it("laesst nur interne Pfade zu", () => {
    expect(safeInternalLink("/reports")).toBe("/reports");
    expect(safeInternalLink("https://example.com")).toBeNull();
    expect(safeInternalLink("//example.com")).toBeNull();
    expect(safeInternalLink(null)).toBeNull();
  });
});

describe("shortTitle", () => {
  it("entfernt den App-Praefix", () => {
    expect(shortTitle("Nexus Atlas — Risiko-Warnung")).toBe("Risiko-Warnung");
    expect(shortTitle("BTC · Seitwärts")).toBe("BTC · Seitwärts");
  });
});
