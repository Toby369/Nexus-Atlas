"use client";

import { useEffect, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB } from "@/lib/dashboardTabs";

const STORAGE_KEY = "nexus-atlas-dashboard-tab-v1";
const FOCUS_STORAGE_KEY = "nexus-atlas-focus-mode-v1";

// Reiter-Navigation: jeder Reiter zeigt nur die Kacheln EINES Themas.
//
// Bewusst reiner Client-State + localStorage statt URL-Query-Param (anders
// als TimeframeSelector): der sichtbare Reiter aendert NICHTS an den Server-
// Daten (alle Kacheln sind bereits serverseitig gerendert, siehe tiles-Prop)
// -- ein router.replace() waere nur ein unnoetiger Roundtrip pro Klick.
// Persistenz wie DashboardLayout.tsx (queueMicrotask nach Hydration).
export default function DashboardTabNav({ tiles }: { tiles: Record<string, ReactNode> }) {
  const [activeTab, setActiveTab] = useState(DEFAULT_DASHBOARD_TAB);
  // Fokus-Modus: blendet NUR den Reiter-Bereich aus, nicht das fest
  // platzierte Lagebild -- das zeigt aktive Risiko-Faktoren, Warn-Muster und
  // Handelszeit-Fenster ohnehin. Eine eigene "Warnungen-Leiste" wuerde das
  // nur duplizieren; der Toggle loest nur das Overload-Problem.
  const [focusMode, setFocusMode] = useState(false);
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
      try {
        setFocusMode(window.localStorage.getItem(FOCUS_STORAGE_KEY) === "1");
      } catch {
        // s.o.
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

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(FOCUS_STORAGE_KEY, focusMode ? "1" : "0");
    } catch {
      // s.o.
    }
  }, [focusMode, hydrated]);

  const activeTabMeta = DASHBOARD_TABS.find((tab) => tab.id === activeTab) ?? DASHBOARD_TABS[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border pb-2">
        {!focusMode && (
          <div role="tablist" aria-label="Dashboard-Bereiche" className="flex gap-1 flex-wrap">
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
        )}
        <button
          type="button"
          onClick={() => setFocusMode((f) => !f)}
          aria-pressed={focusMode}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ml-auto ${
            focusMode
              ? "border-accent/40 bg-accent/15 text-accent"
              : "border-border text-text-faint hover:text-text-muted"
          }`}
        >
          {focusMode ? "Fokus-Modus verlassen" : "🔍 Fokus-Modus"}
        </button>
      </div>

      {focusMode ? (
        <p className="text-xs text-text-faint italic">
          Fokus-Modus aktiv — Detail-Kacheln ausgeblendet. Gesamteinschätzung, Setup-Score,
          Regime-Score und aktive Warnungen (oben) bleiben unverändert sichtbar.
        </p>
      ) : (
        <DashboardLayout tiles={tiles} tileIds={activeTabMeta.tileIds} />
      )}
    </div>
  );
}
