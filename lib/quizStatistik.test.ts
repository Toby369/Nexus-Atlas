import { describe, expect, it } from "vitest";
import { learningStreak, overview, perCategory, perDay, type QuizEntry } from "./quizStatistik";
import type { QuizProgress } from "./leitner";
import type { QuizCard } from "./types";

function card(overrides: Partial<QuizCard> = {}): QuizCard {
  return {
    id: 1,
    question: "Q",
    answer: "A",
    explanation: null,
    category: null,
    active: true,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function progress(overrides: Partial<QuizProgress> = {}): QuizProgress {
  return {
    box: 1,
    dueAt: 0,
    lastSeenAt: null,
    correctStreak: 0,
    totalCorrect: 0,
    totalHard: 0,
    totalWrong: 0,
    history: [],
    ...overrides,
  };
}

describe("overview", () => {
  it("successRate ist null ohne jede Bewertung (kein erfundenes 0%)", () => {
    const entries: QuizEntry[] = [{ card: card(), progress: null }];
    expect(overview(entries).successRate).toBeNull();
  });

  it("zaehlt nur aktive Karten", () => {
    const entries: QuizEntry[] = [
      { card: card({ id: 1, active: true }), progress: null },
      { card: card({ id: 2, active: false }), progress: null },
    ];
    expect(overview(entries).total).toBe(1);
  });

  it("mastered zaehlt Karten in Box 4", () => {
    const entries: QuizEntry[] = [
      { card: card({ id: 1 }), progress: progress({ box: 4 }) },
      { card: card({ id: 2 }), progress: progress({ box: 2 }) },
    ];
    const result = overview(entries);
    expect(result.mastered).toBe(1);
    expect(result.masteredRate).toBeCloseTo(0.5, 6);
  });

  it("successRate rechnet totalCorrect / (totalCorrect+totalHard+totalWrong)", () => {
    const entries: QuizEntry[] = [
      { card: card(), progress: progress({ totalCorrect: 3, totalHard: 1, totalWrong: 1 }) },
    ];
    expect(overview(entries).successRate).toBeCloseTo(0.6, 6);
  });
});

describe("learningStreak", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("ist 0 ohne jede Historie", () => {
    const entries: QuizEntry[] = [{ card: card(), progress: null }];
    expect(learningStreak(entries, Date.now())).toBe(0);
  });

  it("zaehlt aufeinanderfolgende Tage inkl. heute", () => {
    const now = Date.UTC(2026, 8, 5, 12, 0, 0);
    const entries: QuizEntry[] = [
      {
        card: card(),
        progress: progress({
          history: [
            { t: now - 2 * DAY, grade: "gut" },
            { t: now - 1 * DAY, grade: "gut" },
            { t: now, grade: "gut" },
          ],
        }),
      },
    ];
    expect(learningStreak(entries, now)).toBe(3);
  });

  it("bricht die Serie nicht ab, nur weil heute noch nicht gelernt wurde", () => {
    const now = Date.UTC(2026, 8, 5, 8, 0, 0);
    const entries: QuizEntry[] = [
      { card: card(), progress: progress({ history: [{ t: now - 1 * DAY, grade: "gut" }] }) },
    ];
    expect(learningStreak(entries, now)).toBe(1);
  });
});

describe("perDay", () => {
  it("liefert genau `days` Eintraege, aelteste zuerst", () => {
    const now = Date.UTC(2026, 8, 5, 12, 0, 0);
    const result = perDay([{ card: card(), progress: null }], now, 7);
    expect(result).toHaveLength(7);
    expect(new Date(result[0].day).getTime()).toBeLessThan(new Date(result[6].day).getTime());
  });
});

describe("perCategory", () => {
  it("markiert Kategorien unter MIN_GROUP als thin, statt eine Quote zu behaupten", () => {
    const entries: QuizEntry[] = [
      { card: card({ category: "Faktoren" }), progress: progress({ totalCorrect: 1 }) },
    ];
    const result = perCategory(entries);
    expect(result[0].thin).toBe(true);
  });

  it("laesst Kategorien ohne jede Bewertung ganz weg", () => {
    const entries: QuizEntry[] = [{ card: card({ category: "Ungetestet" }), progress: null }];
    expect(perCategory(entries)).toHaveLength(0);
  });

  it("sortiert schwaechste Quote zuerst", () => {
    const entries: QuizEntry[] = [
      { card: card({ id: 1, category: "A" }), progress: progress({ totalCorrect: 3, totalHard: 0, totalWrong: 0 }) },
      { card: card({ id: 2, category: "B" }), progress: progress({ totalCorrect: 0, totalHard: 0, totalWrong: 3 }) },
    ];
    const result = perCategory(entries);
    expect(result[0].category).toBe("B");
  });
});
