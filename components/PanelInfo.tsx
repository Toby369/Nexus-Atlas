"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Wiederverwendbare Info-Funktion fuer Panel-Header (Vorgabe: kleines Ⓘ,
// standardmaessig geschlossen, oeffnet per Klick/Tap, schliesst durch
// erneuten Klick auf das Icon ODER Klick ausserhalb). Bewusst ohne Backdrop-
// Layer -- ein einzelner document-Listener fuer "Klick ausserhalb" reicht
// und funktioniert identisch auf Touch wie auf Maus, ohne zusaetzliche
// Stacking-/Z-Index-Komplexitaet.
//
// Rendert ueber ein Portal in document.body statt als normales Kind im
// Baum: Panels stecken seit den vergroesserbaren Dashboard-Kacheln
// (DashboardLayout.tsx) in einem overflow-auto-Wrapper (fuer den
// Resize-Ziehgriff) -- ein normal positioniertes Popover wuerde an dessen
// Rand abgeschnitten, sobald es ueber die Kachel hinausragt. Position wird
// deshalb aus der Bounding-Box des Buttons berechnet statt per CSS relativ
// zu einem Elternelement.
//
// Positionierung: auf Mobile ein zentriertes, fixiertes Overlay (damit das
// Popover nie ueber den Bildschirmrand hinausragt, unabhaengig davon, wo im
// Layout das Panel steht); ab dem sm-Breakpoint ein normales, rechtsbuendig
// unter dem Icon verankertes Popover, wie bei einem klassischen Desktop-
// Tooltip/Popover.
const DESKTOP_QUERY = "(min-width: 640px)";
const POPOVER_WIDTH = 288; // sm:w-72
const VIEWPORT_MARGIN = 16;

export default function PanelInfo({
  title,
  content,
  className = "",
}: {
  title: string;
  content: string;
  // Optionaler Zusatz-Abstand fuer Stellen, an denen das Icon direkt hinter
  // Fliesstext/einem anderen Badge sitzt statt in einem eigenen Flex-Header
  // (z.B. je Faktor-/Kennzahl-Zeile in MarketStateCard/RegimeMatrixCard).
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [desktopPosition, setDesktopPosition] = useState<{ top: number; right: number } | null>(
    null
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function computePosition() {
      if (!buttonRef.current || !window.matchMedia(DESKTOP_QUERY).matches) {
        setDesktopPosition(null);
        return;
      }
      const rect = buttonRef.current.getBoundingClientRect();
      const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
      const right = Math.min(Math.max(window.innerWidth - rect.right, VIEWPORT_MARGIN), maxRight);
      setDesktopPosition({ top: rect.bottom + 8, right });
    }

    computePosition();
    window.addEventListener("resize", computePosition);
    return () => window.removeEventListener("resize", computePosition);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleOutside(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
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
    <span className={`relative inline-block leading-none ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Info: ${title}`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] text-text-faint hover:text-text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        ⓘ
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={title}
            style={
              desktopPosition
                ? { top: desktopPosition.top, right: desktopPosition.right }
                : undefined
            }
            className="fixed left-4 right-4 top-1/2 z-50 -translate-y-1/2 rounded-lg border border-accent/25 bg-surface-raised p-4 shadow-lg sm:left-auto sm:w-72 sm:translate-y-0"
          >
            <p className="text-xs font-semibold text-text mb-1.5">{title}</p>
            <div className="space-y-2">
              {content.split("\n\n").map((paragraph, index) => {
                // Erwartetes Format: "Label: Text" (z.B. "So liest du das: ...").
                // Label wird fett hervorgehoben, damit die Struktur (Interpretation
                // vs. Methodik) visuell erkennbar ist, statt in einem Fliesstext zu
                // verschwinden -- ohne dangerouslySetInnerHTML, rein ueber Aufteilen
                // des Plain-Text-Strings.
                const match = paragraph.match(/^([^:\n]{3,40}:)\s*([\s\S]*)$/);
                return (
                  <p key={index} className="text-xs text-text-muted leading-relaxed">
                    {match ? (
                      <>
                        <span className="font-semibold text-text-muted">{match[1]}</span>{" "}
                        {match[2]}
                      </>
                    ) : (
                      paragraph
                    )}
                  </p>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
