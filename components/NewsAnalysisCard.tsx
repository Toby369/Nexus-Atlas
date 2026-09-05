"use client";

import { useState } from "react";
import type { NewsAnalysisSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// News-Kachel, KI-Ergaenzung (05.09.2026) -- erste Kachel mit Perplexity als
// primaerem Provider (siehe lib/ai/tileConfig.ts "news" -> "auto" ->
// "research"-Kategorie -> Perplexity, Fallback Google). Ergaenzt das
// bestehende regelbasierte News-Risk-Panel (Keyword-/Kategorie-
// Klassifikation) um eine inhaltliche Einordnung derselben, bereits
// gefilterten Schlagzeilen -- keine zweite, unabhaengige News-Quelle.
// Zeigt ausschliesslich den zwischengespeicherten letzten Stand server-
// seitig an -- ein neuer, bezahlter AI-Aufruf passiert nur auf Klick.

const INFO_TEXT = [
  "Was das ist: eine KI-Einordnung derselben Schlagzeilen, die das News & Risiko-Panel bereits regelbasiert als markbewegend markiert hat -- keine zweite, unabhaengige Nachrichtenquelle und kein Ersatz fuer dieses Panel.",
  "Primaerer Provider ist Perplexity (einziger der bei Nexus angebundenen Anbieter mit echter Web-Suche) -- kann dadurch Kontext zu einer Schlagzeile ergaenzen, den die reine Klassifikation nicht zeigt. Faellt Perplexity aus, springt Google Gemini ein (ohne Live-Suche); das Modell darf dabei ausdruecklich keine Nachrichten erfinden, die nicht in der Liste stehen.",
  "Wird NICHT automatisch aktualisiert -- jeder neue Stand kostet einen bezahlten AI-Aufruf und entsteht nur per Klick auf \"Neu generieren\". Ohne markbewegende News der letzten 72h gibt es nichts zu analysieren (kein AI-Aufruf, kein Snapshot).",
  "Kein Handelssignal -- Einordnung/Kontext zu bereits bekannten Schlagzeilen, keine Vorhersage.",
].join("\n\n");

const IMPACT_STYLES: Record<string, string> = {
  high: "border-down/40 bg-down/10 text-down",
  medium: "border-accent/40 bg-accent/10 text-accent",
  low: "border-border text-text-faint",
};

const IMPACT_LABELS: Record<string, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

export default function NewsAnalysisCard({
  initialSnapshot,
}: {
  initialSnapshot: NewsAnalysisSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/news-analysis/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as NewsAnalysisSnapshot);
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
          <p className="text-sm font-medium text-text">News-Einordnung (KI)</p>
          <PanelInfo title="News-Einordnung (KI)" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch keine News-Einordnung generiert.</p>
      )}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && snapshot.result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
            {snapshot.provider && (
              <span className="text-text-faint">via {snapshot.provider}</span>
            )}
          </div>

          <p className="text-sm text-text-muted leading-relaxed">{snapshot.result.summary}</p>

          {snapshot.result.items.length > 0 && (
            <div className="space-y-2">
              {snapshot.result.items.map((item, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2.5 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text">{item.headline}</p>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                        IMPACT_STYLES[item.impact] ?? IMPACT_STYLES.low
                      }`}
                    >
                      {IMPACT_LABELS[item.impact] ?? item.impact}
                    </span>
                  </div>
                  <p className="text-xs text-text-faint">{item.reasoning}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
