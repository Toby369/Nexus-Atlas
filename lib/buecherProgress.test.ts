import { describe, expect, it } from "vitest";
import { applyAnswer, isUnlocked, parseProgress, shuffledOrder } from "./buecherProgress";
import { BUECHER } from "./buecherContent";

describe("applyAnswer", () => {
  it("schaltet bei richtiger Antwort die naechste Lektion frei", () => {
    const { next, outcome } = applyAnswer({ passed: 1, wrongStreak: 1 }, 1, true, 5);
    expect(outcome).toBe("weiter");
    expect(next).toEqual({ passed: 2, wrongStreak: 0 });
  });

  it("wirft bei falscher Antwort auf die Lektion zurueck", () => {
    const { next, outcome } = applyAnswer({ passed: 1, wrongStreak: 0 }, 1, false, 5);
    expect(outcome).toBe("wiederholen");
    expect(next).toEqual({ passed: 1, wrongStreak: 1 });
  });

  it("faellt nach zwei falschen Antworten in Folge eine Lektion zurueck", () => {
    const { next, outcome } = applyAnswer({ passed: 2, wrongStreak: 1 }, 2, false, 5);
    expect(outcome).toBe("zurueckgefallen");
    expect(next).toEqual({ passed: 1, wrongStreak: 0 });
  });

  it("faellt in der ersten Lektion nicht unter null", () => {
    const { next, outcome } = applyAnswer({ passed: 0, wrongStreak: 1 }, 0, false, 5);
    expect(outcome).toBe("wiederholen");
    expect(next).toEqual({ passed: 0, wrongStreak: 2 });
  });

  it("aendert bei Wiederholung bestandener Lektionen nichts", () => {
    const p = { passed: 3, wrongStreak: 0 };
    expect(applyAnswer(p, 1, false, 5)).toEqual({ next: p, outcome: "schon_bestanden" });
  });

  it("zaehlt nicht ueber die Lektionsanzahl hinaus", () => {
    expect(applyAnswer({ passed: 4, wrongStreak: 0 }, 4, true, 5).next.passed).toBe(5);
  });
});

describe("isUnlocked / parseProgress", () => {
  it("gibt nur bestandene und die naechste Lektion frei", () => {
    const p = { passed: 2, wrongStreak: 0 };
    expect(isUnlocked(p, 2)).toBe(true);
    expect(isUnlocked(p, 3)).toBe(false);
  });

  it("verwirft kaputte Eintraege", () => {
    expect(parseProgress("{nope")).toEqual({});
    expect(parseProgress(JSON.stringify({ a: { passed: 2, wrongStreak: 0 }, b: { passed: "x" } }))).toEqual({
      a: { passed: 2, wrongStreak: 0 },
    });
  });
});

describe("shuffledOrder", () => {
  it("liefert eine stabile Permutation", () => {
    const a = shuffledOrder(3, "harris-0");
    expect([...a].sort()).toEqual([0, 1, 2]);
    expect(shuffledOrder(3, "harris-0")).toEqual(a);
  });

  it("verteilt die richtige Antwort ueber verschiedene Positionen", () => {
    const positions = new Set<number>();
    for (const b of BUECHER) {
      b.lektionen.forEach((l, i) => {
        positions.add(shuffledOrder(l.frage.optionen.length, `${b.id}-${i}`).indexOf(l.frage.richtig));
      });
    }
    expect(positions.size).toBeGreaterThanOrEqual(3);
  });
});

describe("Buecher-Inhalte", () => {
  it("haben eindeutige IDs und gueltige Fragen", () => {
    expect(new Set(BUECHER.map((b) => b.id)).size).toBe(BUECHER.length);
    for (const b of BUECHER) {
      expect(b.lektionen.length).toBeGreaterThan(0);
      for (const l of b.lektionen) {
        expect(l.frage.optionen.length).toBeGreaterThanOrEqual(3);
        expect(l.frage.richtig).toBeGreaterThanOrEqual(0);
        expect(l.frage.richtig).toBeLessThan(l.frage.optionen.length);
      }
    }
  });
});
