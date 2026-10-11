"use client";

import { useState } from "react";

// Echter vollstaendiger Seiten-Reload statt nur router.refresh(): holt
// sowohl die serverseitigen Ausgangswerte als auch alle unabhaengigen
// Client-Polls (Lagebild, DashboardPollProvider-Bundle, ...) frisch, die ein
// reines router.refresh() nicht erfassen wuerde.
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
