// Trigger-Erkennung + Kontext-Builder fuer die Eskalation ("gezielte
// Eskalation" statt einer dauerhaften Mehrfach-Kachel): mehrere unabhaengige
// AI-Provider beurteilen dieselbe rohe Gesamteinschaetzung (14-Faktoren-
// Engine) -- aber NUR, wenn Nexus intern bereits einen Widerspruch erkannt
// hat (System-Briefing-Konfluenz-Check, Divergenz-Radar-Paar). Die
// Entscheidung "lohnt sich eine zweite
// Meinung" faellt kostenlos (reine DB-Reads). Der Report-Master-Trigger
// entfiel mit der Zusammenlegung von Master-Report und System-Briefing --
// dessen Widersprueche deckt der Konfluenz-Check ab.
//
// Der erste Trigger liest den Konfluenz-Check des aktuellen System-Briefing-
// Snapshots (enthaelt den Konsistenz-Check der frueheren Signal Engine) --
// das Briefing wird per Auto-Refresh regelmaessig neu generiert.
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

/**
 * Prueft die bestehenden Divergenz-/Konsistenz-Mechanismen auf
 * einen AKTUELL aktiven Treffer -- reine DB-Reads, kein AI-Aufruf, kostet
 * also nichts. Leeres Array = keine Eskalation gerechtfertigt.
 */
export async function detectEscalationTriggers(): Promise<EscalationTrigger[]> {
  const [briefing, radar] = await Promise.all([getLatestSystemBriefing(), buildDivergenceRadar()]);

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
