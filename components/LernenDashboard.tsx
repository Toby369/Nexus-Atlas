"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ChecklistRun, KnowledgeBaseEntry, QuizCard, QuizProgressRow } from "@/lib/types";
import {
  boxDistribution,
  isDue,
  type Grade,
  type QuizProgress,
} from "@/lib/leitner";
import { learningStreak, overview, perCategory, type QuizEntry } from "@/lib/quizStatistik";
import type { MeinSystemChecklistData } from "@/lib/meinSystemContext";
import type { CvdFootprintData, GussSignalData, VwapVectorData } from "@/lib/tradingIndicatorsContext";
import type { ChartStructureData } from "@/lib/chartStructureContext";
import type { LevelStructureZone } from "@/lib/levelStructureContext";
import PanelInfo from "@/components/PanelInfo";
import { CardsPanel, SessionPanel, StatsPanel } from "@/components/lernen/QuizPanels";
import WissenPanel from "@/components/lernen/WissenPanel";
import BuecherPanel from "@/components/lernen/BuecherPanel";

// Lernplattform-Kachel (Leitner-Karteikasten), Nutzer-Wunsch "wie im
// Trading Journal" -- Konzept aus KachelQuiz.vue/Lernen.vue im Crypto-
// Trading-Journal. Lesen laeuft direkt ueber den Anon-Key (Public read
// access), Schreiben (Karte anlegen/bearbeiten/loeschen, Bewertung) ueber
// /api/quiz/*.

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

type Tab = "lernen" | "karten" | "statistik" | "wissen" | "buecher";

export default function LernenDashboard({
  initialCards,
  initialProgress,
  knowledgeBase,
  meinSystemData,
  initialChecklistHistory,
  gussData,
  vwapVectorData,
  cvdData,
  chartStructureData,
  levelStructureZones,
}: {
  initialCards: QuizCard[];
  initialProgress: QuizProgressRow[];
  knowledgeBase: KnowledgeBaseEntry[];
  meinSystemData: MeinSystemChecklistData;
  initialChecklistHistory: ChecklistRun[];
  gussData: GussSignalData;
  vwapVectorData: VwapVectorData;
  cvdData: CvdFootprintData;
  chartStructureData: ChartStructureData;
  levelStructureZones: LevelStructureZone[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [progressRows, setProgressRows] = useState(initialProgress);
  const [tab, setTab] = useState<Tab>("lernen");
  // Referenzzeitpunkt fuer "faellig" -- einmal beim Mounten gesetzt und nach
  // jeder Lernsitzung (refetch) erneuert, statt Date.now() bei jedem Render
  // neu aufzurufen (react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());

  async function refetch() {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("quiz_cards").select("*").order("id"),
      supabase.from("quiz_progress").select("*"),
    ]);
    if (c) setCards(c);
    if (p) setProgressRows(p);
    setNow(Date.now());
  }

  const progressByCard = useMemo(
    () => new Map(progressRows.map((r) => [r.card_id, r])),
    [progressRows]
  );

  const entries: QuizEntry[] = useMemo(
    () => cards.map((card) => ({ card, progress: rowToProgress(progressByCard.get(card.id)) })),
    [cards, progressByCard]
  );

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

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {([
          { id: "lernen", label: "Lernen" },
          { id: "karten", label: "Karten" },
          { id: "statistik", label: "Statistik" },
          { id: "wissen", label: "Wissen" },
          { id: "buecher", label: "Bücher" },
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
      {tab === "buecher" && <BuecherPanel />}
      {tab === "wissen" && (
        <WissenPanel
          knowledgeBase={knowledgeBase}
          meinSystemData={meinSystemData}
          initialChecklistHistory={initialChecklistHistory}
          gussData={gussData}
          vwapVectorData={vwapVectorData}
          cvdData={cvdData}
          chartStructureData={chartStructureData}
          levelStructureZones={levelStructureZones}
        />
      )}
    </div>
  );
}
