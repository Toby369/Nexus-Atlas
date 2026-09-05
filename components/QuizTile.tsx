import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { QuizCard, QuizProgressRow } from "@/lib/types";
import { boxDistribution, isDue, type QuizProgress, type Grade } from "@/lib/leitner";
import { learningStreak, type QuizEntry } from "@/lib/quizStatistik";
import PanelInfo from "@/components/PanelInfo";

// Kompakte Dashboard-Kachel fuer die Lernplattform (Nutzer-Wunsch
// "Lernplattform/Kachel", Konzept aus KachelQuiz.vue im Crypto-Trading-
// Journal): faellige Karten heute, Box-Verteilung, Lern-Serie -- Details
// und die eigentliche Lernsitzung/Kartenverwaltung liegen auf /lernen.

const INFO_TEXT = [
  "Kurzueberblick der Lernplattform (Leitner-Karteikasten, siehe /lernen fuer Details).",
  "Faellig heute: Karten, deren naechster Wiederholungstermin erreicht ist. Die Balkenfarben zeigen die Verteilung ueber die vier Boxen (rot=Box 1 bis gruen=Box 4/gemeistert).",
].join("\n\n");

function rowToProgress(row: QuizProgressRow | undefined): QuizProgress | null {
  if (!row) return null;
  return {
    box: row.box,
    dueAt: new Date(row.due_at).getTime(),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
    correctStreak: row.correct_streak,
    totalCorrect: row.total_correct,
    totalHard: row.total_hard,
    totalWrong: row.total_wrong,
    history: row.history as { t: number; grade: Grade }[],
  };
}

async function getCards(): Promise<QuizCard[]> {
  const { data, error } = await supabase.from("quiz_cards").select("*").eq("active", true);
  if (error) {
    console.error("Fehler beim Laden der Lernkarten (Kachel):", error.message);
    return [];
  }
  return data ?? [];
}

async function getProgress(): Promise<QuizProgressRow[]> {
  const { data, error } = await supabase.from("quiz_progress").select("*");
  if (error) {
    console.error("Fehler beim Laden des Lernfortschritts (Kachel):", error.message);
    return [];
  }
  return data ?? [];
}

export default async function QuizTile() {
  const [cards, progressRows] = await Promise.all([getCards(), getProgress()]);
  const progressByCard = new Map(progressRows.map((r) => [r.card_id, r]));

  const entries: QuizEntry[] = cards.map((card) => ({
    card,
    progress: rowToProgress(progressByCard.get(card.id)),
  }));

  const now = Date.now();
  const dueCount = entries.filter((e) => isDue(now, e.progress)).length;
  const boxes = boxDistribution(entries.map((e) => ({ box: e.progress?.box ?? 1 })));
  const boxTotal = Object.values(boxes).reduce((a, b) => a + b, 0);
  const streak = learningStreak(entries, now);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Lernen</p>
          <PanelInfo title="Lernen" content={INFO_TEXT} />
        </span>
        <Link
          href="/lernen"
          className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
        >
          Öffnen →
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="text-xs text-text-faint">Noch keine Lernkarten angelegt.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-text">{dueCount}</p>
            <p className="text-xs text-text-faint">fällig heute</p>
          </div>

          {boxTotal > 0 && (
            <div className="flex h-2 rounded-full overflow-hidden bg-surface-raised">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{ flex: `${Math.max(boxes[n] ?? 0, 0.001)} 1 0` }}
                  className={
                    n === 1 ? "bg-down" : n === 2 ? "bg-accent" : n === 3 ? "bg-blue-500" : "bg-up"
                  }
                />
              ))}
            </div>
          )}

          {streak > 0 && <p className="text-xs text-accent font-medium">🔥 {streak} Tage Serie</p>}
        </div>
      )}
    </div>
  );
}
