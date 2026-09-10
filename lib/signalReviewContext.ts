// Kontext-Builder fuer die KI-Rueckblick-Kachel (Periodischer KI-Rueckblick,
// Phase 3, 10.09.2026) -- liest AUSSCHLIESSLICH die in Phase 2
// (compute_signal_stats(), signal_stats_results) bereits fertig berechneten
// Zahlen. Keine eigene Statistik hier, mit EINER bewussten Ausnahme: das
// decay_flag je Zelle ist ein einfacher, regelbasierter Vergleich
// (90d-Edge deutlich schwaecher als Gesamt-Edge, beide mit Mindeststich-
// probe) -- das nimmt der KI die Berechnung ab, nicht die Interpretation
// (sie ordnet ein, WARUM/OB das relevant ist, erfindet aber keine eigene
// Zahl). Gleiches Prinzip wie lib/signalEngineContext.ts.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";

const MIN_SAMPLE = 10;
// Schwellen fuer "deutlich schwaecher" -- bewusst grosszuegig (kein
// Rauschen als Verfall fehlinterpretieren), siehe compute_signal_stats()-
// Kommentar fuer denselben MIN_N-Gedanken.
const DIRECTIONAL_DECAY_THRESHOLD_PP = 5;
const MAGNITUDE_DECAY_THRESHOLD_PCT = 0.1;

export interface SignalReviewWindowStats {
  n: number;
  hit_rate_pct: number | null;
  baseline_hit_rate_pct: number | null;
  avg_return_pct: number;
  avg_abs_return_pct: number;
  baseline_avg_abs_return_pct: number | null;
  raw_p_value: number | null;
  significant_after_bh: boolean | null;
}

export interface SignalReviewCell {
  category: string;
  signal_type: string;
  horizon_hours: number;
  direction_expected: "bullish" | "bearish" | null;
  test_type: "directional" | "magnitude";
  window_90d: SignalReviewWindowStats | null;
  window_all: SignalReviewWindowStats | null;
  // null = nicht beurteilbar (mind. ein Fenster unter der Mindeststichprobe).
  decay_flag: boolean | null;
}

export interface SignalReviewContext {
  computed_at: string;
  total_cells: number;
  cells_with_min_sample: number;
  significant_cells: number;
  insufficient_data_cells: number;
  decaying_cells: number;
  cells: SignalReviewCell[];
}

export interface SignalStatsRow {
  window_label: "90d" | "all";
  category: string;
  signal_type: string;
  horizon_hours: number;
  direction_expected: "bullish" | "bearish" | null;
  test_type: "directional" | "magnitude";
  n: number;
  hit_rate_pct: number | null;
  baseline_hit_rate_pct: number | null;
  avg_return_pct: number;
  avg_abs_return_pct: number;
  baseline_avg_abs_return_pct: number | null;
  raw_p_value: number | null;
  significant_after_bh: boolean | null;
  computed_at: string;
}
type StatsRow = SignalStatsRow;

function toWindowStats(row: StatsRow | undefined): SignalReviewWindowStats | null {
  if (!row) return null;
  return {
    n: row.n,
    hit_rate_pct: row.hit_rate_pct,
    baseline_hit_rate_pct: row.baseline_hit_rate_pct,
    avg_return_pct: row.avg_return_pct,
    avg_abs_return_pct: row.avg_abs_return_pct,
    baseline_avg_abs_return_pct: row.baseline_avg_abs_return_pct,
    raw_p_value: row.raw_p_value,
    significant_after_bh: row.significant_after_bh,
  };
}

