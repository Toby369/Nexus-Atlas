import type { ReactNode } from "react";

// Kleine Marke fuer einen Zustand ("ueberhitzt", "ruhig"). Farbe nach
// Bedeutung, ueberall gleich: ruhig grau, beobachten Akzent, Risiko rot,
// gut gruen, Warnung gelb. Ersetzt die eigenen TONE_STYLES-Tabellen der
// Kacheln.
export type PillenTon = "ruhig" | "beobachten" | "risiko" | "gut" | "warnung";

export const PILLEN_TON: Record<PillenTon, string> = {
  ruhig: "border-border text-text-muted",
  beobachten: "border-accent/40 bg-accent/10 text-accent",
  risiko: "border-down/40 bg-down/10 text-down",
  gut: "border-up/40 bg-up/10 text-up",
  warnung: "border-warn/40 bg-warn/10 text-warn",
};

export default function Pille({ ton = "ruhig", title, children }: { ton?: PillenTon; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILLEN_TON[ton]}`}>
      {children}
    </span>
  );
}
