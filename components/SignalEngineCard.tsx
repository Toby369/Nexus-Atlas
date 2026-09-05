"use client";

import { useState } from "react";
import type { SignalEngineSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Signal-Engine-Kachel, Thema KI, Punkt 2/2 (05.09.2026) -- zweite Kachel
// mit Anthropic als primaerem Provider (siehe lib/ai/tileConfig.ts
// "signal-engine" -> "auto" -> "signal-logic"-Kategorie -> Anthropic,
// Fallback DeepSeek). Kein eigener Bias: prueft die bestehende regelbasierte
// Gesamteinschaetzung (14-Faktoren-Engine, market_states) auf innere
// Konsistenz -- ein zweites Paar Augen auf deren eigene Ausgabe, kein
// Ersatz dafuer. Zeigt ausschliesslich den zwischengespeicherten letzten
// Stand server-seitig an -- ein neuer, bezahlter AI-Aufruf passiert nur auf
// Klick.

const INFO_TEXT = [
  "Was das ist: eine KI-Konsistenzpruefung der bestehenden regelbasierten Gesamteinschaetzung (14-Faktoren-Engine, siehe MarketStateCard) -- kein eigener Bias und keine zweite Marktmeinung, sondern ein zweites Paar Augen auf deren eigene Ausgabe (passt overall_state zur Mehrheit der Faktoren, widerspricht ein gemeldetes Muster der Richtung, ist eine hohe confidence bei niedrigem Konsens erklaerbar).",
  "Primaerer Provider ist Anthropic (Claude) -- faellt er aus, springt DeepSeek ein.",
  "Wird NICHT automatisch aktualisiert -- jeder neue Stand kostet einen bezahlten AI-Aufruf und entsteht nur per Klick auf \"Neu generieren\". Ohne vorhandene Gesamteinschaetzung gibt es nichts zu pruefen (kein AI-Aufruf, kein Snapshot).",
  "Kein Handelssignal -- ein 'isConsistent: false' heisst nur, dass die Engine-Ausgabe sich selbst widerspricht, nicht, dass der Markt in eine bestimmte Richtung geht.",
].join("\n\n");

export default function SignalEngineCard({
  initialSnapshot,
}: {
  initialSnapshot: SignalEngineSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signal-engine/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as SignalEngineSnapshot);
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
          <p className="text-sm font-medium text-text">Signal Engine (KI)</p>
          <PanelInfo title="Signal Engine (KI)" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch keine Konsistenzpruefung generiert.</p>
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
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                snapshot.result.isConsistent
                  ? "border-up/40 bg-up/10 text-up"
                  : "border-down/40 bg-down/10 text-down"
              }`}
            >
              {snapshot.result.isConsistent ? "Konsistent" : "Widerspruch gefunden"}
            </span>
          </div>

          <p className="text-sm text-text-muted leading-relaxed">{snapshot.result.summary}</p>

          {snapshot.result.concerns.length > 0 && (
            <ul className="space-y-1 list-disc list-inside">
              {snapshot.result.concerns.map((concern, i) => (
                <li key={i} className="text-xs text-text-faint">
                  {concern}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
