"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { QuizCard, QuizProgressRow } from "@/lib/types";
import {
  BOX_MAX,
  GRADES,
  boxDistribution,
  isDue,
  type Grade,
  type QuizProgress,
} from "@/lib/leitner";
import { learningStreak, overview, perCategory, type QuizEntry } from "@/lib/quizStatistik";
import PanelInfo from "@/components/PanelInfo";

// Lernplattform-Kachel (Leitner-Karteikasten), Nutzer-Wunsch "wie im
// Trading Journal" -- Konzept aus KachelQuiz.vue/Lernen.vue im Crypto-
// Trading-Journal. Lesen laeuft direkt ueber den Anon-Key (Public read
// access), Schreiben (Karte anlegen/bearbeiten/loeschen, Bewertung) ueber
// /api/quiz/*.

const GRADE_LABELS: Record<Grade, string> = {
  vergessen: "Vergessen",
  schwer: "Schwer",
  gut: "Gut",
  leicht: "Leicht",
};

const GRADE_STYLES: Record<Grade, string> = {
  vergessen: "border-down/40 bg-down/10 text-down",
  schwer: "border-accent/40 bg-accent/10 text-accent",
  gut: "border-border text-text-muted",
  leicht: "border-up/40 bg-up/10 text-up",
};

const INFO_TEXT = [
  "Was das ist: ein Leitner-Karteikasten fuer eigene Lernkarten (z.B. zu den Nexus-Faktoren oder deinen Handelsregeln) -- Konzept aus dem Crypto-Trading-Journal.",
  "Vier Boxen: eine neue Karte startet in Box 1 (sofort wieder faellig). 'Vergessen' wirft sie zurueck auf Box 1, 'Schwer' bleibt in der aktuellen Box, 'Gut' geht eine Box weiter, 'Leicht' zwei -- je hoeher die Box, desto seltener kommt die Karte wieder dran (0/1/3/7 Tage).",
  "'Schwer' zaehlt bewusst NICHT als Treffer in der Erfolgsquote -- sonst waere sie genau bei den Karten zu gut, die noch nicht sitzen.",
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

type Tab = "lernen" | "karten" | "statistik";

export default function LernenDashboard({
  initialCards,
  initialProgress,
}: {
  initialCards: QuizCard[];
  initialProgress: QuizProgressRow[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [progressRows, setProgressRows] = useState(initialProgress);
  const [tab, setTab] = useState<Tab>("lernen");

  async function refetch() {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("quiz_cards").select("*").order("id"),
      supabase.from("quiz_progress").select("*"),
    ]);
    if (c) setCards(c);
    if (p) setProgressRows(p);
  }

  const progressByCard = useMemo(
    () => new Map(progressRows.map((r) => [r.card_id, r])),
    [progressRows]
  );

  const entries: QuizEntry[] = useMemo(
    () => cards.map((card) => ({ card, progress: rowToProgress(progressByCard.get(card.id)) })),
    [cards, progressByCard]
  );

  const now = Date.now();
  const activeEntries = entries.filter((e) => e.card.active);
  const dueEntries = activeEntries.filter((e) => isDue(now, e.progress));
  const boxes = boxDistribution(activeEntries.map((e) => ({ box: e.progress?.box ?? 1 })));
  const streak = learningStreak(entries, now);
  const stats = overview(entries);
  const categories = perCategory(entries);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-lg font-semibold text-text">Lernen</h2>
        <PanelInfo title="Lernen" content={INFO_TEXT} />
      </div>

      <div className="flex gap-1 border-b border-border">
        {([
          { id: "lernen", label: "Lernen" },
          { id: "karten", label: "Karten" },
          { id: "statistik", label: "Statistik" },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id ? "text-text border-accent" : "text-text-faint border-transparent hover:text-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lernen" && (
        <SessionPanel dueEntries={dueEntries} boxes={boxes} streak={streak} onDone={refetch} />
      )}
      {tab === "karten" && <CardsPanel cards={cards} onChanged={refetch} />}
      {tab === "statistik" && <StatsPanel stats={stats} streak={streak} categories={categories} />}
    </div>
  );
}

function SessionPanel({
  dueEntries,
  boxes,
  streak,
  onDone,
}: {
  dueEntries: QuizEntry[];
  boxes: Record<number, number>;
  streak: number;
  onDone: () => void;
}) {
  const [queue, setQueue] = useState<QuizEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [summary, setSummary] = useState<{ correct: number; hard: number; wrong: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function start() {
    setQueue([...dueEntries]);
    setIndex(0);
    setRevealed(false);
    setExplanationOpen(false);
    setSummary({ correct: 0, hard: 0, wrong: 0 });
  }

  async function grade(g: Grade) {
    if (!queue || submitting) return;
    setSubmitting(true);
    const entry = queue[index];
    try {
      await fetch("/api/quiz/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: entry.card.id, grade: g }),
      });
    } finally {
      setSubmitting(false);
    }

    setSummary((s) => ({
      correct: (s?.correct ?? 0) + (g === "gut" || g === "leicht" ? 1 : 0),
      hard: (s?.hard ?? 0) + (g === "schwer" ? 1 : 0),
      wrong: (s?.wrong ?? 0) + (g === "vergessen" ? 1 : 0),
    }));

    if (index + 1 < queue.length) {
      setIndex(index + 1);
      setRevealed(false);
      setExplanationOpen(false);
    } else {
      onDone();
    }
  }

  function finish() {
    setQueue(null);
    setSummary(null);
  }

  const boxTotal = Object.values(boxes).reduce((a, b) => a + b, 0);

  if (queue && index < queue.length) {
    const entry = queue[index];
    return (
      <div className="rounded-lg border border-border bg-surface p-5 space-y-4 max-w-xl mx-auto">
        <div className="flex items-center justify-between text-xs text-text-faint">
          <span>
            Karte {index + 1} / {queue.length}
          </span>
          <button type="button" onClick={finish} className="underline decoration-dotted">
            Abbrechen
          </button>
        </div>

        <div className="min-h-[140px] flex flex-col justify-center text-center gap-3 py-4">
          <p className="text-base font-medium text-text">{entry.card.question}</p>
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-sm text-text-faint underline decoration-dotted mt-2"
            >
              Antwort zeigen
            </button>
          ) : (
            <div className="space-y-2 mt-2">
              <p className="text-sm text-text-muted">{entry.card.answer}</p>
              {entry.card.explanation && (
                <>
                  <button
                    type="button"
                    onClick={() => setExplanationOpen((o) => !o)}
                    className="text-xs text-text-faint underline decoration-dotted"
                  >
                    {explanationOpen ? "Erklärung ausblenden" : "Erklärung anzeigen"}
                  </button>
                  {explanationOpen && (
                    <p className="text-xs text-text-faint">{entry.card.explanation}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {revealed && (
          <div className="grid grid-cols-4 gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => grade(g)}
                disabled={submitting}
                className={`px-2 py-2 text-xs rounded-md border font-medium disabled:opacity-40 ${GRADE_STYLES[g]}`}
              >
                {GRADE_LABELS[g]}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (summary && !queue) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 space-y-3 max-w-xl mx-auto text-center">
        <p className="text-sm font-medium text-text">Sitzung beendet</p>
        <div className="flex justify-center gap-6">
          <div>
            <p className="text-xl font-bold text-up">{summary.correct}</p>
            <p className="text-xs text-text-faint">Gewusst</p>
          </div>
          <div>
            <p className="text-xl font-bold text-accent">{summary.hard}</p>
            <p className="text-xs text-text-faint">Schwer</p>
          </div>
          <div>
            <p className="text-xl font-bold text-down">{summary.wrong}</p>
            <p className="text-xs text-text-faint">Vergessen</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSummary(null)}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text"
        >
          Fertig
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3 max-w-xl mx-auto text-center">
      <p className="text-3xl font-bold text-text">{dueEntries.length}</p>
      <p className="text-xs text-text-faint">fällig heute</p>

      {boxTotal > 0 && (
        <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-raised max-w-xs mx-auto">
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

      {dueEntries.length > 0 ? (
        <button
          type="button"
          onClick={start}
          className="px-4 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent"
        >
          Sitzung starten
        </button>
      ) : (
        <p className="text-xs text-text-faint">Nichts fällig -- schau später wieder vorbei.</p>
      )}
    </div>
  );
}

function CardsPanel({ cards, onChanged }: { cards: QuizCard[]; onChanged: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCard() {
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, explanation: explanation || null, category: category || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setQuestion("");
      setAnswer("");
      setExplanation("");
      setCategory("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(card: QuizCard) {
    await fetch("/api/quiz/cards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: card.id, active: !card.active }),
    });
    onChanged();
  }

  async function deleteCard(id: number) {
    await fetch(`/api/quiz/cards?id=${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-5 space-y-2">
        <p className="text-sm font-medium text-text">Neue Karte</p>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Frage"
          className="w-full bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
        />
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Antwort"
          className="w-full bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
        />
        <input
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="Erklärung (optional)"
          className="w-full bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Kategorie (optional)"
          className="w-full bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
        />
        <button
          type="button"
          onClick={addCard}
          disabled={saving || !question.trim() || !answer.trim()}
          className="px-3 py-1.5 text-xs rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40"
        >
          {saving ? "Speichert…" : "Karte anlegen"}
        </button>
        {error && <p className="text-xs text-down">{error}</p>}
      </div>

      <div className="space-y-2">
        {cards.length === 0 && <p className="text-xs text-text-faint">Noch keine Karten angelegt.</p>}
        {cards.map((card) => (
          <div
            key={card.id}
            className={`rounded-lg border border-border bg-surface p-3 flex items-start justify-between gap-3 ${
              !card.active ? "opacity-50" : ""
            }`}
          >
            <div>
              <p className="text-sm text-text">{card.question}</p>
              <p className="text-xs text-text-faint">{card.answer}</p>
              {card.category && (
                <span className="inline-block mt-1 text-[10px] uppercase tracking-wide text-text-faint">
                  {card.category}
                </span>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => toggleActive(card)}
                className="text-xs text-text-faint underline decoration-dotted"
              >
                {card.active ? "Deaktivieren" : "Aktivieren"}
              </button>
              <button
                type="button"
                onClick={() => deleteCard(card.id)}
                className="text-xs text-down underline decoration-dotted"
              >
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsPanel({
  stats,
  streak,
  categories,
}: {
  stats: ReturnType<typeof overview>;
  streak: number;
  categories: ReturnType<typeof perCategory>;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        <div>
          <p className="text-xl font-bold text-text">{stats.total}</p>
          <p className="text-xs text-text-faint">Karten gesamt</p>
        </div>
        <div>
          <p className="text-xl font-bold text-up">
            {stats.mastered} <span className="text-xs font-normal">({Math.round(stats.masteredRate * 100)}%)</span>
          </p>
          <p className="text-xs text-text-faint">
            Gemeistert (Box {BOX_MAX})
          </p>
        </div>
        <div>
          <p className="text-xl font-bold text-text">
            {stats.successRate === null ? "—" : `${Math.round(stats.successRate * 100)}%`}
          </p>
          <p className="text-xs text-text-faint">Erfolgsquote</p>
        </div>
        <div>
          <p className="text-xl font-bold text-accent">{streak}</p>
          <p className="text-xs text-text-faint">Tage Serie</p>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5 space-y-2">
          <p className="text-sm font-medium text-text">Nach Kategorie</p>
          {categories.map((c) => (
            <div key={c.category} className="flex items-center justify-between text-xs">
              <span className="text-text-muted">{c.category}</span>
              <span className={c.thin ? "text-text-faint" : "text-text"}>
                {Math.round(c.rate * 100)}% {c.thin && "(wenig Daten)"} · {c.count} Bewertungen
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
