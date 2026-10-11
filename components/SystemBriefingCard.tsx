"use client";

import { useState } from "react";
import type { CustomQueryRun, SystemBriefingResult, SystemBriefingSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";
import CustomQueryPanel from "@/components/CustomQueryPanel";

// System-Briefing: fusioniert Tobys eigenes Regelwerk (Welz/Salomon + "Mein
// Trading System"-Checkliste) mit Nexus' berechneten Faktoren (14-Faktoren-
// Engine, GUSS/VWAP-Vector/CVD, Liquidations-Cluster, Marktkontext, ETF-Flows,
// Positionierung, News, Handelslage) zu EINER Synthese -- siehe
// lib/systemBriefingContext.ts und Prompt-Profil "system-briefing".
//
// Abschnitte: Fazit (bias/confidence/Kernaussage), Regelwerk-Check (max. 4
// gelabelte Zeilen, siehe parseRegelwerkLines), Chart-Struktur, optionaler
// Konfluenz-Check (nur bei Widerspruch) und Trigger & Szenario mit beiden
// Richtungen inkl. konkretem Kursziel. GUSS erscheint im Regelwerk-Check nur,
// wenn die Regime-Engine tatsaechlich einen Trend erkennt.
//
// Das Fazit erscheint zusaetzlich als KI-Einordnung im Lagebild (HeroHeader),
// das ab NARRATIVE_AUTO_REFRESH_HOURS selbststaendig einen neuen Stand
// ausloest; diese Kachel zeigt denselben Snapshot und bietet weiterhin
// "Neu generieren" per Klick.

const INFO_TEXT = [
  "Was das ist: eine KI-Synthese, die dein eigenes Regelwerk (Welz/Salomon-Methodik + \"Mein Trading System\"-Checkliste) UND die algorithmisch berechnete Chart-Struktur (Formationen, Key Levels, Level-Struktur) auf den aktuellen Stand von Nexus' berechneten Faktoren anwendet -- Bewegungsvorrat, 14-Faktoren-Engine, VWAP-Vector/CVD, Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News.",
  "Wiederholt bewusst KEINE der einzeln angezeigten Werte — sagt stattdessen, ob dein eigenes Regelwerk aktuell erfüllt ist, was die Chart-Struktur zeigt, und ob sich die Quellen gegenseitig bestätigen oder widersprechen. Der Konfluenz-Check erscheint nur, wenn es einen echten Widerspruch gibt.",
  "Regelwerk-Check steht als kurze Zeilen statt als ein Fliesstext-Block (Gates / Orderflow / Bewegungsvorrat / Liquidation) — nur befüllte Zeilen werden gezeigt. GUSS taucht in der Orderflow-Zeile nur auf, wenn Nexus' Regime-Engine gerade einen Trend erkennt (sonst ist GUSS gar nicht anwendbar) — dann als kurze Info/Erinnerung, nicht als eigenständiges Signal.",
  "Trigger & Szenario zeigt IMMER beide Richtungen (bullisch + bärisch) mit je eigenem Kursziel — jedes Kursziel entspricht zwingend einem echten Key Level, nie einer frei geschätzten Zahl. Trotzdem eine Entscheidungsunterstützung anhand deiner eigenen Regeln und der Chart-Struktur, keine automatisierte Anlageberatung.",
  "Die \"KI-Einordnung\" oben im Lagebild zeigt das Fazit dieser Analyse.",
  "Aktualisiert sich automatisch, sobald der zuletzt generierte Stand zu alt wird (ausgelöst über die \"KI-Einordnung\" im Lagebild oben) — zusätzlich weiterhin per Klick auf \"Neu generieren\" hier möglich.",
].join("\n\n");

const BIAS_LABEL: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "Bullisch",
  bearish: "Bärisch",
  neutral: "Neutral",
};

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function ScenarioBlock({
  label,
  scenario,
  tone,
}: {
  label: string;
  scenario: { bedingungen: string[]; kursziel: number | null };
  tone: "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-up" : "text-down";
  if (scenario.bedingungen.length === 0 && scenario.kursziel === null) {
    return (
      <div className="rounded-md border border-border/60 p-2.5 space-y-1">
        <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
        <p className="text-xs text-text-faint">Kein plausibles Szenario aus der aktuellen Lage ableitbar.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1">
      <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
      {scenario.bedingungen.length > 0 && (
        <ul className="space-y-1 text-xs text-text-muted list-disc list-inside">
          {scenario.bedingungen.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {scenario.kursziel !== null && (
        <p className="text-xs text-text">
          Kursziel: <span className="font-semibold">{formatPrice(scenario.kursziel)}</span>
        </p>
      )}
    </div>
  );
}

// regelwerkCheck kommt als max. 4 Zeilen ("Label: Befund", durch \n
// getrennt) -- hier je Zeile in Label/Rest gesplittet, damit das Label fett
// vom Befund abgesetzt werden kann.
function parseRegelwerkLines(text: string): { label: string; detail: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIdx = line.indexOf(":");
      if (separatorIdx === -1) return { label: "", detail: line };
      return { label: line.slice(0, separatorIdx).trim(), detail: line.slice(separatorIdx + 1).trim() };
    });
}

// Schutz gegen Snapshots in aelteren Formaten (z.B. { narrative: string }
// oder ohne chartStruktur/trigger.bullish/trigger.bearish) -- ohne diesen
// Guard wuerde der Render unten die ganze Seite mitreissen.
function isValidResult(result: unknown): result is SystemBriefingResult {
  if (!result || typeof result !== "object") return false;
  const r = result as Partial<SystemBriefingResult>;
  return (
    !!r.fazit &&
    typeof r.fazit.bias === "string" &&
    typeof r.fazit.kernaussage === "string" &&
    typeof r.regelwerkCheck === "string" &&
    typeof r.chartStruktur === "string" &&
    !!r.trigger &&
    !!r.trigger.bullish &&
    Array.isArray(r.trigger.bullish.bedingungen) &&
    !!r.trigger.bearish &&
    Array.isArray(r.trigger.bearish.bedingungen) &&
    typeof r.trigger.invalidierung === "string"
  );
}

export default function SystemBriefingCard({
  initialSnapshot,
  initialCustomQueries,
}: {
  initialSnapshot: SystemBriefingSnapshot | null;
  initialCustomQueries: CustomQueryRun[];
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system-briefing/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setSnapshot(json.snapshot as SystemBriefingSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const rawResult = snapshot?.status === "ok" ? snapshot.result : null;
  const result = rawResult && isValidResult(rawResult) ? rawResult : null;
  const isStaleFormat = snapshot?.status === "ok" && !!rawResult && !result;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">System-Briefing</p>
          <PanelInfo title="System-Briefing" content={INFO_TEXT} />
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
        <p className="text-xs text-text-faint">Noch kein System-Briefing generiert.</p>
      )}

      {/* `error` (dieser Klick) und `snapshot.error` (zuletzt gespeicherter
          Lauf) sind zwei unabhaengige Quellen; ein fehlgeschlagener Klick
          laesst `snapshot` unveraendert. `error` ist dann immer die aktuellere
          Meldung -- den gespeicherten Fehler daneben ausblenden. */}
      {!error && snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {isStaleFormat && (
        <p className="text-xs text-text-faint">
          Dieser Stand ist im alten Format (vor der Zusammenlegung mit Chart-Narrativ) — bitte neu generieren.
        </p>
      )}

      {snapshot && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span
              className={
                result.fazit.bias === "bullish"
                  ? "text-up font-semibold"
                  : result.fazit.bias === "bearish"
                  ? "text-down font-semibold"
                  : "text-text-muted font-semibold"
              }
            >
              {BIAS_LABEL[result.fazit.bias]}
            </span>
            <span className="text-text-faint">· Briefing-Überzeugungsgrad {result.fazit.confidence}/100</span>
            <span className="text-text-faint">·</span>
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
          </div>
          <p className="text-sm text-text leading-relaxed">{result.fazit.kernaussage}</p>

          <div className="pt-2 border-t border-border/60 space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Regelwerk-Check</p>
            <ul className="space-y-1">
              {parseRegelwerkLines(result.regelwerkCheck).map(({ label, detail }, i) => (
                <li key={i} className="text-sm text-text-muted leading-relaxed">
                  {label && <span className="text-text font-medium">{label}: </span>}
                  {detail}
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-2 border-t border-border/60 space-y-1">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Chart-Struktur</p>
            <p className="text-sm text-text-muted leading-relaxed">{result.chartStruktur}</p>
          </div>

          {result.konfluenzCheck && (
            <div className="pt-2 border-t border-border/60 space-y-1">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Konfluenz-Check</p>
              <p className="text-sm text-text-muted leading-relaxed">{result.konfluenzCheck}</p>
            </div>
          )}

          <div className="pt-2 border-t border-border/60 space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Trigger &amp; Szenario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
              <ScenarioBlock label="Bullisches Szenario" scenario={result.trigger.bullish} tone="up" />
              <ScenarioBlock label="Bärisches Szenario" scenario={result.trigger.bearish} tone="down" />
            </div>
            <p className="text-xs text-text-faint">Ungültig wenn: {result.trigger.invalidierung}</p>
          </div>
        </div>
      )}

      {/* Freie Anfrage: arbeitet auf demselben Marktkontext, daher hier
          eingeklappt. Offen, sobald juengste Anfragen vorliegen. */}
      <details className="pt-2 border-t border-border/60" open={initialCustomQueries.length > 0}>
        <summary className="text-xs text-text-muted hover:text-text cursor-pointer select-none">
          Rückfrage an die KI stellen
        </summary>
        <div className="pt-2">
          <CustomQueryPanel initialRuns={initialCustomQueries} />
        </div>
      </details>

      <p className="text-xs text-text-faint pt-1">
        Entscheidungsunterstützung anhand deines eigenen Regelwerks, keine automatisierte Anlageberatung.
      </p>
    </div>
  );
}
