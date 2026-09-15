"use client";

import { useState } from "react";
import type { MarketStateNarrativeSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Nutzer-Wunsch 15.09.2026: Text-Zusammenfassung zur Gesamteinschaetzung --
// erklaert NICHT die einzelnen, bereits oben angezeigten Sparten-Werte
// nochmals, sondern Widersprueche/Zusammenhaenge zwischen ihnen und WARUM
// die Verlaesslichkeits-Zahl so ist wie sie ist (Salomon-Phase als
// Pruefraster, siehe lib/ai/promptProfiles.ts Profil
// "market-state-narrative"). Gleiches click-triggered Muster wie
// HandelslageCard.tsx -- kein Auto-Refresh, jeder neue Stand kostet einen
// bezahlten AI-Aufruf.

const INFO_TEXT = [
  "Was das ist: eine kurze KI-Einordnung, wie die einzelnen Sparten der Gesamteinschätzung (Marktkontext, Marktphase, ETF-Flows, Positionierung, Liquidationen, News, Salomon-Phase) zueinander stehen.",
  "Wiederholt bewusst KEINE der oben bereits angezeigten Einzelwerte — sagt stattdessen, wo sich Sparten bestätigen oder widersprechen, und warum die Verlässlichkeits-Zahl so ausfällt wie sie ausfällt.",
  "Wird NICHT automatisch aktualisiert — jeder neue Stand kostet einen bezahlten AI-Aufruf und entsteht nur per Klick auf \"Neu generieren\".",
  "Keine Handelsempfehlung, keine Kursziele — reine Einordnung der bereits vorhandenen, regelbasierten Werte.",
].join("\n\n");

export default function MarketStateNarrativeCard({
  initialSnapshot,
}: {
  initialSnapshot: MarketStateNarrativeSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/market-state-narrative/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as MarketStateNarrativeSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-2 border-t border-border/60 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-xs uppercase tracking-[0.15em] text-text-muted">Zusammenfassung</p>
          <PanelInfo title="Zusammenfassung" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch keine Zusammenfassung generiert.</p>
      )}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && snapshot.result && (
        <div className="space-y-1.5">
          <p className="text-sm text-text-muted leading-relaxed">{snapshot.result.narrative}</p>
          <div className="flex items-center gap-2 text-xs">
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
          </div>
        </div>
      )}
    </div>
  );
}
