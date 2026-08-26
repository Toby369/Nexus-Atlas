"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "nexus-atlas-install-dismissed";

// PWA-Erweiterung: dezenter "Nexus-Atlas installieren"-Hinweis. Erscheint
// ausschliesslich, wenn der Browser das beforeinstallprompt-Event tatsaechlich
// feuert (primaer Android/Chrome, d.h. Installation ist wirklich verfuegbar)
// -- kein permanenter Banner. Verschwindet nach erfolgreicher Installation
// oder wenn die App bereits im Standalone-Modus laeuft.
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (isStandalone) return;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!deferredPrompt || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent/30 bg-surface-raised px-4 py-2 text-xs text-text-muted shadow-lg">
      <span>Nexus-Atlas installieren</span>
      <button
        type="button"
        onClick={async () => {
          await deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          setDeferredPrompt(null);
        }}
        className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-bg"
      >
        Installieren
      </button>
      <button
        type="button"
        aria-label="Schliessen"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        className="text-text-faint hover:text-text-muted"
      >
        ✕
      </button>
    </div>
  );
}
