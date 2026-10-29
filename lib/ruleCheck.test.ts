import { describe, expect, it } from "vitest";
import { evaluateRuleCheck, findLatestBodyBreak } from "./ruleCheck";
import { evaluateVeto } from "./veto";
import { nextHighRiskWindow } from "./tradingHours";

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 22, 0, 0);
const c = (startMs: number, open: number, high: number, low: number, close: number) => ({
  openTime: new Date(startMs).toISOString(),
  open,
  high,
  low,
  close,
});

// 4H: Schluss 99'800 -> 100'400 bricht das Level 100'000 mit dem Koerper nach oben.
const candles4h = [c(T0, 99_500, 99_900, 99_400, 99_800), c(T0 + 4 * H, 99_800, 100_500, 99_700, 100_400)];
const levels = [{ price: 100_000 }, { price: 102_000 }, { price: 98_000 }];

describe("findLatestBodyBreak", () => {
  it("findet den Koerperausbruch und die Richtung", () => {
    expect(findLatestBodyBreak([{ price: 100_000 }], candles4h)).toMatchObject({ side: "long", level: 100_000 });
  });

  it("bei einer Zone zaehlt die Oberkante fuer Long, die Unterkante fuer Short", () => {
    const zone = [{ price: 100_000, low: 99_700, high: 100_300 }];
    // Schluss 100'400 ueber der Oberkante 100'300
    expect(findLatestBodyBreak(zone, candles4h)).toMatchObject({ side: "long", level: 100_300 });
    // Schluss 100'200 noch in der Zone: kein Ausbruch
    const inside = [candles4h[0], c(T0 + 4 * H, 99_800, 100_250, 99_700, 100_200)];
    expect(findLatestBodyBreak(zone, inside)).toBeNull();
  });

  it("ein Docht allein ist kein Ausbruch", () => {
    const wick = [c(T0, 99_500, 99_900, 99_400, 99_800), c(T0 + 4 * H, 99_800, 100_300, 99_700, 99_900)];
    expect(findLatestBodyBreak([{ price: 100_000 }], wick)).toBeNull();
  });
});

describe("evaluateRuleCheck", () => {
  const base = { levels, candles4h };

  it("ohne Ausbruch: warten auf den 4H-Koerperschluss", () => {
    const r = evaluateRuleCheck({ ...base, price: 100_900, candles4h: [candles4h[1], candles4h[1]], candles1h: [], candles15m: [] });
    expect(r.side).toBeNull();
    expect(r.verdict.tone).toBe("wait");
    expect(r.verdict.text).toContain("4H-Körperschluss");
  });

  it("Ausbruch ohne Retest: offen, nicht hinterherlaufen", () => {
    const r = evaluateRuleCheck({ ...base, price: 100_800, candles1h: [c(T0 + 8 * H, 100_400, 100_900, 100_600, 100_800)], candles15m: [] });
    expect(r.side).toBe("long");
    expect(r.rows.find((x) => x.id === "retest1h")?.answer).toBe("offen");
    expect(r.verdict.tone).toBe("wait");
  });

  it("gescheiterter Retest: kein Trade", () => {
    const r = evaluateRuleCheck({ ...base, price: 99_700, candles1h: [c(T0 + 8 * H, 100_400, 100_450, 99_600, 99_700)], candles15m: [] });
    expect(r.rows.find((x) => x.id === "retest1h")?.answer).toBe("nein");
    expect(r.verdict.tone).toBe("stop");
  });

  it("Retest, Bestaetigung mit Folgekerze und genug Abstand: Setup steht", () => {
    const retestStart = T0 + 8 * H;
    const r = evaluateRuleCheck({
      ...base,
      price: 100_200,
      candles1h: [c(retestStart, 100_400, 100_450, 100_050, 100_200)],
      candles15m: [
        c(retestStart, 100_300, 100_320, 100_100, 100_150),
        c(retestStart + H / 4, 100_120, 100_250, 100_020, 100_220),
        c(retestStart + H / 2, 100_220, 100_300, 100_150, 100_260),
      ],
    });
    expect(r.rows.map((x) => x.answer)).toEqual(["ja", "ja", "ja", "ja"]);
    expect(r.verdict.tone).toBe("trade");
  });

  it("Ziel unter 1 % entfernt: kein Trade", () => {
    const r = evaluateRuleCheck({ ...base, levels: [{ price: 100_000 }, { price: 100_700 }], price: 100_200, candles1h: [], candles15m: [] });
    expect(r.rows.find((x) => x.id === "distance")?.answer).toBe("nein");
  });
});

