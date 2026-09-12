// Datenbeschaffung fuer die Confluence-Score-Kachel (12.09.2026) -- reines
// Lesen, kein Schreiben, keine AI. Ruft die live-Variante des in
// docs/research/CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md dokumentierten,
// vierfach out-of-sample validierten Weight-of-Evidence-Scores auf
// (research_confluence_score_live() -- SQL-seitig, siehe Migration
// create_confluence_score_live_v2).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";

export type ConfluenceScoreTier = "Niedrig" | "Mittel" | "Hoch";

export interface ConfluenceScoreRow {
  direction: "LONG" | "SHORT";
  trendCount: number;
  fearGreedActive: boolean;
  fearGreedClassification: string | null;
  makroActive: boolean;
  makroRegime: string | null;
  orderbuchActive: boolean;
  orderbuchImbalance: number | null;
  probability: number;
  tier: ConfluenceScoreTier;
  dataAsof: string;
}

export interface ConfluenceScoreResult {
  long: ConfluenceScoreRow | null;
  short: ConfluenceScoreRow | null;
}

export async function buildConfluenceScore(): Promise<ConfluenceScoreResult> {
  const { data, error } = await supabase.rpc("research_confluence_score_live");
  if (error) {
    console.error("confluenceScoreContext: Fehler bei research_confluence_score_live:", error.message);
    return { long: null, short: null };
  }

  const rows: ConfluenceScoreRow[] = (data ?? []).map((row: {
    direction: "LONG" | "SHORT";
    trend_count: number;
    fear_greed_active: boolean;
    fear_greed_classification: string | null;
    makro_active: boolean;
    makro_regime: string | null;
    orderbuch_active: boolean;
    orderbuch_imbalance: number | string | null;
    probability: number | string;
    tier: ConfluenceScoreTier;
    data_asof: string;
  }) => ({
    direction: row.direction,
    trendCount: row.trend_count,
    fearGreedActive: row.fear_greed_active,
    fearGreedClassification: row.fear_greed_classification,
    makroActive: row.makro_active,
    makroRegime: row.makro_regime,
    orderbuchActive: row.orderbuch_active,
    orderbuchImbalance: row.orderbuch_imbalance !== null ? Number(row.orderbuch_imbalance) : null,
    probability: Number(row.probability),
    tier: row.tier,
    dataAsof: row.data_asof,
  }));

  return {
    long: rows.find((r) => r.direction === "LONG") ?? null,
    short: rows.find((r) => r.direction === "SHORT") ?? null,
  };
}

// Ebene-2-Datenbasis ("Signale im Detail", Struktur-Konzept 12.09.2026,
// docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md Abschnitt 1+2): zeigt
// pro Einzelsignal, ob es den vorregistrierten BH-FDR-Test besteht (fliesst
// in den Setup-Score ein -- direkt oder als Teil des Trend-Konfirmation-
// Konsenszaehlers) oder nicht (sichtbar, aber nicht stimmberechtigt). Ruft
// live dieselbe Funktion auf, die auch die Produktions-WOE-Werte speist
// (research_confluence_bh_fdr('main')) -- keine zweite, unabhaengige
// Berechnung, keine neue Tabelle.
export interface ConfluenceSignalDetail {
  signal: string;
  direction: "LONG" | "SHORT";
  nActive: number;
  nInactive: number;
  hitRateActive: number;
  hitRateInactive: number;
  validated: boolean;
}

export async function buildConfluenceSignalDetail(): Promise<ConfluenceSignalDetail[]> {
  const { data, error } = await supabase.rpc("research_confluence_bh_fdr", { p_pool: "main" });
  if (error) {
    console.error("confluenceScoreContext: Fehler bei research_confluence_bh_fdr:", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row: { cell_type: string }) => row.cell_type === "signal")
    .map((row: {
      signal_a: string;
      direction: "LONG" | "SHORT";
      n1: number;
      n2: number;
      hit_rate1_pct: number | string;
      hit_rate2_pct: number | string;
      significant_after_bh: boolean;
    }): ConfluenceSignalDetail => ({
      signal: row.signal_a,
      direction: row.direction,
      nActive: row.n1,
      nInactive: row.n2,
      hitRateActive: Number(row.hit_rate1_pct),
      hitRateInactive: Number(row.hit_rate2_pct),
      validated: row.significant_after_bh,
    }))
    .sort((a: ConfluenceSignalDetail, b: ConfluenceSignalDetail) => {
      if (a.direction !== b.direction) return a.direction === "LONG" ? -1 : 1;
      if (a.validated !== b.validated) return a.validated ? -1 : 1;
      return b.hitRateActive - a.hitRateActive;
    });
}
