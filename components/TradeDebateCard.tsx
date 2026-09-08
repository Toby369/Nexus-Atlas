"use client";

import { useState } from "react";
import type { TradeDebateSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Trade-Debate-Kachel (Nutzer-Idee 07.09.2026, TradingAgents-Architektur
// [arXiv:2412.20138] recherchiert und fuer Einzelnutzer verkleinert): ein
// BULLISHER und ein BAERISCHER Analyst suchen unabhaengig voneinander
// (versch. primaere Provider, siehe lib/ai/tileConfig.ts) nach einem
// Long-/Short-Setup anhand strukturierter TA- + Nexus-Derivatedaten. Ein
// dritter Referee/CIO prueft beide Reports und faellt die finale
// Entscheidung inkl. WAIT als vollwertigem Ergebnis.

const INFO_TEXT = [
  "Was das ist: zwei gegensaetzlich geprompte KI-Analysten (nicht dieselbe Frage zweimal, sondern bewusst ein Long- und ein Short-Suchauftrag) analysieren unabhaengig voneinander denselben strukturierten Datensatz (EMAs 20/50/100/200/800, Weekly-/Monthly-/Swing-VWAP, Pivot-Punkte, plus Nexus-Funding/OI/Liquidations-Cluster/14-Faktoren-Zustand) -- kein Chart-Bild, nur Zahlen (reduziert Halluzination).",
  "Ein dritter KI-Referee bekommt beide Reports + dieselbe Datengrundlage, prueft sie auf Plausibilitaet (inkl. Risk/Reward >= 1:2) und faellt die finale Entscheidung: long, short, oder wait -- ein 'wait'-Urteil bei einem echten Widerspruch zwischen Bull und Bear ist ein vollwertiges Ergebnis, kein Ausweichen.",
  "EMA800 ist eine in der Krypto-Szene gebraeuchliche, aber KEINE etablierte institutionelle Kennzahl wie EMA50/200 -- wird trotzdem mitgegeben, aber von den Analysten niedriger gewichtet.",
  "Wird NICHT automatisch aktualisiert -- jeder Lauf macht 3 KI-Aufrufe (Bull, Bear, Referee), alle ueber kostenlose Gratis-Tiers (Google, OpenRouter, Groq), und entsteht nur per Klick.",
  "Kein Handelssignal, keine Anlageberatung -- eine strukturierte Analysehilfe, die eigene Entscheidung bleibt bei dir.",
].join("\n\n");

const VERDICT_STYLES: Record<string, string> = {
  long: "border-up/40 bg-up/10 text-up",
  short: "border-down/40 bg-down/10 text-down",
  wait: "border-border text-text-faint",
};

const VERDICT_LABELS: Record<string, string> = {
  long: "LONG",
  short: "SHORT",
  wait: "WAIT",
};

const BIAS_STYLES: Record<string, string> = {
  long: "border-up/40 bg-up/10 text-up",
  short: "border-down/40 bg-down/10 text-down",
};

function formatUsd(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

export default function TradeDebateCard({
  initialSnapshot,
}: {
  initialSnapshot: TradeDebateSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-debate/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as TradeDebateSnapshot);
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
          <p className="text-sm font-medium text-text">Trade-Debate (KI)</p>
          <PanelInfo title="Trade-Debate (KI)" content={INFO_TEXT} />
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Analysiert…" : "Neu analysieren"}
        </button>
      </div>

      {error && <p className="text-xs text-down">{error}</p>}

      {!snapshot && !error && (
        <p className="text-xs text-text-faint">Noch keine Analyse durchgefuehrt.</p>
      )}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
            {snapshot.verdict && (
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                  VERDICT_STYLES[snapshot.verdict]
                }`}
              >
                {VERDICT_LABELS[snapshot.verdict]}
              </span>
            )}
            {snapshot.referee_result?.divergence_detected && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-md border border-down/40 bg-down/10 text-down font-medium">
                Divergenz zwischen Bull/Bear
              </span>
            )}
          </div>

          {snapshot.referee_result && (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5 space-y-1">
              <p className="text-xs font-medium text-text">
                Referee-Urteil {snapshot.referee_provider ? `(${snapshot.referee_provider})` : ""}
              </p>
              <p className="text-xs text-text-faint">{snapshot.referee_result.synthesis}</p>
              {snapshot.referee_result.invalidation_level !== null && (
                <p className="text-xs text-text-muted">
                  Invalidierung bei {formatUsd(snapshot.referee_result.invalidation_level)}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {snapshot.bull_read && (
              <div className="rounded-md border border-border/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text">Bull ({snapshot.bull_read.provider})</p>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${BIAS_STYLES.long}`}
                  >
                    {snapshot.bull_read.result.confidence}%
                  </span>
                </div>
                <p className="text-xs text-text-faint tabular font-mono">
                  Entry {formatUsd(snapshot.bull_read.result.entry_price)} · Ziel{" "}
                  {formatUsd(snapshot.bull_read.result.target_price)} · Invalid{" "}
                  {formatUsd(snapshot.bull_read.result.invalidation_price)} · R/R 1:
                  {snapshot.bull_read.result.risk_reward.toFixed(1)}
                </p>
                <p className="text-xs text-text-faint">{snapshot.bull_read.result.reasoning}</p>
              </div>
            )}
            {snapshot.bear_read && (
              <div className="rounded-md border border-border/60 p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text">Bear ({snapshot.bear_read.provider})</p>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${BIAS_STYLES.short}`}
                  >
                    {snapshot.bear_read.result.confidence}%
                  </span>
                </div>
                <p className="text-xs text-text-faint tabular font-mono">
                  Entry {formatUsd(snapshot.bear_read.result.entry_price)} · Ziel{" "}
                  {formatUsd(snapshot.bear_read.result.target_price)} · Invalid{" "}
                  {formatUsd(snapshot.bear_read.result.invalidation_price)} · R/R 1:
                  {snapshot.bear_read.result.risk_reward.toFixed(1)}
                </p>
                <p className="text-xs text-text-faint">{snapshot.bear_read.result.reasoning}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
