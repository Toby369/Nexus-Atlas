"use client";

import { useState } from "react";
import PanelInfo from "@/components/PanelInfo";
import { institutionalPlaybookInfo } from "@/lib/panelInfo";

// Reines UI-/Wissens-Panel: statischer Leitfaden-Text, keine API-Aufrufe,
// keine Aenderung an bestehenden Engines. Die drei Tabs bauen bewusst auf
// bereits im Dashboard vorhandenen, regelbasiert berechneten Konzepten auf
// (Spot Pressure aus lib/spotPressure.ts, OI-Preis-Quadrant aus der
// Regime-Matrix-Engine, Marktphasen aus lib/marketStateSummary.ts) statt
// eine parallele, eigene Taxonomie zu erfinden -- Ziel ist ein Leitfaden,
// WIE die bestehenden Kacheln zusammen gelesen werden, keine neue
// Datenquelle oder ein neues Signal.

type TabId = "routine" | "matrix" | "patterns";

const TABS: { id: TabId; label: string }[] = [
  { id: "routine", label: "Tages-Routine" },
  { id: "matrix", label: "Signal-Matrix" },
  { id: "patterns", label: "Markt-Muster" },
];

type BadgeVariant = "up" | "down" | "watch" | "neutral";

function StatusBadge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  const styles: Record<BadgeVariant, string> = {
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

function RoutineTab() {
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
      title: "3. Liquidationen & Event-Anker prüfen",
      body: "Deutet die Liquidationen-Kachel auf eine Cascade hin (≥3 Events in 2 Min)? Ist ein Event-Anker gesetzt, zeigt „Seit Anker“ zusätzlich, was sich seit einem frei wählbaren Zeitpunkt kumuliert verändert hat.",
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

interface MatrixCell {
  spotPressure: string;
  oiChange: string;
  variant: BadgeVariant;
  label: string;
  body: string;
}

const MATRIX_CELLS: MatrixCell[] = [
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

function MatrixTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-faint">
        Die vier Grundkombinationen aus Spot Pressure (Netto-Taker-Flow) und OI Change. Liquidationen wirken als
        Bestätigung: eine Cascade in dieselbe Richtung macht eine Zeile wahrscheinlicher, ersetzt sie aber nicht.
      </p>
      {MATRIX_CELLS.map((cell) => (
        <div key={`${cell.spotPressure}-${cell.oiChange}`} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <span className="text-xs text-text-muted">
              {cell.spotPressure} · {cell.oiChange}
            </span>
            <StatusBadge variant={cell.variant}>{cell.label}</StatusBadge>
          </div>
          <p className="text-xs text-text-faint">{cell.body}</p>
        </div>
      ))}
    </div>
  );
}

interface PatternEntry {
  name: string;
  variant: BadgeVariant;
  body: string;
}

const PATTERNS: PatternEntry[] = [
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

function PatternsTab() {
  return (
    <div className="space-y-4">
      {PATTERNS.map((pattern) => (
        <div key={pattern.name}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text font-medium">{pattern.name}</span>
            <StatusBadge variant={pattern.variant}>
              {pattern.variant === "up" ? "Bullisch" : pattern.variant === "down" ? "Bärisch" : pattern.variant === "watch" ? "Warnsignal" : "Neutral"}
            </StatusBadge>
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

export default function InstitutionalPlaybookCard() {
  const [tab, setTab] = useState<TabId>("routine");

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">Institutional Playbook</h2>
        <PanelInfo title="Institutional Playbook" content={institutionalPlaybookInfo} />
      </div>

      <div className="flex gap-1 flex-wrap mb-4">
        {TABS.map((t) => (
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

      {tab === "routine" && <RoutineTab />}
      {tab === "matrix" && <MatrixTab />}
      {tab === "patterns" && <PatternsTab />}
    </section>
  );
}
