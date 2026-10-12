"use client";

import type { ReactNode } from "react";

// Kleine gemeinsame Bausteine der Grundlagen-Werkzeuge, im Stil der
// uebrigen Lernen-Kacheln.

export type Tone = "bullish" | "bearish" | "watch" | "neutral";

export const TONE_TEXT: Record<Tone, string> = {
  bullish: "text-up",
  bearish: "text-down",
  watch: "text-accent",
  neutral: "text-text-muted",
};

const TONE_PILL: Record<Tone, string> = {
  bullish: "border-up/40 bg-up/10 text-up",
  bearish: "border-down/40 bg-down/10 text-down",
  watch: "border-accent/40 bg-accent/10 text-accent",
  neutral: "border-border text-text-muted",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[tone]}`}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-text-faint">{label}</p>
      <div className="inline-flex flex-wrap rounded-md border border-border overflow-hidden" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 text-xs border-r border-border last:border-r-0 ${
              value === o.value ? "bg-accent/15 text-accent" : "text-text-faint hover:text-text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-md bg-surface px-2.5 py-1.5">
      <p className="text-[11px] text-text-faint">{label}</p>
      <p className={`tabular font-mono text-sm font-medium ${tone ? TONE_TEXT[tone] : "text-text"}`}>{value}</p>
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  step,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label htmlFor={id} className="space-y-1 block min-w-0">
      <span className="text-[11px] text-text-faint">{label}</span>
      <input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full bg-surface border border-border rounded-md px-2 py-1 text-sm font-mono text-text"
      />
    </label>
  );
}

export function ToolBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{title}</p>
      {children}
    </div>
  );
}

export function LiveHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-text-faint">
      <span className="font-medium text-text-muted">Live in Nexus:</span> {children}
    </p>
  );
}

export function formatNum(value: number, digits = 0): string {
  return value.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSignedPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${formatNum(value, digits)} %`;
}
