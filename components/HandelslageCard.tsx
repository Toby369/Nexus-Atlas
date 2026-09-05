"use client";

import { useState } from "react";
import type { HandelslageSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 3 (05.09.2026): Handelslage-KI-Kachel, Konzept aus
// server/handelslage.js im Crypto-Trading-Journal -- eine kurze, guenstige
// "was halten die naechsten Stunden bereit"-Einschaetzung, eigenstaendig
// neben der Gesamteinschaetzung (14-Faktoren-Score, "wo stehen wir gerade")
// und den grossen taeglichen AI-Reports (Report 1-4). Zeigt ausschliesslich
// den zwischengespeicherten letzten Stand server-seitig an -- ein neuer,
// bezahlter AI-Aufruf passiert nur auf expliziten Klick.

const INFO_TEXT = [
  "Was das ist: eine kurze KI-Einschaetzung fuer die naechsten Stunden, keine Tages- oder Zyklus-Analyse. Kernkennzahl ist der Bewegungsvorrat -- die heutige Tagesspanne relativ zum Median der letzten 10 Tage.",
  "Bewegungsvorrat deutlich ueber 100%: der Tag hat sein uebliches Bewegungspensum schon ausgeschoepft -- eine Fortsetzung derselben Bewegung ist dann unwahrscheinlicher, egal wie sauber der Trend aussieht. Unter 100%: noch Spielraum vorhanden.",
  "Wird NICHT automatisch aktualisiert (anders als die Gesamteinschaetzung) -- jeder neue Stand kostet einen bezahlten AI-Aufruf und entsteht nur per Klick auf \"Neu generieren\".",
  "Kein Handelssignal, keine Kursziele -- nur Bedingungen (wenn/dann) und wann die Einschaetzung als ungueltig gilt.",
].join("\n\n");

function formatRatio(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(0)}%`;
}

export default function HandelslageCard({
  initialSnapshot,
}: {
  initialSnapshot: HandelslageSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/handelslage/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as HandelslageSnapshot);
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
          <p className="text-sm font-medium text-text">Handelslage</p>
          <PanelInfo title="Handelslage" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch keine Handelslage generiert.</p>
      )}

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && snapshot.result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-text-faint">Bewegungsvorrat:</span>
            <span className="font-semibold text-text">{formatRatio(snapshot.bewegungsvorrat_pct)}</span>
            <span className="text-text-faint">·</span>
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
          </div>

          <p className="text-sm text-text-muted leading-relaxed">{snapshot.result.einschaetzung}</p>

          {snapshot.result.bedingungen.length > 0 && (
            <ul className="space-y-1 text-xs text-text-muted list-disc list-inside">
              {snapshot.result.bedingungen.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-text-faint">
            Ungültig wenn: {snapshot.result.ungueltigWenn}
          </p>
        </div>
      )}
    </div>
  );
}
