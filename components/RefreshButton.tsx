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
      title="Aktualisieren"
      className="h-7 w-7 rounded text-base leading-none text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-50 disabled:cursor-wait"
    >
      <span aria-hidden="true" className={isReloading ? "inline-block animate-spin" : undefined}>
        ↻
      </span>
    </button>
  );
}
