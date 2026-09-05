// Auswertung des Lern-Karteikastens -- portiert aus
// src/utils/lernStatistik.js im Crypto-Trading-Journal. Reines Modul: kein
// React, kein Netz, keine Datenbank.
//
// Eingabe ist ueberall dieselbe Form: eine Liste von { card, progress },
// progress darf null sein (Karte noch nie bewertet).

import { BOX_MAX, type Grade, type QuizProgress } from "./leitner";
import type { QuizCard } from "./types";

export interface QuizEntry {
  card: QuizCard;
  progress: QuizProgress | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ab wie vielen Bewertungen eine Kategorie-Quote eine Aussage ist, nicht Zufall. */
export const MIN_GROUP = 3;

function evaluationCount(progress: QuizProgress | null): number {
  return (progress?.totalCorrect ?? 0) + (progress?.totalHard ?? 0) + (progress?.totalWrong ?? 0);
}

/** Kalendertag in lokaler Zeit als sortierbarer Schluessel. */
function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function historyEntries(entries: QuizEntry[]): { t: number; grade: Grade; category: string }[] {
  const all: { t: number; grade: Grade; category: string }[] = [];
  for (const e of entries) {
    for (const h of e.progress?.history ?? []) {
      all.push({ t: h.t, grade: h.grade, category: e.card.category ?? "" });
    }
  }
  return all.sort((a, b) => a.t - b.t);
}

export interface QuizOverview {
  total: number;
  mastered: number;
  masteredRate: number;
  started: number;
  totalEvaluations: number;
  successRate: number | null;
}

/**
 * Ueberblick -- die vier Kopfzahlen der Statistik-Seite. `successRate` ist
 * `null`, solange noch keine einzige Karte bewertet wurde (leeres Deck) --
 * 0% waere eine falsche Aussage ueber eine Sitzung, die es noch nicht gab.
 */
export function overview(entries: QuizEntry[]): QuizOverview {
  const active = entries.filter((e) => e.card.active);
  const withProgress = active.filter((e) => e.progress);
  const mastered = active.filter((e) => (e.progress?.box ?? 0) === BOX_MAX).length;
  const started = withProgress.filter((e) => evaluationCount(e.progress) > 0).length;
  const correct = withProgress.reduce((a, e) => a + (e.progress?.totalCorrect ?? 0), 0);
  const totalEvaluations = withProgress.reduce((a, e) => a + evaluationCount(e.progress), 0);

  return {
    total: active.length,
    mastered,
    masteredRate: active.length ? mastered / active.length : 0,
    started,
    totalEvaluations,
    successRate: totalEvaluations ? correct / totalEvaluations : null,
  };
}

/** Wiederholungen der letzten `days` Tage (heute eingeschlossen), aelteste zuerst. */
export function perDay(entries: QuizEntry[], nowMs: number, days = 14): { day: string; count: number }[] {
  const counter = new Map<string, number>();
  for (const h of historyEntries(entries)) {
    const key = dayKey(h.t);
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }
  const result: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(nowMs - i * DAY_MS);
    result.push({ day: key, count: counter.get(key) ?? 0 });
  }
  return result;
}

/**
 * Lernserie -- an wie vielen Tagen in Folge zuletzt mindestens eine Karte
 * bewertet wurde. Zaehlt ab heute, wenn heute schon gelernt wurde, sonst ab
 * gestern -- ein Tag, der noch nicht vorbei ist, darf die Serie nicht
 * abbrechen lassen.
 */
export function learningStreak(entries: QuizEntry[], nowMs: number): number {
  const days = new Set(historyEntries(entries).map((h) => dayKey(h.t)));
  let cursor = nowMs;
  if (!days.has(dayKey(cursor))) cursor -= DAY_MS;
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

export interface QuizCategoryStat {
  category: string;
  count: number;
  rate: number;
  thin: boolean;
}

/**
 * Erfolg nach Kategorie -- schwaechste zuerst. Kategorien ohne jede
 * Bewertung fehlen ganz; Kategorien unter MIN_GROUP Bewertungen tragen
 * thin=true statt eine Quote zu behaupten, die noch Zufall sein kann.
 */
export function perCategory(entries: QuizEntry[]): QuizCategoryStat[] {
  const groups = new Map<string, { correct: number; total: number }>();
  for (const e of entries) {
    const cat = e.card.category;
    if (!cat) continue;
    const total = evaluationCount(e.progress);
    if (total === 0) continue;
    const g = groups.get(cat) ?? { correct: 0, total: 0 };
    g.correct += e.progress?.totalCorrect ?? 0;
    g.total += total;
    groups.set(cat, g);
  }
  return [...groups.entries()]
    .map(([category, g]) => ({ category, count: g.total, rate: g.correct / g.total, thin: g.total < MIN_GROUP }))
    .sort((a, b) => a.rate - b.rate);
}
