"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB, OPEN_TAB_EVENT } from "@/lib/dashboardTabs";

// Reiter-Navigation: jeder Reiter zeigt nur die Kacheln EINES Themas.
//
// 25.10.2026 (Toby): Beim Oeffnen steht immer der Reiter "Trade" vorne (kein
// gespeicherter Reiter mehr), der Fokus-Modus entfaellt -- "Trade" ist der
// Fokus. Reiter mit `fixed` zeigen ihre Kacheln in fester Reihenfolge
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
            onClick={() => setActiveTab(tab.id)}
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
