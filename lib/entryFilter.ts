import type { MarketState } from "./types";

// Backtest-validierter Einstiegsfilter fuer Tobys reales 15m/5m-Setup (20x
// Hebel, TP 30%/SL 10% seines Einsatzes -- siehe docs/research/TRIPLE-
// BARRIER-MTF-ALIGNMENT_2026-09-04.md, Abschnitt 5c fuer diese Version.
//
// 2026-09-04, erste Version: 1h+4h+1d-Struktur muessen ALLE uebereinstimmen
// (+11.4pp, n=282/717, p=0.0002). Danach zusaetzlich alle 9 verfuegbaren
// Einzelfaktoren mit derselben nicht-ueberlappenden Methodik durchgetestet
// (BH-FDR ueber 9 Kandidaten): 4 ueberleben (Struktur 4h/1h/15m einzeln,
// sowie die volle 3-Timeframe-Alignment) -- RSI/CVD/Trendstaerke/1h-
// Momentum NICHT. Unter den 4 signifikanten zeigt **4h-Struktur allein**
// den groessten Effekt UND die groesste Stichprobe (+14.8pp, n=543/546,
// p<0.0001, symmetrisch fuer LONG 33.2%/18.2% und SHORT 32.3%/17.7%) --
// staerker als die strengere 3-Timeframe-Regel, die sie mathematisch als
// Teilmenge enthaelt (jede 3-fach-Uebereinstimmung ist auch eine 4h-
// Uebereinstimmung, aber nicht umgekehrt). Auf Toby's Wunsch ("4h-Struktur
// allein umstellen") ist DAS jetzt der produktive Filter, nicht mehr die
// 3-Timeframe-Regel.
//
// Nutzt weiterhin exakt den bereits von compute-market-state berechneten
// mtf_alignment-Wert (mtf_alignment.timeframes["4h"], siehe dortiges
// MTF_WEIGHTS) -- keine neue Berechnung, keine neue Datenquelle.
export type EntryFilterStatus = "long_ready" | "short_ready" | "not_aligned" | "unavailable";

export interface EntryFilterResult {
  status: EntryFilterStatus;
  label: string;
}

const LABELS: Record<EntryFilterStatus, string> = {
  long_ready: "Long-Setup bestätigt",
  short_ready: "Short-Setup bestätigt",
  not_aligned: "4h nicht eindeutig",
  unavailable: "Daten unvollständig",
};

// mtf_alignment.timeframes enthaelt nur FRISCHE Zeitrahmen (siehe
// compute-market-state: mtfEntries wird nur bei isFreshCandle() befuellt) --
// fehlt der Schluessel "4h", ist der Wert schlicht veraltet/nicht
// verfuegbar, nicht "0"/ranging. -1/0/1 = baerisch/range-gebunden/bullisch,
// dieselbe Konvention wie ueberall sonst im Faktoren-System.
export function deriveEntryFilter(state: MarketState | null): EntryFilterResult {
  const direction4h = state?.mtf_alignment?.timeframes?.["4h"];

  if (direction4h === undefined) {
    return { status: "unavailable", label: LABELS.unavailable };
  }
  if (direction4h === 1) {
    return { status: "long_ready", label: LABELS.long_ready };
  }
  if (direction4h === -1) {
    return { status: "short_ready", label: LABELS.short_ready };
  }
  return { status: "not_aligned", label: LABELS.not_aligned };
}
