// Trigger-Erkennung + Kontext-Builder fuer die Eskalations-Kachel (Thema
// KI, "gezielte Eskalation" statt einer dauerhaften 2-4-fach-Kachel,
// 05.09.2026): mehrere unabhaengige AI-Provider bekommen unabhaengig
// voneinander dieselbe rohe Gesamteinschaetzung (14-Faktoren-Engine) zur
// Beurteilung -- aber NUR, wenn Nexus intern bereits eine Divergenz/einen
// Widerspruch erkannt hat (System-Briefing-Inkonsistenz, Divergenz-Radar-
// Paar, Report-Master-Konflikt). Ohne aktiven Trigger keine Mehrfach-
// Anfrage -- dieselbe Kosten-Zurueckhaltung wie bei den anderen KI-
// Kacheln, nur eine Stufe davor: hier wird bereits die Entscheidung "lohnt
// sich ueberhaupt eine zweite Meinung" kostenlos (reine DB-Reads)
// getroffen.
//
// 02.10.2026 -- der erste Trigger las zuvor einen separaten
// signal_engine_snapshots-Eintrag (eigene "Signal-Engine"-Kachel, seither
// entfernt, siehe lib/signalEngineContext.ts). Liest jetzt stattdessen den
// kontextCheck-Abschnitt des aktuellen System-Briefing-Snapshots -- dort
// ist der Konsistenz-Check (plus alle anderen Kontext-Widersprueche)
// seither Teil derselben Synthese. Zuverlaessiger als vorher: System-
// Briefing wird per Auto-Refresh regelmaessig neu generiert, die alte
// Signal-Engine-Kachel wurde laut Audit 13 Tage lang nicht manuell
// ausgeloest.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { buildSignalEngineContext, type SignalEngineContext } from "./signalEngineContext";
import { buildDivergenceRadar, type DivergenceRadarResult } from "./divergenceRadarContext";
import type { EscalationTriggerRecord, SystemBriefingSnapshot } from "./types";

// Reports laufen zeitgesteuert (pg_cron) und ein manuell generierter
// Snapshot kann Stunden alt sein -- ohne Frische-Grenze wuerde ein einmal
// aufgetretener, laengst ueberholter Widerspruch die Eskalation dauerhaft
// "aktiv" halten.
const TRIGGER_FRESHNESS_HOURS = 24;

const DIVERGENCE_RADAR_LABELS: Partial<Record<keyof DivergenceRadarResult, string>> = {
  optionsVsSentiment: "Options-Skew vs. Sentiment",
  spotVsFutures: "Spot-Pressure vs. Futures-CVD",
  cycleVsMomentum: "Zyklus-Band vs. kurzfristiges Momentum",
  systemBriefingVsState: "System-Briefing-KI-Bias vs. Gesamtzustand",
  tradingViewVsState: "TradingView-Signal vs. Gesamtzustand",
};

export type EscalationTrigger = EscalationTriggerRecord;

function isFresh(iso: string): boolean {
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs <= TRIGGER_FRESHNESS_HOURS * 60 * 60 * 1000;
}

async function getLatestSystemBriefing(): Promise<SystemBriefingSnapshot | null> {
  const { data, error } = await supabase
    .from("system_briefings")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("escalationContext: Fehler bei system_briefings:", error.message);
    return null;
  }
  return data;
}

interface MasterReportRow {
  generated_at: string;
  status: "ok" | "error";
  result: { overallBias?: unknown; conflicts?: unknown } | null;
}

async function getLatestMasterReportRun(): Promise<MasterReportRow | null> {
  const { data, error } = await supabase
    .from("report_runs")
    .select("generated_at, status, result")
    .eq("report_type", "master")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("escalationContext: Fehler bei report_runs (master):", error.message);
    return null;
  }
  return data;
}

/**
 * Prueft die drei bereits bestehenden Divergenz-/Konsistenz-Mechanismen auf
 * einen AKTUELL aktiven Treffer -- reine DB-Reads, kein AI-Aufruf, kostet
 * also nichts. Leeres Array = keine Eskalation gerechtfertigt.
 */
export async function detectEscalationTriggers(): Promise<EscalationTrigger[]> {
  const [briefing, radar, masterRun] = await Promise.all([
    getLatestSystemBriefing(),
    buildDivergenceRadar(),
    getLatestMasterReportRun(),
  ]);

  const triggers: EscalationTrigger[] = [];

  if (
    briefing?.status === "ok" &&
    !!briefing.result?.konfluenzCheck &&
    isFresh(briefing.generated_at)
  ) {
    triggers.push({
      source: "system-briefing",
      label: "System-Briefing meldet einen Widerspruch (Konfluenz-Check)",
      detail: [briefing.result.konfluenzCheck],
    });
  }

  const divergentPairs = (Object.keys(DIVERGENCE_RADAR_LABELS) as (keyof DivergenceRadarResult)[])
    .filter((key) => radar[key] === "DIVERGENCE")
    .map((key) => DIVERGENCE_RADAR_LABELS[key]!);
  if (divergentPairs.length > 0) {
    triggers.push({
      source: "divergence-radar",
      label: "Divergenz-Radar zeigt mindestens ein divergentes Paar",
      detail: divergentPairs,
    });
  }

  if (
    masterRun?.status === "ok" &&
    masterRun.result?.overallBias === "conflicting" &&
    isFresh(masterRun.generated_at)
  ) {
    triggers.push({
      source: "report-master",
      label: "Report-Master (Report 4) meldet widerspruechliche Einzelreports",
      detail: Array.isArray(masterRun.result.conflicts) ? (masterRun.result.conflicts as string[]) : [],
    });
  }

  return triggers;
}

export interface EscalationContext {
  generated_at: string;
  trigger_reasons: EscalationTrigger[];
  market_state: SignalEngineContext;
}

/**
 * Liefert null, wenn (noch) keine Gesamteinschaetzung existiert -- dann gibt
 * es nichts, worauf sich mehrere Provider beziehen koennten.
 */
export async function buildEscalationContext(
  triggers: EscalationTrigger[]
): Promise<EscalationContext | null> {
  const marketState = await buildSignalEngineContext();
  if (!marketState) return null;

  return {
    generated_at: new Date().toISOString(),
    trigger_reasons: triggers,
    market_state: marketState,
  };
}
