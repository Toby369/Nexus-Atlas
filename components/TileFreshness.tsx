"use client";

import { describe, evaluateSources, summarizeTile } from "@/lib/dataFreshness";
import { useDataFreshness } from "@/lib/dataFreshnessStore";
import { STATUS_DOT } from "@/components/DataStatusLight";

// "Stand vor X Min" im Kachelkopf (DashboardLayout). Die Quellen kommen aus
// dem Kachel-Register (lib/dashboardTiles.ts, Feld quellen). Leise, solange
// alles aktuell ist; gelb/rot mit dem Namen der Quelle, wenn nicht. Der
// Tooltip nennt jede Quelle einzeln.
export default function TileFreshness({ quellen }: { quellen: string[] }) {
  const { data, nowMs } = useDataFreshness();
  if (!data || quellen.length === 0) return null;

  const items = evaluateSources(quellen, data, nowMs);
  const { status, text } = summarizeTile(items);
  if (!text) return null;

  return (
    <span
      title={items.map(describe).join("\n")}
      className={`flex shrink-0 max-w-[11rem] items-center gap-1 text-[10px] tabular-nums ${
        status === "ausgefallen" ? "text-down" : status === "verspaetet" ? "text-warn" : "text-text-faint"
      }`}
    >
      {status !== "frisch" && (
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}
