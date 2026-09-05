import { describe, expect, it } from "vitest";
import { boxDistribution, evaluate, isDue, nextBox, nextDueAt, type QuizProgress } from "./leitner";

describe("nextBox", () => {
  it("Vergessen setzt immer auf Box 1 zurueck, egal wie weit oben", () => {
    expect(nextBox(4, "vergessen")).toBe(1);
  });
  it("Schwer bleibt in der aktuellen Box", () => {
    expect(nextBox(2, "schwer")).toBe(2);
  });
  it("Gut geht eine Box weiter", () => {
    expect(nextBox(2, "gut")).toBe(3);
  });
  it("Leicht geht zwei Boxen weiter", () => {
    expect(nextBox(1, "leicht")).toBe(3);
  });
  it("kappt bei Box 4 (kein Ueberlauf)", () => {
    expect(nextBox(3, "leicht")).toBe(4);
    expect(nextBox(4, "gut")).toBe(4);
  });
  it("behandelt eine fehlende/ungueltige Box als Box 1", () => {
    expect(nextBox(null, "gut")).toBe(2);
    expect(nextBox(99, "schwer")).toBe(1);
  });
});

describe("nextDueAt", () => {
  it("Box 1 ist sofort wieder faellig (0 Tage)", () => {
    expect(nextDueAt(1000, 1)).toBe(1000);
  });
  it("Box 4 ist erst in 7 Tagen faellig", () => {
    const now = 1_000_000;
    expect(nextDueAt(now, 4)).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });
});

describe("isDue", () => {
  it("gilt als faellig ohne jede Fortschrittszeile", () => {
    expect(isDue(1000, null)).toBe(true);
  });
  it("gilt als faellig genau am Faelligkeitszeitpunkt", () => {
    expect(isDue(1000, { dueAt: 1000 })).toBe(true);
  });
  it("gilt nicht als faellig vor dem Faelligkeitszeitpunkt", () => {
    expect(isDue(999, { dueAt: 1000 })).toBe(false);
  });
});

describe("boxDistribution", () => {
  it("zaehlt alle vier Boxen, auch wenn leer", () => {
    const dist = boxDistribution([{ box: 1 }, { box: 1 }, { box: 3 }]);
    expect(dist).toEqual({ 1: 2, 2: 0, 3: 1, 4: 0 });
  });
});

describe("evaluate", () => {
  const now = 10_000_000;

  it("erstes Review einer neuen Karte (progress=null) mit 'gut' -> Box 2, ein Treffer", () => {
    const result = evaluate(null, "gut", now);
    expect(result.box).toBe(2);
    expect(result.totalCorrect).toBe(1);
    expect(result.totalHard).toBe(0);
    expect(result.totalWrong).toBe(0);
    expect(result.correctStreak).toBe(1);
  });

  it("'Schwer' zaehlt NICHT als Treffer in totalCorrect", () => {
    const result = evaluate(null, "schwer", now);
    expect(result.totalCorrect).toBe(0);
    expect(result.totalHard).toBe(1);
    // Aber die Serie laeuft weiter (gewusst, nur nicht sicher).
    expect(result.correctStreak).toBe(1);
  });

  it("'Vergessen' unterbricht die Serie und zaehlt als Fehler", () => {
    const vorher: QuizProgress = {
      box: 3,
      dueAt: 0,
      lastSeenAt: now - 1000,
      correctStreak: 5,
      totalCorrect: 5,
      totalHard: 0,
      totalWrong: 0,
      history: [],
    };
    const result = evaluate(vorher, "vergessen", now);
    expect(result.box).toBe(1);
    expect(result.correctStreak).toBe(0);
    expect(result.totalWrong).toBe(1);
  });

  it("haengt jede Bewertung an die Historie an, gekappt auf die letzten 20", () => {
    let progress: QuizProgress | null = null;
    for (let i = 0; i < 25; i++) {
      progress = evaluate(progress, "gut", now + i);
    }
    expect(progress!.history).toHaveLength(20);
    expect(progress!.history[progress!.history.length - 1].t).toBe(now + 24);
  });
});
