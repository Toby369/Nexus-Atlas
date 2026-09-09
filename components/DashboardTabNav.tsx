"use client";

import { useEffect, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB } from "@/lib/dashboardTabs";

const STORAGE_KEY = "nexus-atlas-dashboard-tab-v1";

// Tab-Navigation (09.09.2026, Nutzer-Feedback "laptop ansicht von nexus zu
// unuebersichtlich" + Referenz-Screenshot eines Trading-Journals mit fester
// Tab-Leiste). Ersetzt den bisherigen "Alle Details anzeigen"-Toggle
// (components/DetailsToggle.tsx, entfernt) -- statt ALLE Kacheln hinter
// einem Klick zu verstecken, zeigt jeder Tab nur die Kacheln EINES Themas.
//
// Bewusst reiner Client-State + localStorage statt URL-Query-Param (anders
// als TimeframeSelector/AnchorPicker): welcher Tab sichtbar ist, aendert
// NICHTS an den zu ladenden Server-Daten (alle Kacheln sind bereits
// server-seitig gerendert, siehe tiles-Prop) -- ein router.replace()-basierter
// Ansatz wuerde hier nur einen unnoetigen Seiten-Roundtrip pro Klick
// bedeuten. Gleiches Persistenz-Muster wie DashboardLayout.tsx (queueMicrotask
// nach Hydration, kein Hydration-Mismatch).
export default function DashboardTabNav({ tiles }: { tiles: Record<string, ReactNode> }) {
  const [activeTab, setActiveTab] = useState(DEFAULT_DASHBOARD_TAB);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && DASHBOARD_TABS.some((tab) => tab.id === stored)) setActiveTab(stored);
      } catch {
        // localStorage kann in privaten Modi/eingeschraenkten Umgebungen
        // fehlschlagen -- Tab bleibt dann einfach beim Default, kein
        // Fehlerzustand fuer den Nutzer.
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, activeTab);
    } catch {
      // s.o.
    }
  }, [activeTab, hydrated]);

  const activeTabMeta = DASHBOARD_TABS.find((tab) => tab.id === activeTab) ?? DASHBOARD_TABS[0];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Dashboard-Bereiche"
        className="flex gap-1 flex-wrap border-b border-border pb-2"
      >
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

      <DashboardLayout tiles={tiles} tileIds={activeTabMeta.tileIds} />
    </div>
  );
}
