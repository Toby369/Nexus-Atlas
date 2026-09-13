"use client";

import { useEffect, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB } from "@/lib/dashboardTabs";

const STORAGE_KEY = "nexus-atlas-dashboard-tab-v1";
const FOCUS_STORAGE_KEY = "nexus-atlas-focus-mode-v1";

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
  // Fokus-Modus (12.09.2026, Nutzer-Wunsch "moeglichst breit sammeln, aber
  // kein Overload" -> Dashboard-Brainstorming Punkt 5): blendet NUR diesen
  // Tab-Bereich aus (27 Kacheln ueber 3 Themen), nicht die davor fest
  // platzierten Ebene-1-Karten (Gesamteinschaetzung/Setup-Score/Regime-Score
  // in app/page.tsx) oder HeroHeader/TradingHoursBadge -- die bleiben so
  // oder so immer sichtbar und decken bereits die dringlichen Faelle ab
  // (aktive Risiko-Faktoren/Warn-Muster stehen in MarketStateCard, aktive
  // News-/Handelszeit-Fenster in TradingHoursBadge). Eine zusaetzliche,
  // eigene "Warnungen-Leiste" wuerde das nur duplizieren -- deshalb bewusst
  // NICHT gebaut, siehe Chat-Verlauf. Der Toggle loest ausschliesslich das
  // Overload-Problem (zu viele Kacheln gleichzeitig sichtbar), nicht die
  // Warnungs-Sichtbarkeit (die schon gegeben ist).
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
