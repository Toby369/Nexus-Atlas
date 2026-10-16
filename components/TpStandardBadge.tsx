import PanelInfo from "@/components/PanelInfo";
import { tpStandardInfo } from "@/lib/panelInfo";
import { formatTpSuggestion, type TpSuggestion } from "@/lib/tpStandard";

// TP-Standard-Vorschlag im Lagebild (Tobys Regelwerk, 14.10.2026): je
// Richtung der naechste Widerstand bzw. die naechste Unterstuetzung und der
// groesste Standard, dessen TP davor liegt. Logik: lib/tpStandard.ts.
export default function TpStandardBadge({ suggestions }: { suggestions: TpSuggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
      <span className="flex items-center gap-1.5">
        <span className="uppercase tracking-[0.12em] text-[10px] opacity-70 whitespace-nowrap">TP-Standard</span>
        <PanelInfo title="TP-Standard" content={tpStandardInfo} />
      </span>
      <span className="flex flex-col items-end gap-0.5 text-right">
        {suggestions.map((s) => (
          <span key={s.side} className={s.standard ? "text-text" : "text-down"}>
            {formatTpSuggestion(s)}
          </span>
        ))}
      </span>
    </div>
  );
}
