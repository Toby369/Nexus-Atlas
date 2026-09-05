"use client";

import { useState } from "react";

// Manueller Aktualisierungs-Button (Nutzer-Wunsch, 05.09.2026): echter
// vollstaendiger Seiten-Reload statt nur router.refresh(). Deckt damit
// beides zugleich ab -- "sofort neu laden" UND "ganze Seite neu laden" --
// weil ein Reload zwangslaeufig alle Daten frisch holt: sowohl die
// serverseitigen Ausgangswerte (MarketStateCard, LivePricePanel, ...) als
// auch die unabhaengigen Client-Polls (HeroHeader-eigener Market-State-
// Poll, DashboardPollProvider-Bundle, ...), die ein reines router.refresh()
// nicht mit erfasst haette.
export default function RefreshButton() {
  const [isReloading, setIsReloading] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setIsReloading(true);
        window.location.reload();
      }}
      disabled={isReloading}
      aria-label="Dashboard jetzt aktualisieren"
      className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted disabled:opacity-50 disabled:cursor-wait"
    >
      {isReloading ? "Aktualisiere…" : "Aktualisieren"}
    </button>
  );
}
