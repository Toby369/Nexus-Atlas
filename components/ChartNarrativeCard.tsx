"use client";

import { useState } from "react";
import type { ChartNarrativeResult, ChartNarrativeSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Chart-Narrativ-Kachel (Nutzer-Wunsch 06.10.2026): Vorbild war ein von
// Gemini per Screenshot erstellter Bull-/Bear-Szenario-Bericht mit Key
// Levels und Muster-Erkennung -- hier aus denselben algorithmisch (nicht
// vision-basiert) berechneten Strukturdaten wie die Pivot-Konfluenz-/
// Level-Struktur-Kacheln, PLUS (Nutzer-Wunsch: "auch die anderen Daten/
// Signale miteinbeziehen") demselben breiten Signal-Satz wie das
// System-Briefing (lib/chartNarrativeContext.ts). Auf Knopfdruck, kein
// Zeitplan -- gleiches Prinzip wie SystemBriefingCard.tsx.

const INFO_TEXT = [
  "Was das ist: eine KI-Synthese aus den algorithmisch berechneten Chart-Formationen (Dreieck/Flagge/Wimpel/Keil/Doppel-Top-Boden/Kopf-Schulter), den Key Levels und der Level-Struktur (hält/gebrochen je Level) -- abgeglichen mit demselben breiten Signal-Satz wie das System-Briefing (14-Faktoren-Engine, CVD/VWAP/GUSS, Liquidations, Marktkontext, ETF-Flows, Positionierung, News).",
  "Bewusst NICHT vision-basiert: die KI bekommt keinen Chart-Screenshot, sondern bereits aus echten Kerzendaten berechnete Formationen und Levels -- Kursziele in den Szenarien unten sind deshalb IMMER eines der tatsächlichen Key Levels, nie eine frei geschätzte Zahl.",
  "Confluence benennt explizit auch Widersprüche zwischen Chart-Struktur und den übrigen Nexus-Signalen, nicht nur Bestätigungen -- dieselbe Ehrlichkeitspflicht wie beim Kontext-Check im System-Briefing.",
  "Wird NICHT automatisch aktualisiert -- ein neuer Stand entsteht nur per Klick auf \"Neu generieren\". Kein Handelssignal, keine automatisierte Anlageberatung.",
].join("\n\n");

const BIAS_LABEL: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "Bullisch",
  bearish: "Bärisch",
  neutral: "Neutral",
};

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function isValidResult(result: unknown): result is ChartNarrativeResult {
  if (!result || typeof result !== "object") return false;
  const r = result as Partial<ChartNarrativeResult>;
  return (
    typeof r.bias === "string" &&
    typeof r.structureNarrative === "string" &&
    typeof r.confluence === "string" &&
    !!r.bullishScenario &&
    typeof r.bullishScenario.trigger === "string" &&
    !!r.bearishScenario &&
    typeof r.bearishScenario.trigger === "string" &&
    typeof r.invalidation === "string"
  );
}

function ScenarioBlock({
  label,
  scenario,
  tone,
}: {
  label: string;
  scenario: ChartNarrativeResult["bullishScenario"];
  tone: "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-up" : "text-down";
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1">
      <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
      <p className="text-xs text-text-muted leading-relaxed">{scenario.trigger}</p>
      {scenario.target !== null && (
        <p className="text-xs text-text">
          Ziel: <span className="font-semibold">{formatPrice(scenario.target)}</span>
        </p>
      )}
      <p className="text-xs text-text-faint">{scenario.note}</p>
    </div>
  );
}

export default function ChartNarrativeCard({
  initialSnapshot,
}: {
  initialSnapshot: ChartNarrativeSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chart-narrative/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as ChartNarrativeSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const rawResult = snapshot?.status === "ok" ? snapshot.result : null;
  const result = rawResult && isValidResult(rawResult) ? rawResult : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Chart-Narrativ (KI)</p>
          <PanelInfo title="Chart-Narrativ (KI)" content={INFO_TEXT} />
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Generiert…" : "Neu generieren"}
        </button>
      </div>

      {error && <p className="text-xs text-down">{error}</p>}

      {!snapshot && !error && (
        <p className="text-xs text-text-faint">Noch kein Chart-Narrativ generiert.</p>
      )}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && !result && (
        <p className="text-xs text-down">Unerwartetes Antwortformat -- bitte neu generieren.</p>
      )}

      {snapshot && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span
              className={
                result.bias === "bullish"
                  ? "text-up font-semibold"
                  : result.bias === "bearish"
                  ? "text-down font-semibold"
                  : "text-text-muted font-semibold"
              }
            >
              {BIAS_LABEL[result.bias]}
            </span>
            <span className="text-text-faint">· Confidence {result.confidence}/100</span>
            <span className="text-text-faint">·</span>
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
          </div>

          <p className="text-sm text-text leading-relaxed">{result.structureNarrative}</p>

          <div className="pt-2 border-t border-border/60 space-y-1">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Confluence</p>
            <p className="text-sm text-text-muted leading-relaxed">{result.confluence}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start pt-1">
            <ScenarioBlock label="Bullisches Szenario" scenario={result.bullishScenario} tone="up" />
            <ScenarioBlock label="Bärisches Szenario" scenario={result.bearishScenario} tone="down" />
          </div>

          <p className="text-xs text-text-faint pt-1">Ungültig wenn: {result.invalidation}</p>
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Kein Handelssignal, keine automatisierte Anlageberatung.
      </p>
    </div>
  );
}
