"use client";

import { useState } from "react";
import PanelInfo from "@/components/PanelInfo";
import { institutionalPlaybookInfo } from "@/lib/panelInfo";

// --- Institutional Playbook ------------------------------------------------
// Reines Nachschlagewerk ohne Live-Daten, daher hier statt bei den
// KI-Einschaetzungen.

type PlaybookTabId = "routine" | "matrix" | "patterns";

const PLAYBOOK_TABS: { id: PlaybookTabId; label: string }[] = [
  { id: "routine", label: "Tages-Routine" },
  { id: "matrix", label: "Signal-Matrix" },
  { id: "patterns", label: "Markt-Muster" },
];

type PlaybookBadgeVariant = "up" | "down" | "watch" | "neutral";

function PlaybookStatusBadge({ variant, children }: { variant: PlaybookBadgeVariant; children: React.ReactNode }) {
  const styles: Record<PlaybookBadgeVariant, string> = {
    up: "border-up/40 bg-up/15 text-up",
    down: "border-down/40 bg-down/15 text-down",
    watch: "border-accent/40 bg-accent/15 text-accent",
    neutral: "border-border text-text-faint",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

function PlaybookRoutineTab() {
  const steps = [
    {
      title: "1. Gesamteinschätzung & Marktphase",
      body: "Verlässlichkeit und Risk oben prüfen, bevor irgendeine Unter-Kachel einzeln betrachtet wird. Unter 35/100 Verlässlichkeit zeigt die App bewusst „Unklar / kein Zustand“ statt eines erfundenen Bias — das ist dann auch die Grenze für jede weitere Interpretation unten.",
    },
    {
      title: "2. Spot Pressure gegen OI Change lesen",
      body: "Bestätigt der Netto-Taker-Flow (Spot Pressure) die Richtung, in die sich Open Interest bewegt, oder widerspricht er ihr? Siehe Signal-Matrix-Tab für die vier Grundkombinationen.",
    },
    {
      title: "3. Liquidationen prüfen",
      body: "Deutet die Liquidationen-Kachel auf eine Cascade hin (≥3 Events in 2 Min)?",
    },
  ];

  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <div key={step.title}>
          <p className="text-sm text-text font-medium">{step.title}</p>
          <p className="text-xs text-text-faint mt-1">{step.body}</p>
        </div>
      ))}
    </div>
  );
}

interface PlaybookMatrixCell {
  spotPressure: string;
  oiChange: string;
  variant: PlaybookBadgeVariant;
  label: string;
  body: string;
}

const PLAYBOOK_MATRIX_CELLS: PlaybookMatrixCell[] = [
  {
    spotPressure: "Buying Pressure",
    oiChange: "OI steigend",
    variant: "up",
    label: "Neue Käufer bauen Positionen auf",
    body: "Entspricht dem „Long-Aufbau“-Quadranten in der Marktphasen-Kachel — Kaufdruck UND neue Positionen gleichzeitig.",
  },
  {
    spotPressure: "Buying Pressure",
    oiChange: "OI fallend",
    variant: "watch",
    label: "Rally ohne neue Positionen",
    body: "Entspricht „Short-Covering“ — bestehende Shorts schliessen sich, es kommt aber kaum frisches Kapital hinzu. Oft weniger nachhaltig als Long-Aufbau.",
  },
  {
    spotPressure: "Selling Pressure",
    oiChange: "OI steigend",
    variant: "down",
    label: "Neue Verkäufer bauen Positionen auf",
    body: "Entspricht „Short-Aufbau“ — aktiver Verkaufsdruck mit neuen Positionen, nicht nur Gewinnmitnahme.",
  },
  {
    spotPressure: "Selling Pressure",
    oiChange: "OI fallend",
    variant: "watch",
    label: "Bestehende Longs werden abgebaut",
    body: "Entspricht „Long-Abbau“ — kann Gewinnmitnahme oder beginnende Kapitulation sein. Eine gleichzeitige Liquidations-Cascade spricht eher für Kapitulation (siehe „Flush & Bottom“ im Muster-Tab).",
  },
];

function PlaybookMatrixTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-faint">
        Die vier Grundkombinationen aus Spot Pressure (Netto-Taker-Flow) und OI Change. Liquidationen wirken als
        Bestätigung: eine Cascade in dieselbe Richtung macht eine Zeile wahrscheinlicher, ersetzt sie aber nicht.
      </p>
      {PLAYBOOK_MATRIX_CELLS.map((cell) => (
        <div key={`${cell.spotPressure}-${cell.oiChange}`} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <span className="text-xs text-text-muted">
              {cell.spotPressure} · {cell.oiChange}
            </span>
            <PlaybookStatusBadge variant={cell.variant}>{cell.label}</PlaybookStatusBadge>
          </div>
          <p className="text-xs text-text-faint">{cell.body}</p>
        </div>
      ))}
    </div>
  );
}

interface PlaybookPatternEntry {
  name: string;
  variant: PlaybookBadgeVariant;
  body: string;
}

const PLAYBOOK_PATTERNS: PlaybookPatternEntry[] = [
  {
    name: "Institutional Inflow",
    variant: "up",
    body: "Buying Pressure UND steigendes OI treffen auf hohe Verlässlichkeit ohne Liquidations-Cascade — Kaufkraft und neue Positionen fliessen gleichzeitig, statt nur bestehende Shorts zu schliessen.",
  },
  {
    name: "Overleveraged Top",
    variant: "watch",
    body: "Anhaltende Trendausweitung (Marktphase) bei gleichzeitig stark positivem Funding und hohem OI — der Markt ist tendenziell einseitig long positioniert, was ihn anfälliger für eine plötzliche Gegenbewegung macht.",
  },
  {
    name: "Flush & Bottom",
    variant: "down",
    body: "Liquidations-Cascade (überwiegend Long-Liquidationen) trifft auf fallendes OI, während Spot Pressure von Selling in Richtung Neutral/Buying dreht — klassisches Kapitulationsmuster, kein garantierter Boden.",
  },
  {
    name: "Range Breakout",
    variant: "neutral",
    body: "Auf eine Phase „Volatilitäts-Squeeze“ (niedriger ADX, komprimierte Bollinger-Bänder) folgt eine Trendausweitung mit steigendem OI in dieselbe Richtung — die vorherige Kompression löst sich richtungsbestätigt auf.",
  },
];

function PlaybookPatternsTab() {
  return (
    <div className="space-y-4">
      {PLAYBOOK_PATTERNS.map((pattern) => (
        <div key={pattern.name}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text font-medium">{pattern.name}</span>
            <PlaybookStatusBadge variant={pattern.variant}>
              {pattern.variant === "up" ? "Bullisch" : pattern.variant === "down" ? "Bärisch" : pattern.variant === "watch" ? "Warnsignal" : "Neutral"}
            </PlaybookStatusBadge>
          </div>
          <p className="text-xs text-text-faint mt-1">{pattern.body}</p>
        </div>
      ))}
      <p className="text-xs text-text-faint border-t border-border/60 pt-3">
        Mustererkennung zur Orientierung anhand bereits vorhandener Kacheln — keine Kauf-/Verkaufsempfehlung und kein
        eigenständiges Handelssignal.
      </p>
    </div>
  );
}

export default function PlaybookPanel() {
  const [tab, setTab] = useState<PlaybookTabId>("routine");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {PLAYBOOK_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                tab === t.id
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-transparent text-text-faint hover:text-text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <PanelInfo title="Institutional Playbook" content={institutionalPlaybookInfo} />
      </div>

      {tab === "routine" && <PlaybookRoutineTab />}
      {tab === "matrix" && <PlaybookMatrixTab />}
      {tab === "patterns" && <PlaybookPatternsTab />}
    </div>
  );
}