// Vergleicht denselben "Edge" (Trefferquote bzw. Ø|Bewegung| jeweils UEBER
// der Baseline) zwischen 90d- und Gesamtfenster -- nur wenn BEIDE Fenster
// die Mindeststichprobe erreichen (sonst waere ein Unterschied nur Rauschen
// aus der kleineren Stichprobe, kein echter Verfall).
function computeDecayFlag(
  testType: "directional" | "magnitude",
  window90d: SignalReviewWindowStats | null,
  windowAll: SignalReviewWindowStats | null
): boolean | null {
  if (!window90d || !windowAll) return null;
  if (window90d.n < MIN_SAMPLE || windowAll.n < MIN_SAMPLE) return null;

  if (testType === "directional") {
    const edge90d = (window90d.hit_rate_pct ?? 0) - (window90d.baseline_hit_rate_pct ?? 0);
    const edgeAll = (windowAll.hit_rate_pct ?? 0) - (windowAll.baseline_hit_rate_pct ?? 0);
    return edge90d < edgeAll - DIRECTIONAL_DECAY_THRESHOLD_PP;
  }

  const edge90d = window90d.avg_abs_return_pct - (window90d.baseline_avg_abs_return_pct ?? 0);
  const edgeAll = windowAll.avg_abs_return_pct - (windowAll.baseline_avg_abs_return_pct ?? 0);
  return edge90d < edgeAll - MAGNITUDE_DECAY_THRESHOLD_PCT;
}

// Reine Aggregations-/Vergleichslogik, getrennt vom Supabase-Zugriff --
// dieselbe Aufteilung wie lib/divergenceRadar.ts (testbar, DB-frei) vs.
// lib/divergenceRadarContext.ts (Datenbeschaffung).
export function aggregateSignalReviewCells(rows: SignalStatsRow[]): SignalReviewContext | null {
  if (rows.length === 0) return null;

  const byCell = new Map<string, { row90d?: StatsRow; rowAll?: StatsRow }>();
  for (const row of rows) {
    const key = `${row.category}|${row.signal_type}|${row.horizon_hours}`;
    const entry = byCell.get(key) ?? {};
    if (row.window_label === "90d") entry.row90d = row;
    else entry.rowAll = row;
    byCell.set(key, entry);
  }

  let computedAt = rows[0].computed_at;
  let cellsWithMinSample = 0;
  let significantCells = 0;
  let insufficientDataCells = 0;
  let decayingCells = 0;

  const cells: SignalReviewCell[] = [];
  for (const { row90d, rowAll } of byCell.values()) {
    const base = (row90d ?? rowAll)!;
    if (row90d && row90d.computed_at > computedAt) computedAt = row90d.computed_at;
    if (rowAll && rowAll.computed_at > computedAt) computedAt = rowAll.computed_at;

    const window_90d = toWindowStats(row90d);
    const window_all = toWindowStats(rowAll);
    const decay_flag = computeDecayFlag(base.test_type, window_90d, window_all);

    const hasMinSample = (window_90d?.n ?? 0) >= MIN_SAMPLE || (window_all?.n ?? 0) >= MIN_SAMPLE;
    const isSignificant = Boolean(window_90d?.significant_after_bh) || Boolean(window_all?.significant_after_bh);
    const isInsufficient = (window_90d?.n ?? 0) < MIN_SAMPLE && (window_all?.n ?? 0) < MIN_SAMPLE;

    if (hasMinSample) cellsWithMinSample++;
    if (isSignificant) significantCells++;
    if (isInsufficient) insufficientDataCells++;
    if (decay_flag) decayingCells++;

    cells.push({
      category: base.category,
      signal_type: base.signal_type,
      horizon_hours: base.horizon_hours,
      direction_expected: base.direction_expected,
      test_type: base.test_type,
      window_90d,
      window_all,
      decay_flag,
    });
  }

  return {
    computed_at: computedAt,
    total_cells: cells.length,
    cells_with_min_sample: cellsWithMinSample,
    significant_cells: significantCells,
    insufficient_data_cells: insufficientDataCells,
    decaying_cells: decayingCells,
    cells,
  };
}

/** Liest signal_stats_results und baut den Kontext, oder null wenn noch keine Zeile existiert. */
export async function buildSignalReviewContext(): Promise<SignalReviewContext | null> {
  const { data } = await supabase.from("signal_stats_results").select("*");
  return aggregateSignalReviewCells((data ?? []) as SignalStatsRow[]);
}
