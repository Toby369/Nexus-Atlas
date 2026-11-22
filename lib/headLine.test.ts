import { describe, expect, it } from "vitest";
import { headActionLine } from "./headLine";
import type { RuleCheckResult } from "./ruleCheck";

const check = (side: RuleCheckResult["side"], tone: RuleCheckResult["verdict"]["tone"], short: string): RuleCheckResult => ({
  side,
  level: side ? 81_539 : null,
  stopPct: null,
  rows: [],
  verdict: { tone, short, text: short },
});
const free = { tone: "ok" as const, short: "Frei" };

describe("headActionLine", () => {
  it("ohne Ausbruch steht der Plan-Satz", () => {
    expect(headActionLine(check(null, "wait", "Warten: kein 4H-Ausbruch"), free, "Über 82’257 Long am Retest")).toEqual({
      text: "Über 82’257 Long am Retest",
      tone: "neutral",
    });
  });

  it("mit Ausbruch der Stand des Regelchecks", () => {
    expect(headActionLine(check("short", "wait", "Short unter 81’539: 1H-Retest abwarten"), free, "Plan")).toEqual({
      text: "Short unter 81’539: 1H-Retest abwarten",
      tone: "neutral",
    });
    expect(headActionLine(check("long", "trade", "Long-Setup steht"), free, null).tone).toBe("ok");
  });

  it("ein Veto wird angehaengt und faerbt rot", () => {
    const r = headActionLine(check("long", "trade", "Long-Setup steht"), { tone: "veto", short: "Veto: FOMC in 12 Min" }, null);
    expect(r).toEqual({ text: "Long-Setup steht · Veto: FOMC in 12 Min", tone: "stop" });
  });

  it("Warnungen nur bei stehendem Setup", () => {
    const warn = { tone: "warnung" as const, short: "Warnung: Funding" };
    expect(headActionLine(check("long", "trade", "Long-Setup steht"), warn, null).tone).toBe("warn");
    expect(headActionLine(check("long", "wait", "Long über 1: 1H-Retest abwarten"), warn, null).text).not.toContain("Warnung");
  });
});

describe("headFromSetup", () => {
  it("folgt dem Setup-Rechner", async () => {
    const { headFromSetup } = await import("./headLine");
    const v = (tone: "trade" | "wait" | "watch" | "stop", short: string, halfSize: string[] = []) => ({ verdict: { tone, short }, halfSize });
    expect(headFromSetup(undefined, "Über 60’000 Long")).toEqual({ text: "Über 60’000 Long", tone: "neutral" });
    expect(headFromSetup(v("trade", "Long-Setup steht (9/10)"), null)).toEqual({ text: "Long-Setup steht (9/10)", tone: "ok" });
    expect(headFromSetup(v("trade", "Long-Setup steht (9/10)", ["x"]), null)).toEqual({ text: "Long-Setup steht (9/10) · halbe Grösse", tone: "warn" });
    expect(headFromSetup(v("stop", "Veto: CPI in 20 Min"), null).tone).toBe("stop");
    expect(headFromSetup(v("watch", "Long 59’000 beobachten (5/10)"), null).tone).toBe("warn");
  });
});
