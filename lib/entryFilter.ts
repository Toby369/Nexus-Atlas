import type { MarketState } from "./types";

// Backtest-validierter Einstiegsfilter fuer Tobys reales 15m/5m-Setup (20x
// Hebel, TP 30%/SL 10% seines Einsatzes -- siehe docs/research/TRIPLE-
// BARRIER-MTF-ALIGNMENT_2026-09-04.md). Nicht-ueberlappend geprueft ueber
// Train/Validation/Test: wenn 1h-, 4h- UND 1d-Struktur alle mit der
// Trade-Richtung uebereinstimmen, steigt die TP-Trefferquote von ~25%
// (Basisrate bei seinem 3:1-CRV) auf ~34% (p=0.0002, kombiniert LONG+SHORT).
// Ein zusaetzlicher 1h-Momentum-Filter wurde ebenfalls getestet und
// VERWORFEN (Abschnitt 5b desselben Docs, Effekt kehrte sich unter
// nicht-ueberlappender Pruefung um) -- deshalb bewusst NUR die reine
// 3-Timeframe-Alignment hier, kein zusaetzliches Kriterium.
//
// Nutzt exakt den bereits von compute-market-state berechneten
// mtf_alignment-Wert (1h/4h/1d, siehe MTF_WEIGHTS dort) -- keine neue
// Berechnung, keine neue Datenquelle.
export type EntryFilterStatus = "long_ready" | "short_ready" | "not_aligned" | "unavailable";

export interface EntryFilterResult {
  status: EntryFilterStatus;
  label: string;
}

const LABELS: Record<EntryFilterStatus, string> = {
  long_ready: "Long-Setup bestätigt",
  short_ready: "Short-Setup bestätigt",
  not_aligned: "Kein Alignment",
  unavailable: "Daten unvollständig",
};

// mtf_alignment.alignment_pct === 100 heisst nur "alle VERFUEGBAREN
// Zeitrahmen stimmen ueberein" -- bei einem veralteten/fehlenden Zeitrahmen
// koennen das auch nur 1 von 3 oder 2 von 3 sein (siehe compute-market-state:
// mtfEntries enthaelt nur frische Zeitrahmen). Der getestete Filter verlangt
// aber ausdruecklich ALLE DREI (1h+4h+1d) -- deshalb zusaetzlich
// timeframe_count === 3 pruefen, sonst waere z.B. "nur 1h+4h verfuegbar und
// einig" faelschlich als vollstaendiges Alignment ausgewiesen.
export function deriveEntryFilter(state: MarketState | null): EntryFilterResult {
  const mtf = state?.mtf_alignment ?? null;

  if (!mtf || mtf.timeframe_count < 3) {
    return { status: "unavailable", label: LABELS.unavailable };
  }
  if (mtf.alignment_pct !== 100) {
    return { status: "not_aligned", label: LABELS.not_aligned };
  }
  if (mtf.dominant_direction === "bullish") {
    return { status: "long_ready", label: LABELS.long_ready };
  }
  if (mtf.dominant_direction === "bearish") {
    return { status: "short_ready", label: LABELS.short_ready };
  }
  return { status: "not_aligned", label: LABELS.not_aligned };
}
