import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { evaluate, GRADES, type Grade, type QuizProgress } from "@/lib/leitner";
import type { QuizProgressRow } from "@/lib/types";

// POST /api/quiz/review
// Body: { cardId: number, grade: "vergessen"|"schwer"|"gut"|"leicht" }
//
// Liest den aktuellen Fortschritt (falls vorhanden), wendet lib/leitner.ts::
// evaluate() an und schreibt den neuen Stand zurueck (upsert auf card_id).
// Ueber den Service-Role-Client wie jede andere Schreib-Route -- quiz_
// progress hat bewusst keine Client-Policy fuer INSERT/UPDATE.

function rowToProgress(row: QuizProgressRow | null): QuizProgress | null {
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

export async function POST(req: NextRequest) {
  let body: { cardId?: number; grade?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  const cardId = body.cardId;
  const grade = body.grade as Grade | undefined;

  if (!cardId || !grade || !GRADES.includes(grade)) {
    return NextResponse.json(
      { success: false, error: `cardId und grade (einer von ${GRADES.join(", ")}) sind erforderlich.` },
      { status: 400 }
    );
  }

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { data: existingRow, error: readError } = await supabaseAdmin
    .from("quiz_progress")
    .select("*")
    .eq("card_id", cardId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ success: false, error: readError.message }, { status: 500 });
  }

  const nextProgress = evaluate(rowToProgress(existingRow), grade, Date.now());

  const { data, error: writeError } = await supabaseAdmin
    .from("quiz_progress")
    .upsert(
      {
        card_id: cardId,
        box: nextProgress.box,
        due_at: new Date(nextProgress.dueAt).toISOString(),
        last_seen_at: new Date(nextProgress.lastSeenAt!).toISOString(),
        correct_streak: nextProgress.correctStreak,
        total_correct: nextProgress.totalCorrect,
        total_hard: nextProgress.totalHard,
        total_wrong: nextProgress.totalWrong,
        history: nextProgress.history,
      },
      { onConflict: "card_id" }
    )
    .select()
    .single();

  if (writeError) {
    return NextResponse.json({ success: false, error: writeError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, progress: data });
}
