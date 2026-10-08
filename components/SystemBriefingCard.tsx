"use client";

import { useState } from "react";
import type { SystemBriefingResult, SystemBriefingSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 4 (18.09.2026): "kombinierte Entscheidungsunter-
// stuetzungs-Kachel" -- fusioniert Tobys eigenes Regelwerk (Welz/Salomon +
// "Mein Trading System"-Checkliste) + Nexus' eigene berechnete Faktoren
// (14-Faktoren-Engine, GUSS/VWAP-Vector/CVD, Liquidations-Cluster) zu EINER
// Synthese, siehe lib/systemBriefingContext.ts + Prompt-Profil
// "system-briefing".
//
// 30.09.2026 -- komplett neu strukturiert UND mit der vormals eigenstaendigen
// Handelslage-Kachel zusammengelegt (Nutzer: "brauche nicht weitere
// Kacheln, moechte vorhandenes komprimieren"). Vier klar benannte
// Abschnitte statt einem langen Fliesstext-Block: Fazit (bias/confidence/
// Kernaussage), Regelwerk-Check, optionaler Kontext-Check (nur bei
// Widerspruch) und Trigger&Szenario -- letzterer jetzt inkl. konkretem
// Kursziel (Nutzer-Entscheidung 30.09.2026: "konkrete Kursziele erlauben",
// vorher verboten -- dieselbe Sprache wie schon laenger bei Trade-Debate).
//
// Erweitert 22.09.2026 um Marktkontext/ETF-Flows/Positionierung/News --
// ersetzt seither die vormals separate "Zusammenfassung"-Kachel in
// HeroHeader (eigener AI-Aufruf/eigene Route fuer eine inhaltlich stark
// ueberlappende Frage). HeroHeader zeigt seither nur noch das Fazit
// DIESES Snapshots (siehe HeroHeader.tsx, "Kurze Einordnung").
//
// Auto-Refresh (23.09.2026): HeroHeader loest ab NARRATIVE_AUTO_REFRESH_HOURS
// (dort definiert) selbststaendig einen neuen Stand aus, wenn der zuletzt
// angezeigte zu alt ist -- diese Kachel liest denselben system_briefings-
// Snapshot und zeigt den dadurch aktualisierten Stand automatisch mit,
// zusaetzlich zum weiterhin verfuegbaren manuellen "Neu generieren".
//
// 01.10.2026 -- Nutzer-Feedback nach Review eines Live-Snapshots: Regelwerk-
// Check als ein dichter Fliesstext-Satz war "ueberhaupt nicht verstaendlich".
// Jetzt max. 4 gelabelte Zeilen (Gates/Orderflow/Bewegungsvorrat/Liquidation,
// \n-getrennt im Prompt-Profil, siehe lib/ai/promptProfiles.ts) statt eines
// Blocks -- parseRegelwerkLines() splittet dafuer. GUSS wird in der
// Orderflow-Zeile nur noch erwaehnt, wenn Nexus' Regime-Engine tatsaechlich
// einen Trend erkennt (sonst ist GUSS schlicht nicht anwendbar) -- vorher
// stand dort oft nur Rauschen wie "GUSS aktiv=false (Regime ...)".
//
// 06.10.2026 -- Zusammengelegt mit der vormals eigenstaendigen Chart-
// Narrativ-Kachel (Nutzer-Audit "welche Reports sind sehr aehnlich?" --
// beide nutzten bereits denselben breiten Signal-Satz). Zwei Abschnitte
// kamen dazu (Chart-Struktur, vormals "structureNarrative"), zwei wurden
// zusammengefuehrt (kontextCheck + confluence -> konfluenzCheck), und
// Trigger&Szenario zeigt jetzt IMMER beide Richtungen (bullish+bearish,
// Nutzer-Entscheidung) statt nur eines Pfads -- siehe ScenarioBlock unten.

const INFO_TEXT = [
  "Was das ist: eine KI-Synthese, die dein eigenes Regelwerk (Welz/Salomon-Methodik + \"Mein Trading System\"-Checkliste) UND die algorithmisch berechnete Chart-Struktur (Formationen, Key Levels, Level-Struktur) auf den aktuellen Stand von Nexus' berechneten Faktoren anwendet -- Bewegungsvorrat, 14-Faktoren-Engine, VWAP-Vector/CVD, Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News.",
  "Wiederholt bewusst KEINE der einzeln angezeigten Werte — sagt stattdessen, ob dein eigenes Regelwerk aktuell erfüllt ist, was die Chart-Struktur zeigt, und ob sich die Quellen gegenseitig bestätigen oder widersprechen. Der Konfluenz-Check erscheint nur, wenn es einen echten Widerspruch gibt.",
  "Regelwerk-Check steht als kurze Zeilen statt als ein Fliesstext-Block (Gates / Orderflow / Bewegungsvorrat / Liquidation) — nur befüllte Zeilen werden gezeigt. GUSS taucht in der Orderflow-Zeile nur auf, wenn Nexus' Regime-Engine gerade einen Trend erkennt (sonst ist GUSS gar nicht anwendbar) — dann als kurze Info/Erinnerung, nicht als eigenständiges Signal.",
  "Trigger & Szenario zeigt IMMER beide Richtungen (bullisch + bärisch) mit je eigenem Kursziel — jedes Kursziel entspricht zwingend einem echten Key Level, nie einer frei geschätzten Zahl. Trotzdem eine Entscheidungsunterstützung anhand deiner eigenen Regeln und der Chart-Struktur, keine automatisierte Anlageberatung.",
  "Die \"Kurze Einordnung\" oben in der Gesamteinschätzung (HeroHeader) zeigt das Fazit dieser Analyse.",
  "Aktualisiert sich automatisch, sobald der zuletzt generierte Stand zu alt wird (ausgelöst über die \"Kurze Einordnung\" oben) — zusätzlich weiterhin per Klick auf \"Neu generieren\" hier möglich.",
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

// regelwerkCheck kommt seit 01.10.2026 als max. 4 Zeilen ("Label: Befund"),
// durch \n getrennt, statt als ein dichter Fliesstext-Block (Nutzer-
// Feedback: "für mich ist der text ueberhaupt nicht verstaendlich") --
// hier je Zeile in Label/Rest gesplittet, damit das Label fett vom Befund
// abgesetzt werden kann statt in einem einzigen Satz unterzugehen.
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

// Schutz gegen Alt-Format-Snapshots (vor der Fusion mit Handelslage am
// 30.09.2026 hatten result-Spalten noch die Form { narrative: string },
// vor der Zusammenlegung mit Chart-Narrativ am 06.10.2026 fehlten
// chartStruktur/trigger.bullish/trigger.bearish) -- ohne diesen Guard wirft
// der Render unten und reisst die ganze Seite mit runter.
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
}: {
  initialSnapshot: SystemBriefingSnapshot | null;
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

      {/* 08.10.2026 -- Bugfix (Live-Vorfall, Screenshot zeigte zwei
          widerspruechliche Fehlermeldungen gleichzeitig): `error` (dieser
          Klick) und `snapshot.error` (zuletzt GESPEICHERTER Lauf, z.B. vom
          Seitenaufruf) sind zwei unabhaengige Quellen -- schlaegt ein Klick
          fehl, bleibt `snapshot` unveraendert (siehe handleGenerate(), kein
          setSnapshot() im Fehlerfall), der veraltete DB-Fehler stand also
          weiterhin parallel zum frischen `error` da. `error` ist bei einem
          erneuten Klick-Fehlschlag immer die aktuellere der beiden -- bei
          `error` also den DB-Fehler ausblenden statt beide zu zeigen. */}
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
            <span className="text-text-faint">· Confidence {result.fazit.confidence}/100</span>
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

      <p className="text-xs text-text-faint pt-1">
        Entscheidungsunterstützung anhand deines eigenen Regelwerks, keine automatisierte Anlageberatung.
      </p>
    </div>
  );
}
