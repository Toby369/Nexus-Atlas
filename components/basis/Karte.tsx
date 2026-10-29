import type { ReactNode } from "react";
import PanelInfo from "@/components/PanelInfo";

// Die Huelle jeder Kachel: Rahmen, Flaeche, Kopf mit Titel, Info-Ⓘ und
// optionaler Aktion rechts (z.B. Boersen-Auswahl). Vorher 56-mal von Hand
// mit leicht verschiedenen Abstaenden gebaut (docs/research/AUTARK-BAUWEISE-
// FUER-NEXUS_2026-10-29.md, Punkt D). Neue Kacheln nur noch hiermit;
// bestehende beim naechsten Anfassen umstellen.
//
// dicht: kleinere Innenabstaende fuer Kennzahl-Kacheln (size "compact" im
// Register). flaeche "erhoeht" fuer Karten in einer Karte.
export default function Karte({
  titel,
  info,
  aktion,
  dicht = false,
  flaeche = "normal",
  className = "",
  children,
}: {
  titel?: ReactNode;
  info?: { titel: string; text: string };
  aktion?: ReactNode;
  dicht?: boolean;
  flaeche?: "normal" | "erhoeht";
  className?: string;
  children: ReactNode;
}) {
  const kopf = titel || info || aktion;
  return (
    <section
      className={`rounded-karte border border-border ${flaeche === "erhoeht" ? "bg-surface-raised" : "bg-surface"} ${
        dicht ? "p-karte-dicht" : "p-karte"
      } ${className}`}
    >
      {kopf && (
        <div className={`flex items-center justify-between gap-2 flex-wrap ${dicht ? "mb-1" : "mb-4"}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            {titel && <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">{titel}</h2>}
            {info && <PanelInfo title={info.titel} content={info.text} />}
          </div>
          {aktion}
        </div>
      )}
      {children}
    </section>
  );
}
