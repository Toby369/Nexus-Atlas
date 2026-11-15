"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB, OPEN_TAB_EVENT } from "@/lib/dashboardTabs";
import { logDwell, logUsage } from "@/lib/tileUsage";

// Reiter-Navigation: jeder Reiter zeigt nur die Kacheln EINES Themas.
//
// Beim Oeffnen steht immer der erste Reiter vorne (kein gespeicherter Reiter),
// seit 15.11.2026 "Lage" statt "Trade". Reiter mit `fixed` zeigen ihre Kacheln in fester Reihenfolge
// untereinander, ohne Verschieben/Minimieren (Zonen -> Regelcheck -> Veto).
// Bewusst reiner Client-State statt URL-Query-Param: der sichtbare Reiter
// aendert nichts an den Server-Daten (alle Kacheln sind serverseitig
// gerendert, siehe tiles-Prop).
export default function DashboardTabNav({
  tiles,
  tabHeaders = {},
}: {
  tiles: Record<string, ReactNode>;
  // Optionaler Inhalt ueber den Kacheln eines Reiters (z.B. Zeitraum im Reiter Markt).
  tabHeaders?: Record<string, ReactNode>;
}) {
  const [activeTab, setActiveTab] = useState(DEFAULT_DASHBOARD_TAB);
  const rootRef = useRef<HTMLDivElement>(null);

  // Kopf-Zeile (HeadStatus) springt per Event in einen Reiter.
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!DASHBOARD_TABS.some((tab) => tab.id === id)) return;
      setActiveTab(id);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(OPEN_TAB_EVENT, open);
    return () => window.removeEventListener(OPEN_TAB_EVENT, open);
  }, []);

  // Verweildauer (15.11.2026): sichtbare Zeit des aktiven Reiters, gemeldet
  // beim Wechsel und wenn die Seite in den Hintergrund geht.
  useEffect(() => {
    let startMs: number | null = document.visibilityState === "visible" ? Date.now() : null;
    const flush = () => {
      if (startMs !== null) logDwell(activeTab, (Date.now() - startMs) / 1000);
      startMs = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else startMs = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [activeTab]);

  const activeTabMeta = DASHBOARD_TABS.find((tab) => tab.id === activeTab) ?? DASHBOARD_TABS[0];

  return (
    <div ref={rootRef} className="space-y-3 scroll-mt-2">
      <div role="tablist" aria-label="Dashboard-Bereiche" className="flex gap-1 flex-wrap border-b border-border pb-2">
        {DASHBOARD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              logUsage(`tab:${tab.id}`);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              activeTab === tab.id
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-transparent text-text-faint hover:text-text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabHeaders[activeTabMeta.id]}

      {activeTabMeta.fixed ? (
        <div className="space-y-3">
          {activeTabMeta.tileIds.map((id) => (
            <div key={id}>{tiles[id]}</div>
          ))}
        </div>
      ) : (
        <DashboardLayout tiles={tiles} tileIds={activeTabMeta.tileIds} />
      )}
    </div>
  );
}
