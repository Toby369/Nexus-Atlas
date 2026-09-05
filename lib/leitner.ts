// Leitner-Karteikasten: Boxen, Intervalle, Faelligkeit (Lernplattform-
// Kachel, Nutzer-Wunsch "wie im Trading Journal"). 1:1 portiert aus
// shared/leitner.js im Crypto-Trading-Journal (Toby's Freund) -- klassisches
// Prinzip: eine Karte beginnt in Box 1, je hoeher die Box, desto seltener
// kommt sie wieder dran. Vier Bewertungsstufen statt nur richtig/falsch:
//   Vergessen -> zurueck auf Box 1, egal wie weit sie schon war.
//   Schwer    -> bleibt in der aktuellen Box (kommt bald wieder, kein Reset).
//   Gut       -> eine Box weiter.
//   Leicht    -> zwei Boxen weiter -- eine sicher gewusste Karte muss nicht
//                die ganze Leiter einzeln hochsteigen.
//
// Reines Modul: kein Netz, keine Datenbank, kein React.

export const BOX_MIN = 1;
export const BOX_MAX = 4;

// Je hoeher die Box, desto seltener die Wiederholung. Box 1 ist sofort
// wieder faellig (0 Tage) -- eine frisch vergessene Karte soll in derselben
// Sitzung nochmal drankommen koennen.
export const INTERVAL_DAYS: Record<number, number> = { 1: 0, 2: 1, 3: 3, 4: 7 };

export type Grade = "vergessen" | "schwer" | "gut" | "leicht";
export const GRADES: readonly Grade[] = ["vergessen", "schwer", "gut", "leicht"];

// Boxsprung je Bewertung. null = Reset auf BOX_MIN statt eines Deltas.
const BOX_DELTA: Record<Grade, number | null> = {
  vergessen: null,
  schwer: 0,
  gut: 1,
  leicht: 2,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX = 20;

function normalizedBox(box: number | null | undefined): number {
  const b = Number(box);
  return Number.isFinite(b) && b >= BOX_MIN && b <= BOX_MAX ? b : BOX_MIN;
}

/** Box nach einer Bewertung -- siehe BOX_DELTA. */
export function nextBox(box: number | null | undefined, grade: Grade): number {
  const current = normalizedBox(box);
  const delta = BOX_DELTA[grade];
  if (delta === null) return BOX_MIN;
  return Math.min(BOX_MAX, current + delta);
}

/** Naechster Faelligkeitszeitpunkt (unix ms) fuer eine Box, ausgehend von `nowMs`. */
export function nextDueAt(nowMs: number, box: number): number {
  const days = INTERVAL_DAYS[box] ?? 0;
  return nowMs + days * DAY_MS;
}

export interface QuizProgress {
  box: number;
  dueAt: number;
  lastSeenAt: number | null;
  correctStreak: number;
  totalCorrect: number;
  totalHard: number;
  totalWrong: number;
  history: { t: number; grade: Grade }[];
}

/** Ist eine Fortschrittszeile jetzt faellig? Fehlend/0 heisst: sofort faellig. */
export function isDue(nowMs: number, progress: Pick<QuizProgress, "dueAt"> | null | undefined): boolean {
  return nowMs >= Number(progress?.dueAt ?? 0);
}

/** Verteilung ueber die Boxen, z.B. fuer eine kleine Balkenanzeige. */
export function boxDistribution(allProgress: Pick<QuizProgress, "box">[]): Record<number, number> {
  const distribution: Record<number, number> = {};
  for (let b = BOX_MIN; b <= BOX_MAX; b++) distribution[b] = 0;
  for (const p of allProgress) distribution[normalizedBox(p.box)]++;
  return distribution;
}

/**
 * Zentrale Regel: aus dem bisherigen Fortschritt + Bewertung den neuen
 * Zustand bauen. `progress` darf null sein (allererstes Review einer Karte).
 *
 * DREI Zaehler, nicht zwei: "Schwer" zaehlt bewusst NICHT als Treffer in
 * totalCorrect (sonst waere die Erfolgsquote systematisch zu gut, genau bei
 * den Karten, die noch nicht sitzen) -- hat aber auch keinen eigenen
 * Boxsprung-Effekt jenseits von "bleibt". correctStreak haengt an "gewusst"
 * (kam die Karte zurueck auf Box 1?), nicht an "sicher gewusst" -- das ist
 * dieselbe Konvention wie beim Boxsprung.
 */
export function evaluate(progress: QuizProgress | null, grade: Grade, nowMs: number): QuizProgress {
  const box = nextBox(progress?.box, grade);
  const history = [...(progress?.history ?? []), { t: nowMs, grade }].slice(-HISTORY_MAX);

  const forgotten = grade === "vergessen";
  const confident = grade === "gut" || grade === "leicht";
  const hard = !forgotten && !confident;
  const known = !forgotten;

  return {
    box,
    dueAt: nextDueAt(nowMs, box),
    lastSeenAt: nowMs,
    correctStreak: known ? (progress?.correctStreak ?? 0) + 1 : 0,
    totalCorrect: (progress?.totalCorrect ?? 0) + (confident ? 1 : 0),
    totalHard: (progress?.totalHard ?? 0) + (hard ? 1 : 0),
    totalWrong: (progress?.totalWrong ?? 0) + (forgotten ? 1 : 0),
    history,
  };
}
