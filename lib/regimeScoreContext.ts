// Datenbeschaffung fuer die Gesamteinschaetzung-Score-Kachel (12.09.2026) --
// reines Lesen, kein Schreiben, keine AI. Ruft research_regime_score_live()
// auf, siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md
// und docs/research/GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md.
//
// WICHTIG -- anders als der Setup-Score (research_confluenceScoreContext.ts)
// ist dies noch KEIN vollstaendig validierter Ebene-1-Score: erst 34 von 52
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
  dxyActive: boolean | null;
  cciActive: boolean | null;
  fragileBullishActive: boolean | null;
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
    dxy_active: boolean | null;
    cci_active: boolean | null;
    fragile_bullish_active: boolean | null;
    probability: number | string;
    tier: RegimeScoreTier;
    data_asof: string;
  }) => ({
    direction: row.out_direction,
    trendKonsens: row.trend_konsens,
    cvdZActive: row.cvd_z_active,
    momentumActive: row.momentum_active,
    bollingerPctbActive: row.bollinger_pctb_active,
    dxyActive: row.dxy_active,
    cciActive: row.cci_active,
    fragileBullishActive: row.fragile_bullish_active,
    probability: Number(row.probability),
    tier: row.tier,
    dataAsof: row.data_asof,
  }));

  return {
    up: rows.find((r) => r.direction === "UP") ?? null,
    down: rows.find((r) => r.direction === "DOWN") ?? null,
  };
}

// Ebene 2 ("Signale im Detail", Nutzer-Wunsch 14.09.2026, analog zur
// gleichnamigen Sektion beim Setup-Score/ConfluenceScoreCard) -- zeigt pro
// Einzelsignal, ob es den vorregistrierten BH-FDR-Test besteht (fliesst in
// den Regime-Score ein -- direkt oder als Teil des Trend-Konsens-
// Konsenszaehlers) oder nicht (sichtbar, aber nicht stimmberechtigt). Ruft
// live dieselbe Funktion auf, die auch die Produktions-WOE-Werte speist
// (research_regime_bh_fdr(0.05), eigener Pool, komplett getrennt von
// research_confluence_bh_fdr) -- keine zweite, unabhaengige Berechnung.
// Anders als research_confluence_bh_fdr liefert diese Funktion ausschliesslich
// Einzelsignal-Zeilen (kein cell_type-Filter noetig).
const REGIME_BH_FDR_ALPHA = 0.05;

export interface RegimeSignalDetail {
  signal: string;
  direction: "UP" | "DOWN";
  nActive: number;
  nInactive: number;
  hitRateActive: number;
  hitRateInactive: number;
  validated: boolean;
}

export async function buildRegimeSignalDetail(): Promise<RegimeSignalDetail[]> {
  const { data, error } = await supabase.rpc("research_regime_bh_fdr", { p_alpha: REGIME_BH_FDR_ALPHA });
  if (error) {
    console.error("regimeScoreContext: Fehler bei research_regime_bh_fdr:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row: {
      signal_a: string;
      direction: "UP" | "DOWN";
      n1: number;
      n2: number;
      hit_rate1_pct: number | string;
      hit_rate2_pct: number | string;
      significant_after_bh: boolean;
    }): RegimeSignalDetail => ({
      signal: row.signal_a,
      direction: row.direction,
      nActive: row.n1,
      nInactive: row.n2,
      hitRateActive: Number(row.hit_rate1_pct),
      hitRateInactive: Number(row.hit_rate2_pct),
      validated: row.significant_after_bh,
    }))
    .sort((a: RegimeSignalDetail, b: RegimeSignalDetail) => {
      if (a.direction !== b.direction) return a.direction === "UP" ? -1 : 1;
      if (a.validated !== b.validated) return a.validated ? -1 : 1;
      return b.hitRateActive - a.hitRateActive;
    });
}
