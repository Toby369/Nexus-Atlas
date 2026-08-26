"use client";

import { useEffect, useRef, useState } from "react";

// Wiederverwendbare Info-Funktion fuer Panel-Header (Vorgabe: kleines Ⓘ,
// standardmaessig geschlossen, oeffnet per Klick/Tap, schliesst durch
// erneuten Klick auf das Icon ODER Klick ausserhalb). Bewusst ohne Backdrop-
// Layer -- ein einzelner document-Listener fuer "Klick ausserhalb" reicht
// und funktioniert identisch auf Touch wie auf Maus, ohne zusaetzliche
// Stacking-/Z-Index-Komplexitaet.
//
// Positionierung: auf Mobile ein zentriertes, fixiertes Overlay (damit das
// Popover nie ueber den Bildschirmrand hinausragt, unabhaengig davon, wo im
// Layout das Panel steht); ab dem sm-Breakpoint ein normales, rechtsbuendig
// unter dem Icon verankertes Popover, wie bei einem klassischen Desktop-
// Tooltip/Popover.
export default function PanelInfo({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block leading-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Info: ${title}`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] text-text-faint hover:text-text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        ⓘ
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          className="fixed left-4 right-4 top-1/2 z-50 -translate-y-1/2 rounded-lg border border-accent/25 bg-surface-raised p-4 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-72 sm:translate-y-0"
        >
          <p className="text-xs font-semibold text-text mb-1.5">{title}</p>
          <p className="text-xs text-text-muted leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  );
}
