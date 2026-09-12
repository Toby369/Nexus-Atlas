// Datenbeschaffung fuer die Gesamteinschaetzung-Score-Kachel (12.09.2026) --
// reines Lesen, kein Schreiben, keine AI. Ruft research_regime_score_live()
// auf, siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md
// und docs/research/GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md.
//
// WICHTIG -- anders als der Setup-Score (research_confluenceScoreContext.ts)
// ist dies noch KEIN vollstaendig validierter Ebene-1-Score: erst 20 von 39
// vorregistrierten Kandidatensignalen getestet (siehe NEXUS-STRUKTUR-KONZEPT
// Abschnitt 5). Die Kachel macht das explizit sichtbar, statt einen fertigen
// Eindruck vorzutaeuschen.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";

export type RegimeScoreTier = "Niedrig" | "Mittel" | "Hoch";

export interface RegimeScoreRow {
  direction: "UP" | "DOWN";
  trendKonsens: number;
  cvdZActive: boolean;
  momentumActive: boolean | null;
  bollingerPctbActive: boolean | null;
  probability: number;
  tier: RegimeScoreTier;
  dataAsof: string;
}

export interface RegimeScoreResult {
  up: RegimeScoreRow | null;
  down: RegimeScoreRow | null;
}

export async function buildRegimeScore(): Promise<RegimeScoreResult> {
  const { data, error } = await supabase.rpc("research_regime_score_live");
  if (error) {
    console.error("regimeScoreContext: Fehler bei research_regime_score_live:", error.message);
    return { up: null, down: null };
  }

  const rows: RegimeScoreRow[] = (data ?? []).map((row: {
    out_direction: "UP" | "DOWN";
    trend_konsens: number;
    cvd_z_active: boolean;
    momentum_active: boolean | null;
    bollinger_pctb_active: boolean | null;
    probability: number | string;
    tier: RegimeScoreTier;
    data_asof: string;
  }) => ({
    direction: row.out_direction,
    trendKonsens: row.trend_konsens,
    cvdZActive: row.cvd_z_active,
    momentumActive: row.momentum_active,
    bollingerPctbActive: row.bollinger_pctb_active,
    probability: Number(row.probability),
    tier: row.tier,
    dataAsof: row.data_asof,
  }));

  return {
    up: rows.find((r) => r.direction === "UP") ?? null,
    down: rows.find((r) => r.direction === "DOWN") ?? null,
  };
}
