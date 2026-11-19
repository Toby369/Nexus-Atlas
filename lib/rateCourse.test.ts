import { describe, expect, it } from "vitest";
import { expectationLine, rateCourse, rateCourseLine } from "./rateCourse";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const hike = [
  { effective_date: "2023-01-01", lower_pct: 4.25, upper_pct: 4.5 },
  { effective_date: "2026-03-19", lower_pct: 3.25, upper_pct: 3.5 },
  { effective_date: "2026-09-17", lower_pct: 3.75, upper_pct: 4.0 },
];

describe("Zinskurs", () => {
  it("Erhöhung plus Markt erwartet mehr = Gegenwind", () => {
    const c = rateCourse(hike, 4.86, NOW)!;
    expect(c).toMatchObject({ direction: "hikes", expectation: "hikes", light: "down", short: "Erhöhungen" });
    expect(c.lastStep?.deltaPct).toBeCloseTo(0.5);
    expect(rateCourseLine(c, (d) => d)).toBe("Leitzins 3.75–4.00 %, zuletzt +0.50 ab 2026-09-17");
    expect(expectationLine(c)).toBe("2J-Rendite 4.86 %: Markt erwartet weitere Erhöhungen");
  });

  it("Senkung, Markt erwartet weitere = Rückenwind", () => {
    const cut = [...hike.slice(0, 1), { effective_date: "2026-10-01", lower_pct: 4.0, upper_pct: 4.25 }];
    expect(rateCourse(cut, 3.6, NOW)).toMatchObject({ direction: "cuts", expectation: "cuts", light: "up" });
  });

  it("lange kein Schritt = Pause, widerspruechlich = neutral", () => {
    const old = [hike[0], { effective_date: "2025-01-01", lower_pct: 4.0, upper_pct: 4.25 }];
    expect(rateCourse(old, 4.1, NOW)).toMatchObject({ direction: "pause", expectation: "steady", light: "neutral" });
    expect(rateCourse(hike, 3.4, NOW)?.light).toBe("neutral");
    expect(rateCourse([], 4, NOW)).toBeNull();
  });
});
