import type { ArrowDirection } from "@/lib/heroSummary";

// Ebene-0-Statuszeilen (Nutzer-Feedback vom 31.08.2026, siehe
// lib/heroSummary.ts fuer die 4-Zustands-Pfeil-Logik): eine Zeile je Sparte
// mit ihrem eigenen, bereits vorhandenen Wert -- kein neuer Blend-Score,
// nur die Zusammenstellung. Reine Praesentationskomponente, die fertigen
// Text/Pfeil-Zustand entgegennimmt statt selbst etwas zu berechnen.

export interface StatusLineItem {
  key: string;
  label: string;
  valueText: string;
  arrow: ArrowDirection;
}

const ARROW_GLYPH: Record<ArrowDirection, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
  not_available: "—",
};

const ARROW_COLOR: Record<ArrowDirection, string> = {
  up: "text-up",
  down: "text-down",
  neutral: "text-text-faint",
  not_available: "text-text-faint",
};

export default function StatusLineSummary({ items }: { items: StatusLineItem[] }) {
  return (
    <ul className="pt-2 border-t border-border/60 divide-y divide-border/40">
      {items.map((item) => (
        <li key={item.key} className="flex items-center justify-between gap-3 py-1.5 text-xs">
          <span className="text-text-muted shrink-0">{item.label}</span>
          <span className="flex items-center gap-2 min-w-0 justify-end">
            <span className="text-text-faint truncate">{item.valueText}</span>
            <span
              className={`font-mono w-3 text-center shrink-0 ${ARROW_COLOR[item.arrow]}`}
              aria-hidden="true"
            >
              {ARROW_GLYPH[item.arrow]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
