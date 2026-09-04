import type { MarketState } from "@/lib/types";
import { deriveEntryFilter, type EntryFilterStatus } from "@/lib/entryFilter";
import PanelInfo from "@/components/PanelInfo";

// Backtest-validierter Einstiegsfilter fuer Tobys reales 15m/5m-Setup --
// siehe lib/entryFilter.ts fuer die Herleitung und docs/research/
// TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md fuer die volle Methodik. Ganz
// bewusst eigenstaendig neben der "Gesamteinschaetzung" (MarketStateCard):
// jene beantwortet "wie sieht der Markt gerade aus", dieser Filter
// beantwortet die viel engere, konkret getestete Frage "waere JETZT einer
// der beiden Einstiege aus meinem Backtest erlaubt" -- keine Vermischung
// der beiden Aussagen.

const STYLES: Record<EntryFilterStatus, string> = {
  long_ready: "border-up/40 bg-up/10 text-up",
  short_ready: "border-down/40 bg-down/10 text-down",
  not_aligned: "border-border bg-surface-raised text-text-faint",
  unavailable: "border-border bg-surface-raised text-text-faint",
};

const INFO_TEXT = [
  "Was das ist: Backtest-validierter Einstiegsfilter fuer ein 15m/5m-Setup mit hohem Hebel (getestet mit 20x, TP 30%/SL 10% des Einsatzes).",
  "So liest du das: \"Long-/Short-Setup bestätigt\" heisst, dass 1h-, 4h- und 1d-Struktur aktuell alle in dieselbe Richtung zeigen. In einem 2-Jahres-Backtest hob genau das die Trefferquote von ~25% (Basisrate) auf ~34% (nicht-ueberlappend geprueft, p=0,0002).",
  "Wichtig: kein Handelssignal, keine Erfolgsgarantie -- eine statistisch gestuetzte, aber noch nicht endgueltig bewiesene Beobachtung auf begrenzter Stichprobe. Details in docs/research/TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md.",
].join("\n\n");

export default function EntryFilterBadge({ state }: { state: MarketState | null }) {
  const filter = deriveEntryFilter(state);

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${STYLES[filter.status]}`}
    >
      <span className="flex items-center gap-1.5">
        <span className="uppercase tracking-[0.12em] text-[10px] opacity-70">
          Einstiegsfilter (15m)
        </span>
        <PanelInfo title="Einstiegsfilter (15m)" content={INFO_TEXT} />
      </span>
      <span className="font-semibold">{filter.label}</span>
    </div>
  );
}
