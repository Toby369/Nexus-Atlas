"use client";

import { useState } from "react";
import type { CustomQueryRun } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026: "kann ich eine Kachel
// haben, in der ich KI konkreter Auftrag geben kann?"). Du formulierst eine
// beliebige Aufgabe/Frage, die KI beantwortet sie ausschliesslich anhand des
// echten, strukturierten Nexus-Marktkontexts (siehe lib/customQueryContext.ts)
// -- nie mit erfundenen Zahlen. Provider: Google primaer, OpenRouter/Groq als
// Fallback (kostenlose Kette).

const INFO_TEXT = [
  "Was das ist: du stellst der KI eine frei formulierte Aufgabe oder Frage (z.B. 'Ist X gerade ein guter Einstieg unter Beruecksichtigung von Y?'). Anders als die anderen KI-Kacheln hat diese keinen festen Zweck -- deine Eingabe bestimmt die Aufgabe.",
  "Datengrundlage: derselbe strukturierte, validierte Marktkontext wie die grosse Report-Engine (Preis, OI, Funding, Spot-Pressure, Liquidationen, Positionierung, News, ETF-Flows, 14-Faktoren-Gesamtzustand). Die KI erfindet keine Zahlen -- reicht die Datengrundlage fuer deine Frage nicht, sagt sie das explizit statt zu spekulieren.",
  "Kostenlos: Google primaer, OpenRouter/Groq als Fallback -- alles im Gratis-Tier. Wird NICHT automatisch ausgefuehrt, nur per Klick auf 'Anfrage stellen'.",
  "Kein Handelssignal, keine Anlageberatung -- eine Interpretationshilfe anhand vorhandener Daten, die eigene Entscheidung bleibt bei dir.",
].join("\n\n");

export default function CustomQueryCard({
  initialRuns,
}: {
  initialRuns: CustomQueryRun[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (prompt.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-query/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setRuns((prev) => [json.run as CustomQueryRun, ...prev]);
      setPrompt("");
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
          <p className="text-sm font-medium text-text">Freie Anfrage (KI)</p>
          <PanelInfo title="Freie Anfrage (KI)" content={INFO_TEXT} />
        </span>
      </div>

      <div className="space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="z.B. Ist ein Long-Einstieg jetzt sinnvoll unter Beruecksichtigung von Funding und Liquidations-Clustern?"
          className="w-full text-xs rounded-md border border-border bg-surface-raised text-text px-2 py-1.5 focus:outline-none focus:border-accent/40"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || prompt.trim().length === 0}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Fragt an…" : "Anfrage stellen"}
        </button>
      </div>

      {error && <p className="text-xs text-down">{error}</p>}

      {runs.length === 0 && !error && (
        <p className="text-xs text-text-faint">Noch keine Anfragen gestellt.</p>
      )}

      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="rounded-md border border-border/60 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] text-text-faint flex-wrap">
              <FullDateTime iso={r.generated_at} />
              <StaleBadge iso={r.generated_at} />
              {r.provider && <span>via {r.provider}</span>}
            </div>
            <p className="text-xs font-medium text-text">{r.prompt}</p>
            {r.status === "ok" && r.answer && (
              <p className="text-xs text-text-faint whitespace-pre-wrap">{r.answer}</p>
            )}
            {r.status === "error" && (
              <p className="text-xs text-down">{r.error ?? "Anfrage fehlgeschlagen."}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
