"use client";

import { useState } from "react";
import type { SystemBriefingSnapshot } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 4 (18.09.2026): "kombinierte Entscheidungsunter-
// stuetzungs-Kachel" -- fusioniert Tobys eigenes Regelwerk (Welz/Salomon +
// "Mein Trading System"-Checkliste) + Salomon-Phase + Nexus' eigene
// berechnete Faktoren (14-Faktoren-Engine, Regime Matrix, GUSS/VWAP-Vector/
// CVD, Liquidations-Cluster) + den Chart-Vision-Screenshot-Read (Phase 3) zu
// EINER Synthese, siehe lib/systemBriefingContext.ts + Prompt-Profil
// "system-briefing". Gleiches click-triggered Muster wie HandelslageCard.tsx
// -- jeder neue Stand kostet einen AI-Aufruf (kostenloses Gratis-Tier).
//
// Erweitert 22.09.2026 um Marktkontext/ETF-Flows/Positionierung/News --
// ersetzt seither die vormals separate "Zusammenfassung"-Kachel in
// HeroHeader (eigener AI-Aufruf/eigene Route fuer eine inhaltlich stark
// ueberlappende Frage). HeroHeader zeigt seither nur noch einen kurzen,
// rein clientseitig gekuerzten Auszug DIESES Snapshots (siehe HeroHeader.tsx,
// "Kurze Einordnung").
//
// Auto-Refresh (23.09.2026): HeroHeader loest ab NARRATIVE_AUTO_REFRESH_HOURS
// (dort definiert) selbststaendig einen neuen Stand aus, wenn der zuletzt
// angezeigte zu alt ist -- diese Kachel liest denselben system_briefings-
// Snapshot und zeigt den dadurch aktualisierten Stand automatisch mit,
// zusaetzlich zum weiterhin verfuegbaren manuellen "Neu generieren".

const INFO_TEXT = [
  "Was das ist: eine KI-Synthese, die dein eigenes Regelwerk (Welz/Salomon-Methodik + \"Mein Trading System\"-Checkliste) auf den aktuellen Stand von Nexus' berechneten Faktoren anwendet -- 14-Faktoren-Engine, Regime Matrix, GUSS/VWAP-Vector/CVD, Liquidations-Cluster, Salomon-Phase, Marktkontext, ETF-Flows, Positionierung, News und (falls aktuell vorhanden) den letzten Chart-Vision-Screenshot-Read.",
  "Wiederholt bewusst KEINE der einzeln angezeigten Werte — sagt stattdessen, ob dein eigenes Regelwerk aktuell erfüllt ist und ob sich die Quellen gegenseitig bestätigen oder widersprechen.",
  "Die \"Kurze Einordnung\" oben in der Gesamteinschätzung (HeroHeader) zeigt die ersten Sätze genau dieser Analyse als Auszug.",
  "Aktualisiert sich automatisch, sobald der zuletzt generierte Stand zu alt wird (ausgelöst über die \"Kurze Einordnung\" oben) — zusätzlich weiterhin per Klick auf \"Neu generieren\" hier möglich.",
  "Keine Handelsempfehlung, keine Kursziele — reine Entscheidungsunterstützung anhand deiner eigenen Regeln.",
].join("\n\n");

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

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">System-Briefing: Regelwerk &amp; Nexus-Faktoren</p>
          <PanelInfo title="System-Briefing: Regelwerk & Nexus-Faktoren" content={INFO_TEXT} />
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

      {snapshot && snapshot.status === "error" && (
        <p className="text-xs text-down">{snapshot.error ?? "Unbekannter Fehler."}</p>
      )}

      {snapshot && snapshot.status === "ok" && snapshot.result && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted leading-relaxed">{snapshot.result.narrative}</p>
          <div className="flex items-center gap-2 text-xs">
            <FullDateTime iso={snapshot.generated_at} className="text-text-faint" />
            <StaleBadge iso={snapshot.generated_at} />
          </div>
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Entscheidungsunterstützung anhand deines eigenen Regelwerks, kein Handelssignal und keine Anlageberatung.
      </p>
    </div>
  );
}
