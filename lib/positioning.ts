// Positionierung: wie die Konten auf den Perp-Boersen verteilt sind.
// Kontrakte sind immer 50:50 (jeder Long hat einen Short); die Quoten
// zeigen nur, WER auf welcher Seite steht. Sind 65 % der Konten long,
// halten viele kleine Konten Longs gegen wenige grosse Shorts.
//
// - Masse: Anteil Long-Konten (global_long_account_ratio), Mittel ueber
//   alle Boersen mit Daten.
// - Top-Trader: Binance-Top-Trader nach Positionsgroesse
//   (top_trader_long_position_ratio) -- wo das Geld liegt.
// - Abstand: Top-Trader minus Masse (Binance). Normal positiv (Median seit
//   Ende Aug. 2026 ~+9 Pp), weil grosse Konten im Schnitt laenger halten.
//
// Schwellen sind Faustregeln aus der eigenen Historie seit 24.08.2026
// (Masse P95 ~64-68 %, Abstand P5 ~-3 Pp), keine validierten Signale.

import type { PositioningSnapshot } from "@/lib/types";

export const CROWD_HEAVY_LONG = 0.65;
export const CROWD_EXTREME_LONG = 0.7;
export const CROWD_SHORT = 0.5;
// Top-Trader nicht mehr longer als die Masse: ungewoehnlich, die grossen
// Konten stehen dann eher auf der Gegenseite der kleinen.
export const DIVERGENCE_WARN_PP = 0;

export type PositioningTone = "calm" | "watch" | "risk";

export interface PositioningSummary {
  crowdLongPct: number;
  exchangeCount: number;
  topLongPct: number | null;
  divergencePp: number | null;
  label: string;
  tone: PositioningTone;
  hint: string;
}

function ratio(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

export function summarizePositioning(
  snapshots: (PositioningSnapshot | null)[],
  binance: PositioningSnapshot | null,
): PositioningSummary | null {
  const crowd = snapshots.map((s) => ratio(s?.global_long_account_ratio)).filter((v): v is number => v !== null);
  if (crowd.length === 0) return null;
  const crowdLong = crowd.reduce((a, b) => a + b, 0) / crowd.length;

  const top = ratio(binance?.top_trader_long_position_ratio);
  const binanceCrowd = ratio(binance?.global_long_account_ratio);
  const divergencePp = top !== null && binanceCrowd !== null ? (top - binanceCrowd) * 100 : null;
  const proSideAgainst = divergencePp !== null && divergencePp <= DIVERGENCE_WARN_PP;

  let label: string;
  let tone: PositioningTone;
  let hint: string;
  if (crowdLong >= CROWD_EXTREME_LONG) {
    label = "Masse extrem long";
    tone = "risk";
    hint = "Sehr viele kleine Longs: Treibstoff für eine Long-Liquidationskaskade nach unten.";
  } else if (crowdLong >= CROWD_HEAVY_LONG) {
    label = "Masse stark long";
    tone = "watch";
    hint = "Long-lastig. Mit hohem Funding und steigendem OI ohne Preisfortschritt wird es fragil.";
  } else if (crowdLong < CROWD_SHORT) {
    label = "Masse mehrheitlich short";
    tone = "watch";
    hint = "Ungewöhnlich viele Short-Konten: Treibstoff für einen Short-Squeeze nach oben.";
  } else {
    label = "Ausgeglichen";
    tone = "calm";
    hint = "Übliche leichte Long-Mehrheit der Konten.";
  }
  if (proSideAgainst) {
    hint += " Top-Trader sind nicht longer als die Masse: Das grosse Geld steht eher auf der Gegenseite.";
    if (tone === "calm") tone = "watch";
  }

  return {
    crowdLongPct: crowdLong * 100,
    exchangeCount: crowd.length,
    topLongPct: top === null ? null : top * 100,
    divergencePp,
    label,
    tone,
    hint,
  };
}
