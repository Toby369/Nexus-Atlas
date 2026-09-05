// Reine Konsens-Logik fuer die Eskalations-Kachel (Thema KI, "gezielte
// Eskalation", 05.09.2026) -- kein Netzwerk-/DB-Zugriff hier (siehe
// lib/escalationContext.ts fuer die Datenbeschaffung/Trigger-Erkennung und
// app/api/escalation/generate/route.ts fuer die tatsaechlichen AI-Aufrufe).
//
// Bewusst simpel gehalten: Konsens heisst hier ausschliesslich "alle
// befragten Provider haben denselben bias" -- unterschiedliche confidence-
// Werte bei gleichem bias zaehlen NICHT als Divergenz (ein Modell, das sich
// bei derselben Richtung nur weniger sicher ist, widerspricht nicht).

import type { EscalationRead } from "./types";

export type { EscalationRead } from "./types";
export type EscalationConsensusVerdict = "AGREEMENT" | "DIVERGENCE" | "INCONCLUSIVE";

/**
 * INCONCLUSIVE bei weniger als 2 erfolgreichen Reads -- ein einzelner Read
 * ist kein Konsens und keine Divergenz, sondern schlicht keine Auswertung
 * moeglich (z.B. wenn 2 von 3 Providern fehlgeschlagen sind).
 */
export function computeEscalationConsensus(reads: EscalationRead[]): EscalationConsensusVerdict {
  if (reads.length < 2) return "INCONCLUSIVE";
  const distinctBiases = new Set(reads.map((r) => r.bias));
  return distinctBiases.size === 1 ? "AGREEMENT" : "DIVERGENCE";
}
