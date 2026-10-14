"use client";

import { useEffect, useState } from "react";
import { fetchOscillatorDivergences, formatDivergence, type OscillatorDivergence } from "@/lib/oscillatorDivergence";
import { oscillatorDivergenceInfo } from "@/lib/panelInfo";
import PanelInfo from "@/components/PanelInfo";
import { setVisibleInterval } from "@/lib/visibleInterval";

// RSI-/MACD-Divergenz auf 1H/4H/1D im Lagebild -- nur Hinweis, nie Sperre
// (Tobys Regelwerk, 14.10.2026; Logik in lib/oscillatorDivergence.ts).
// Ausgeblendet, solange keine aktuelle Divergenz vorliegt.
const POLL_MS = 5 * 60_000;

export default function DivergenceHeroBadge() {
  const [divergences, setDivergences] = useState<OscillatorDivergence[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await fetchOscillatorDivergences();
      if (!cancelled) setDivergences(result);
    };
    load();
    const stopPolling = setVisibleInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  if (divergences.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
      <span className="flex items-center gap-1.5">
        <span className="uppercase tracking-[0.12em] text-[10px] opacity-70 whitespace-nowrap">Divergenz</span>
        <PanelInfo title="Divergenz (Hinweis)" content={oscillatorDivergenceInfo} />
      </span>
      <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 font-semibold">
        {divergences.map((d) => (
          <span key={`${d.interval}-${d.oscillator}`} className={d.direction === "bullish" ? "text-up" : "text-down"}>
            {d.direction === "bullish" ? "▲" : "▼"} {formatDivergence(d)}
          </span>
        ))}
      </span>
    </div>
  );
}
