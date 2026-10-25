import type { ReactNode } from "react";
import PanelInfo from "@/components/PanelInfo";

// Kachel im Reiter "Trade" (Toby 25.10.2026, "kein Overinfo"): eingeklappt
// nur Schritt, Titel und eine Zeile Ergebnis; Details per Antippen.

export const STEP_TONE = {
  ok: "text-up",
  warn: "text-warn",
  stop: "text-down",
  neutral: "text-text",
} as const;

export default function StepCard({
  step,
  title,
  line,
  tone,
  info,
  children,
}: {
  step: number;
  title: string;
  line: ReactNode;
  tone: keyof typeof STEP_TONE;
  info: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border bg-surface p-4">
      <summary className="flex cursor-pointer select-none list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 space-y-1">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-text-faint">
            <span className="font-mono text-accent">{step}</span> · {title}
          </span>
          <span className={`block text-sm font-medium ${STEP_TONE[tone]}`}>{line}</span>
        </span>
        <span aria-hidden className="pt-1 text-xs text-text-faint transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
        <div className="flex justify-end">
          <span className="flex items-center gap-1 text-[11px] text-text-faint">
            So liest du das <PanelInfo title={title} content={info} />
          </span>
        </div>
        {children}
      </div>
    </details>
  );
}
