// Fortschritt im Bücher-Lernpfad (components/lernen/BuecherPanel.tsx).
//
// Regeln: Lektionen werden der Reihe nach freigeschaltet. Eine richtig
// beantwortete Prüffrage schaltet die nächste Lektion frei. Eine falsche
// Antwort wirft auf die Lektion zurück (nochmal lesen); zwei falsche
// Antworten in Folge bei derselben Lektion werfen zusätzlich eine Lektion
// zurück, d.h. die vorherige muss erneut bestanden werden.

export type BookProgress = {
  // Anzahl bestandener Lektionen; Lektion mit Index `passed` ist die nächste offene.
  passed: number;
  // Falsche Antworten in Folge auf die aktuell offene Lektion.
  wrongStreak: number;
};

export type BuecherProgress = Record<string, BookProgress>;

export const EMPTY_BOOK_PROGRESS: BookProgress = { passed: 0, wrongStreak: 0 };

export const WRONG_STREAK_FALLBACK = 2;

export function bookProgress(all: BuecherProgress, bookId: string): BookProgress {
  return all[bookId] ?? EMPTY_BOOK_PROGRESS;
}

export function isUnlocked(p: BookProgress, lessonIndex: number): boolean {
  return lessonIndex <= p.passed;
}

export type AnswerOutcome = "weiter" | "wiederholen" | "zurueckgefallen" | "schon_bestanden";

/**
 * Wendet eine Antwort auf Lektion `lessonIndex` an. Antworten auf bereits
 * bestandene Lektionen (Wiederholung) ändern den Fortschritt nicht.
 */
export function applyAnswer(
  p: BookProgress,
  lessonIndex: number,
  correct: boolean,
  lessonCount: number
): { next: BookProgress; outcome: AnswerOutcome } {
  if (lessonIndex < p.passed) {
    return { next: p, outcome: "schon_bestanden" };
  }
  if (correct) {
    return { next: { passed: Math.min(p.passed + 1, lessonCount), wrongStreak: 0 }, outcome: "weiter" };
  }
  const wrongStreak = p.wrongStreak + 1;
  if (wrongStreak >= WRONG_STREAK_FALLBACK && p.passed > 0) {
    return { next: { passed: p.passed - 1, wrongStreak: 0 }, outcome: "zurueckgefallen" };
  }
  return { next: { passed: p.passed, wrongStreak }, outcome: "wiederholen" };
}

/** Liest gespeicherten Fortschritt robust (ungültige Einträge werden verworfen). */
export function parseProgress(raw: string | null): BuecherProgress {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const out: BuecherProgress = {};
    for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
      const entry = v as Partial<BookProgress> | null;
      if (entry && Number.isInteger(entry.passed) && Number.isInteger(entry.wrongStreak)) {
        out[id] = { passed: Math.max(0, entry.passed as number), wrongStreak: Math.max(0, entry.wrongStreak as number) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Deterministische Reihenfolge 0..n-1 aus einem Seed (FNV-1a + LCG + Fisher-Yates).
 * Damit steht die richtige Antwort nicht immer an derselben Stelle, bleibt
 * aber zwischen Server- und Client-Render identisch.
 */
export function shuffledOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
