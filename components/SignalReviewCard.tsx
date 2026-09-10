"use client";

import { useState } from "react";
import type { SignalReviewSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Periodischer KI-Rueckblick, Phase 3 (10.09.2026) -- KI-Einordnung der in
// Phase 2 (compute_signal_stats(), signal_stats_results) bereits fertig
// berechneten Trefferquoten/Baselines/BH-FDR-Ergebnisse. Kein eigener Bias,
// kein Handelssignal -- liest ausschliesslich schon berechnete Zahlen und
// schreibt eine verstaendliche deutsche Einordnung (siehe
// lib/signalReviewContext.ts + lib/ai/promptProfiles.ts "signal-review").
// Anders als die meisten anderen KI-Kacheln laeuft diese primaer
// automatisch woechentlich (signal-review-scheduler-Cron, Montag kurz nach
// 05:00 UTC) -- der Button erlaubt zusaetzlich ein manuelles Update.

const INFO_TEXT = [
  "Was das ist: ein periodischer, transparenter Rueckblick -- vergleicht regelmaessig vergangene Signale (TradingView-Alerts, Warn-Muster, Risk-Faktoren, Kern-Engine-Zustaende -- weitere Gruppen folgen) mit dem, was der Preis danach tatsaechlich gemacht hat. Die KI erfindet dabei keine eigene Statistik, sondern ordnet nur bereits fertig berechnete Zahlen ein (Trefferquote vs. unbedingte Basiswahrscheinlichkeit, Benjamini-Hochberg-Mehrfachvergleichs-Korrektur).",
  "'Robuste Funde' sind Zellen, die die Mehrfachvergleichs-Korrektur tatsaechlich uebersteht -- die meisten getesteten Muster tun das NICHT, das ist der Normalfall bei kurzer Historie und kein Fehler der Methode.",
  "'Verfallend/fragil' markiert Signale, deren Edge im rollierenden 90-Tage-Fenster deutlich schwaecher ist als in der Gesamthistorie -- ein moegliches Warnzeichen, dass ein frueher gefundener Effekt nachlaesst.",
  "Aktualisiert sich automatisch woechentlich (Montag, kurz nach 05:00 UTC) -- \"Neu generieren\" loest zusaetzlich einen manuellen, bezahlten AI-Aufruf aus.",
  "Kein Handelssignal -- dient ausschliesslich der ehrlichen Selbstueberpruefung der bestehenden Nexus-Signale, nicht der Ableitung einer neuen Marktrichtung.",
].join("\n\n");

export default function SignalReviewCard({
  initialSnapshot,
}: {
  initialSnapshot: SignalReviewSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signal-review/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as SignalReviewSnapshot);
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
          <p className="text-sm font-medium text-text">Periodischer Rückblick (KI)</p>
          <PanelInfo title="Periodischer Rückblick (KI)" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch kein Rückblick generiert.</p>
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

          {snapshot.result.robust_findings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-up">Robuste Funde</p>
              <ul className="space-y-1 list-disc list-inside">
                {snapshot.result.robust_findings.map((finding, i) => (
                  <li key={i} className="text-xs text-text-faint">
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {snapshot.result.decaying_or_fragile.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-down">Verfallend / fragil</p>
              <ul className="space-y-1 list-disc list-inside">
                {snapshot.result.decaying_or_fragile.map((finding, i) => (
                  <li key={i} className="text-xs text-text-faint">
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-text-faint italic">{snapshot.result.insufficient_data_note}</p>
        </div>
      )}
    </div>
  );
}
