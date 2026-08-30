"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ANCHOR_PARAM,
  formatAnchorBadge,
  formatAnchorInputValue,
  parseAnchorInputValue,
  parseAnchorParam,
} from "@/lib/anchor";

// Event-Driven-Anker (Phase 1 "Anchored Analytics", siehe Feasibility-
// Review vom 29.08.2026) -- ergaenzt die festen Timeframes
// (TimeframeSelector) um einen frei waehlbaren Zeitpunkt, ab dem
// Liquidationen/OI/Preis kumuliert werden. Schreibt wie TimeframeSelector
// direkt in den URL-Query-Param ("anchor") statt in lokalen State -- die
// konsumierenden Panels (LiquidationPanel, LivePricePanel) bekommen den
// aufgeloesten Wert server-seitig ueber app/page.tsx als Prop, exakt
// dasselbe Muster wie bei "tf" (siehe Etappe 1: Einheitliche
// Zeitraum-Architektur).
export default function AnchorPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeAnchor = parseAnchorParam(searchParams.get(ANCHOR_PARAM));
  const [draft, setDraft] = useState(() =>
    activeAnchor ? formatAnchorInputValue(activeAnchor) : ""
  );

  function apply() {
    const parsed = parseAnchorInputValue(draft);
    if (!parsed || parsed.getTime() > Date.now()) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(ANCHOR_PARAM, parsed.toISOString());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function clear() {
    setDraft("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete(ANCHOR_PARAM);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-1.5 text-xs text-text-faint">
        <span className="hidden sm:inline">Anker (UTC)</span>
        <input
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Event-Anker in UTC"
          className="px-2 py-1 text-xs rounded-md border border-border bg-surface-raised text-text"
        />
      </label>
      <button
        type="button"
        onClick={apply}
        disabled={!draft}
        className="px-2.5 py-1 text-xs rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Anker setzen
      </button>
      {activeAnchor && (
        <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border border-accent/30 text-accent">
          {formatAnchorBadge(activeAnchor)}
          <button
            type="button"
            onClick={clear}
            aria-label="Anker zurücksetzen"
            className="text-accent/70 hover:text-accent"
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
