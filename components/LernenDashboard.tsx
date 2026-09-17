"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ChecklistRun, KnowledgeBaseEntry, QuizCard, QuizProgressRow } from "@/lib/types";
import {
  BOX_MAX,
  GRADES,
  boxDistribution,
  isDue,
  type Grade,
  type QuizProgress,
} from "@/lib/leitner";
import { learningStreak, overview, perCategory, type QuizEntry } from "@/lib/quizStatistik";
import type { MeinSystemChecklistData } from "@/lib/meinSystemContext";
import type { GussSignalData } from "@/lib/tradingIndicatorsContext";
import PanelInfo from "@/components/PanelInfo";
import { GussSignalCard } from "@/components/TradingIndicatorsCards";

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

type Tab = "lernen" | "karten" | "statistik" | "wissen";

export default function LernenDashboard({
  initialCards,
  initialProgress,
  knowledgeBase,
  meinSystemData,
  initialChecklistHistory,
  gussData,
}: {
  initialCards: QuizCard[];
  initialProgress: QuizProgressRow[];
  knowledgeBase: KnowledgeBaseEntry[];
  meinSystemData: MeinSystemChecklistData;
  initialChecklistHistory: ChecklistRun[];
  gussData: GussSignalData;
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
          { id: "wissen", label: "Wissen" },
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
      {tab === "wissen" && (
        <WissenPanel
          knowledgeBase={knowledgeBase}
          meinSystemData={meinSystemData}
          initialChecklistHistory={initialChecklistHistory}
          gussData={gussData}
        />
      )}
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
  // Nutzer-Wunsch 15.09.2026 ("waere es sinnvoll, wenn ich bei der Frage
  // eine Antwort schreiben koennte?"): reines Aktiv-Abruf-Feld vor "Antwort
  // zeigen" -- bewusst OHNE automatische Bewertung/Speicherung (Freitext-
  // Vergleich waere fehleranfaellig, siehe Chat-Begruendung). Die eigentliche
  // Bewertung bleibt bei den 4 Leitner-Buttons.
  const [draftAnswer, setDraftAnswer] = useState("");

  function start() {
    setQueue([...dueEntries]);
    setIndex(0);
    setRevealed(false);
    setExplanationOpen(false);
    setDraftAnswer("");
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
      setDraftAnswer("");
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
            <div className="space-y-2 text-left">
              <textarea
                value={draftAnswer}
                onChange={(e) => setDraftAnswer(e.target.value)}
                placeholder="Deine Antwort (optional, wird nicht gespeichert oder bewertet — nur zum Selbst-Testen)…"
                rows={2}
                className="w-full text-sm px-3 py-2 rounded-md border border-border bg-surface-raised text-text placeholder:text-text-faint resize-none"
              />
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="text-sm text-text-faint underline decoration-dotted mx-auto block"
              >
                Antwort zeigen
              </button>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {draftAnswer.trim() && (
                <p className="text-xs text-text-faint italic">Deine Antwort: „{draftAnswer.trim()}“</p>
              )}
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

// --- Wissen (Welz/Salomon/Mein System) -------------------------------------
// Nutzer-Wunsch 15.09.2026: "welz und salomon integrieren, meine trading
// regeln in nexus integrieren". Reine Nachschlage-Sektion aus knowledge_base
// (statischer Text, siehe lib/knowledgeBaseContext.ts) + drei Checklisten.
// Checkbox-Zustand ist bewusst NUR lokaler React-State (keine Persistenz) --
// eine Momentaufnahme je Aufruf, siehe Umsetzungsplan Entscheidung 4.

type WissenModule = "welz" | "salomon" | "mein_system";

const WELZ_CHECKLIST = [
  "Trading-Journal ist aktuell geführt",
  "Positionsgrösse ist regelkonform festgelegt (nicht emotional)",
  "Kein FOMO- oder Revenge-Impuls erkennbar",
  "Handelsplan ist schriftlich vor Entry fixiert (if-X-then-Y)",
  'Setup wurde nicht bewusst "passend gesucht" (Confirmation-Bias-Check)',
];

const SALOMON_CHECKLIST = [
  "Aktuelle Phase bestimmt (Akkumulation/Markup/Markdown/Distribution)",
  "Candlestick-Signal an relevantem Level vorhanden",
  "Trendstruktur eindeutig (HH/HL vs. LH/LL, kein Seitwärts-Chop)",
  "Multi-Timeframe-Konfluenz geprüft (höherer Zeitrahmen bestätigt)",
];

const MEIN_SYSTEM_MANUAL_CHECKLIST = [
  "4H-Breakout bestätigt",
  "1H-Retest erfolgt",
  "EMA-D13-Filter erfüllt (Preis vs. EMA13 unten prüfen)",
  "Keylevel-Konfluenz vorhanden",
  "RSI/StochRSI-Divergenz-Check auf 4H",
];

// Nutzer-Wunsch 15.09.2026 ("leichtgewichtige Snapshot-Protokollierung"):
// der Haken-Zustand selbst bleibt lokaler State (kein Autosave pro Klick),
// aber ein "Fertig"-Klick schreibt einen Snapshot nach checklist_runs --
// siehe Migration create_checklist_runs_table + /api/checklist/runs. Kein
// Trade-Bezug, nur "wann wie vollstaendig durchgegangen" -- bewusst kein
// vollwertiges Trade-Journal (waere ein eigenes, groesseres Feature).
function ChecklistBlock({
  title,
  items,
  module,
  history,
  onSaved,
}: {
  title: string;
  items: string[];
  module: WissenModule;
  history: ChecklistRun[];
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const doneCount = Object.values(checked).filter(Boolean).length;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const checkedItems = items.filter((_, i) => checked[i]);
      await fetch("/api/checklist/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, checkedItems, totalCount: items.length }),
      });
      setChecked({});
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">
          {title} ({doneCount}/{items.length})
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-accent/40 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Speichern…" : "Fertig"}
        </button>
      </div>
      {items.map((item, i) => (
        <label key={i} className="flex items-start gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={checked[i] ?? false}
            onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
            className="mt-0.5"
          />
          <span className={checked[i] ? "line-through text-text-faint" : ""}>{item}</span>
        </label>
      ))}
      {history.length > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-border/60 space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Verlauf</p>
          {history.map((run) => {
            const full = run.checked_count === run.total_count && run.total_count > 0;
            const empty = run.checked_count === 0;
            return (
              <div key={run.id} className="flex items-center justify-between text-[10px] text-text-faint">
                <span>
                  {new Date(run.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}{" "}
                  {new Date(run.created_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={full ? "text-up" : empty ? "text-down" : "text-text-muted"}>
                  {run.checked_count}/{run.total_count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeSections({ entries }: { entries: KnowledgeBaseEntry[] }) {
  const bySection = useMemo(() => {
    const map = new Map<string, KnowledgeBaseEntry[]>();
    for (const e of entries) {
      const list = map.get(e.section) ?? [];
      list.push(e);
      map.set(e.section, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  if (bySection.length === 0) return <p className="text-xs text-text-faint">Keine Einträge.</p>;

  return (
    <div className="space-y-3">
      {bySection.map(([section, sectionEntries]) => (
        <div key={section} className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{section}</p>
          {sectionEntries.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-surface-raised p-3">
              <p className="text-xs font-medium text-text">{e.title}</p>
              <p className="text-xs text-text-muted mt-0.5 whitespace-pre-line">{e.content}</p>
              {e.source && <p className="text-[10px] text-text-faint mt-1">Quelle: {e.source}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function formatPct(value: number | null, digits = 3): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function MeinSystemLiveValues({ data }: { data: MeinSystemChecklistData }) {
  const fundingOk = data.fundingUnderThreshold;
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-1.5">
      <p className="text-xs font-medium text-text-muted">
        Live-Werte {data.dataAsOf && <span className="text-text-faint">(Stand market_states)</span>}
      </p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Funding aktuell (Schwelle 0,05%/8h)</span>
        <span className={fundingOk === null ? "text-text-faint" : fundingOk ? "text-up" : "text-down"}>
          {formatPct(data.fundingRatePct)} {fundingOk !== null && (fundingOk ? "✓ unter Schwelle" : "über Schwelle")}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">OI-Delta (1h)</span>
        <span className="text-text">
          {formatPct(data.oiDeltaPct, 2)}{" "}
          {data.oiPriceDirection === 1 ? "↑" : data.oiPriceDirection === -1 ? "↓" : ""}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">EMA13 / EMA50 / EMA200 (dein System vs. NEXUS-Trend-Regime)</span>
        <span className="text-text">
          {data.ema13?.toFixed(0) ?? "—"} / {data.ema50?.toFixed(0) ?? "—"} / {data.ema200?.toFixed(0) ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Preis</span>
        <span className="text-text">{data.closePrice?.toFixed(0) ?? "—"}</span>
      </div>
    </div>
  );
}

const CHECKLIST_HISTORY_PER_MODULE = 5;

function WissenPanel({
  knowledgeBase,
  meinSystemData,
  initialChecklistHistory,
  gussData,
}: {
  knowledgeBase: KnowledgeBaseEntry[];
  meinSystemData: MeinSystemChecklistData;
  initialChecklistHistory: ChecklistRun[];
  gussData: GussSignalData;
}) {
  const [module, setModule] = useState<WissenModule>("welz");
  const [checklistHistory, setChecklistHistory] = useState(initialChecklistHistory);
  const entries = knowledgeBase.filter((e) => e.module === module);

  async function refetchChecklistHistory() {
    const { data } = await supabase
      .from("checklist_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setChecklistHistory(data);
  }

  function historyFor(m: WissenModule): ChecklistRun[] {
    return checklistHistory.filter((r) => r.module === m).slice(0, CHECKLIST_HISTORY_PER_MODULE);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([
          { id: "welz", label: "Welz (Psychologie)" },
          { id: "salomon", label: "Salomon (Chartanalyse)" },
          { id: "mein_system", label: "Mein System" },
        ] as { id: WissenModule; label: string }[]).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModule(m.id)}
            className={`px-2.5 py-1 text-xs rounded-md border ${
              module === m.id
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-faint hover:text-text-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <KnowledgeSections entries={entries} />

      {module === "welz" && (
        <ChecklistBlock
          title="Pre-Entry-Checkliste"
          items={WELZ_CHECKLIST}
          module="welz"
          history={historyFor("welz")}
          onSaved={refetchChecklistHistory}
        />
      )}
      {module === "salomon" && (
        <ChecklistBlock
          title="Formationscheck"
          items={SALOMON_CHECKLIST}
          module="salomon"
          history={historyFor("salomon")}
          onSaved={refetchChecklistHistory}
        />
      )}
      {module === "mein_system" && (
        <div className="space-y-3">
          <MeinSystemLiveValues data={meinSystemData} />
          <GussSignalCard data={gussData} />
          <ChecklistBlock
            title="Entry-Regelwerk"
            items={MEIN_SYSTEM_MANUAL_CHECKLIST}
            module="mein_system"
            history={historyFor("mein_system")}
            onSaved={refetchChecklistHistory}
          />
        </div>
      )}
    </div>
  );
}
