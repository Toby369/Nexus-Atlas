import { describe, expect, it } from "vitest";
import { alignOiBars, oiNote } from "./oiHourly";

const H = 3_600_000;
const NOW = Date.parse("2026-11-26T18:40:00Z");
const start = Date.parse("2026-11-26T07:00:00Z");
const hours = Array.from({ length: 12 }, (_, i) => start + i * H);

describe("OI je Stunde", () => {
  it("legt die Werte auf die Spot-Stunden, laufende Stunde markiert", () => {
    const bars = alignOiBars(
      [
        { hour_start: "2026-11-26T07:00:00+00:00", change_pct: 0.314 },
        { hour_start: "2026-11-26T18:00:00+00:00", change_pct: 0.156 },
      ],
      hours,
      NOW
    );
    expect(bars[0]).toMatchObject({ changePct: 0.314, complete: true });
    expect(bars[1].changePct).toBeNull();
    expect(bars[11]).toMatchObject({ changePct: 0.156, complete: false });
  });

  it("Hinweis erst ab 1 % ueber 2 Stunden", () => {
    const b = (a: number, c: number) => [
      { startMs: 0, changePct: a, complete: true },
      { startMs: H, changePct: c, complete: false },
    ];
    expect(oiNote(b(-0.7, -0.5))).toEqual({ text: "Hebel abgebaut −1.2 % (2 h)", tone: "out" });
    expect(oiNote(b(0.6, 0.5))?.tone).toBe("in");
    expect(oiNote(b(0.4, -0.2))).toBeNull();
  });
});