describe("evaluateVeto", () => {
  const base = {
    side: "long" as const,
    fundingPct: 0.01,
    crowdLongPct: 58,
    spot: "up" as const,
    perp: "up" as const,
    driverLabel: null,
    upcomingRisk: null,
    noisePct: 0.3,
    tradesToday: 0,
    lossesInRow: 0,
  };

  it("alles frei", () => {
    expect(evaluateVeto(base).every((r) => r.answer === "ok")).toBe(true);
  });

  it("Funding und Masse warnen nur gegen die eigene Seite", () => {
    const longRows = evaluateVeto({ ...base, fundingPct: 0.04, crowdLongPct: 68 });
    expect(longRows.find((r) => r.id === "funding")?.answer).toBe("warnung");
    expect(longRows.find((r) => r.id === "crowd")?.answer).toBe("warnung");
    const shortRows = evaluateVeto({ ...base, side: "short", spot: "down", fundingPct: 0.04, crowdLongPct: 68 });
    expect(shortRows.find((r) => r.id === "funding")?.answer).toBe("ok");
    expect(shortRows.find((r) => r.id === "crowd")?.answer).toBe("ok");
  });

  it("Termin, 3 Trades oder 2 Verluste sind ein Veto", () => {
    expect(evaluateVeto({ ...base, upcomingRisk: "FOMC in 10 Min" }).find((r) => r.id === "events")?.answer).toBe("veto");
    expect(evaluateVeto({ ...base, tradesToday: 3 }).find((r) => r.id === "journal")?.answer).toBe("veto");
    expect(evaluateVeto({ ...base, lossesInRow: 2 }).find((r) => r.id === "journal")?.answer).toBe("veto");
  });
});

describe("Stop-Check", () => {
  it("warnt, wenn der Stop innerhalb des 1H-Rauschens liegt", async () => {
    const { evaluateVeto: ev, hourlyNoisePct } = await import("./veto");
    const base = { side: "long" as const, fundingPct: 0.01, crowdLongPct: 58, spot: "up" as const, perp: "up" as const, driverLabel: null, upcomingRisk: null, tradesToday: 0, lossesInRow: 0 };
    expect(ev({ ...base, noisePct: 0.7 }).find((r) => r.id === "stop")?.answer).toBe("warnung");
    expect(ev({ ...base, noisePct: 0.3 }).find((r) => r.id === "stop")?.answer).toBe("ok");
    // 15 Kerzen mit je 1'000 Spanne bei 100'000 -> 1 %
    const candles = Array.from({ length: 15 }, () => ({ high: 100_500, low: 99_500, close: 100_000 }));
    expect(hourlyNoisePct(candles)).toBeCloseTo(1, 5);
    expect(hourlyNoisePct(candles.slice(0, 5))).toBeNull();
  });
});

describe("nextHighRiskWindow", () => {
  it("meldet die US-Kasseneroeffnung 20 Min vorher", () => {
    // Mittwoch 22.10.2026, 09:30 ET = 13:30 UTC; 20 Min vorher.
    const now = Date.UTC(2026, 9, 22, 13, 10);
    expect(nextHighRiskWindow(now, [])).toMatchObject({ id: "opening", inMin: 15 });
  });

  it("nichts in den naechsten 30 Min", () => {
    expect(nextHighRiskWindow(Date.UTC(2026, 9, 22, 3, 0), [])).toBeNull();
  });
});
