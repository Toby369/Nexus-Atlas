"use client";

import { useState } from "react";
import type { EscalationSnapshot, EscalationTriggerRecord } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Eskalations-Kachel ("gezielte Eskalation" statt Dauerbetrieb mehrerer KIs,
// 05.09.2026) -- holt mehrere unabhaengige AI-Meinungen (siehe
// lib/ai/tileConfig.ts ESCALATION_PROVIDER_ENSEMBLE: Anthropic, Google,
// Mistral) NUR ein, wenn Nexus intern bereits eine Divergenz/einen
// Widerspruch erkannt hat. initialTriggers kommt aus einer kostenlosen
// DB-Pruefung (lib/escalationContext.ts::detectEscalationTriggers, reine
// Reads, kein AI-Aufruf) -- der Button ist nur aktiv, wenn mindestens ein
// Trigger aktiv ist.

const INFO_TEXT = [
  "Was das ist: statt einer dauerhaften Kachel mit 2-4 parallelen KI-Meinungen (verworfen -- Modell-Uneinigkeit auf denselben Rohdaten spiegelt meist Modellrauschen statt echter Markt-Ambiguitaet) holt Nexus mehrere unabhaengige Meinungen NUR ein, wenn eines der bestehenden Pruefmechanismen bereits eine Divergenz/einen Widerspruch meldet: Signal-Engine (Konsistenz der Gesamteinschaetzung), Divergenz-Radar (unabhaengige Datenquellen) oder Report-Master (widerspruechliche Einzelreports).",
  "Die drei Provider (Anthropic, Google, Mistral) bekommen dieselbe rohe Gesamteinschaetzung und bilden unabhaengig voneinander bias/confidence/summary -- keine Web-Suche (bewusst ohne Perplexity), damit keine externen Informationen die Vergleichbarkeit verzerren.",
  "Konsens/Divergenz zwischen den Providern wird rein regelbasiert ausgewertet (gleicher bias bei allen = Konsens), nicht durch ein weiteres Modell.",
  "Wird NICHT automatisch aktualisiert -- jeder Lauf kostet bis zu 3 bezahlte AI-Aufrufe und entsteht nur per Klick, und nur wenn oben mindestens ein aktiver Trigger angezeigt wird.",
  "Kein Handelssignal -- eine Konsens-Divergenz zwischen drei KIs heisst nur, dass die Lage aus KI-Sicht uneindeutig ist, keine Handlungsempfehlung.",
].join("\n\n");

const BIAS_STYLES: Record<string, string> = {
  bullish: "border-up/40 bg-up/10 text-up",
  bearish: "border-down/40 bg-down/10 text-down",
  neutral: "border-border text-text-faint",
};

const BIAS_LABELS: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const CONSENSUS_STYLES: Record<string, string> = {
  AGREEMENT: "border-up/40 bg-up/10 text-up",
  DIVERGENCE: "border-down/40 bg-down/10 text-down",
  INCONCLUSIVE: "border-border text-text-faint",
};

const CONSENSUS_LABELS: Record<string, string> = {
  AGREEMENT: "Konsens",
  DIVERGENCE: "Divergenz zwischen den KIs",
  INCONCLUSIVE: "Nicht auswertbar",
};

const TRIGGER_SOURCE_LABELS: Record<EscalationTriggerRecord["source"], string> = {
  "signal-engine": "Signal-Engine",
  "divergence-radar": "Divergenz-Radar",
  "report-master": "Report-Master",
};

export default function EscalationCard({
  initialTriggers,
  initialSnapshot,
}: {
  initialTriggers: EscalationTriggerRecord[];
  initialSnapshot: EscalationSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveTrigger = initialTriggers.length > 0;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/escalation/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as EscalationSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Eskalation: Zweitmeinungen (KI)</p>
          <PanelInfo title="Eskalation: Zweitmeinungen (KI)" content={INFO_TEXT} />
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !hasActiveTrigger}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Generiert…" : "Zweitmeinungen einholen"}
        </button>
      </div>

      {hasActiveTrigger ? (
        <div className="space-y-1.5">
          {initialTriggers.map((trigger, i) => (
            <div key={i} className="rounded-md border border-accent/40 bg-accent/10 p-2 text-xs">
              <p className="font-medium text-text">
                {TRIGGER_SOURCE_LABELS[trigger.source]}: {trigger.label}
              </p>
              {trigger.detail.length > 0 && (
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-text-faint">
                  {trigger.detail.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-faint">
          Aktuell keine Divergenz/kein Widerspruch erkannt -- keine Eskalation noetig.
        </p>
      )}

      {error && <p className="text-xs text-down">{error}</p>}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
            {snapshot.consensus && (
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                  CONSENSUS_STYLES[snapshot.consensus]
                }`}
              >
                {CONSENSUS_LABELS[snapshot.consensus]}
              </span>
            )}
          </div>

          <div className="space-y-2">
            {snapshot.reads.map((read, i) => (
              <div key={i} className="rounded-md border border-border/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text">{read.provider}</p>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                      BIAS_STYLES[read.bias] ?? BIAS_STYLES.neutral
                    }`}
                  >
                    {BIAS_LABELS[read.bias] ?? read.bias} · {read.confidence}%
                  </span>
                </div>
                <p className="text-xs text-text-faint">{read.summary}</p>
              </div>
            ))}
          </div>

          {snapshot.failed_providers.length > 0 && (
            <p className="text-xs text-text-faint">
              Ohne Antwort: {snapshot.failed_providers.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
