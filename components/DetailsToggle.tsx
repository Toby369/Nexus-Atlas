"use client";

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "nexus-atlas-details-expanded-v1";

// Ebene 2 der neuen Dashboard-Hierarchie (Nutzer-Feedback vom 31.08.2026):
// alle bisherigen Kacheln bleiben unveraendert, ruecken aber standardmaessig
// hinter diesen Toggle. Gleiches localStorage-Persistenz-Muster wie
// DashboardLayout.tsx (queueMicrotask nach Hydration, damit kein Hydration-
// Mismatch zwischen Server- und erstem Client-Render entsteht).
export default function DetailsToggle({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === "true") setExpanded(true);
      } catch {
        // localStorage kann in privaten Modi/eingeschraenkten Umgebungen
        // fehlschlagen -- Toggle bleibt dann einfach standardmaessig
        // eingeklappt, kein Fehlerzustand fuer den Nutzer.
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(expanded));
    } catch {
      // s.o.
    }
  }, [expanded, hydrated]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
      >
        {expanded ? "Details ausblenden ▴" : "Alle Details anzeigen ▾"}
      </button>
      {expanded && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}
