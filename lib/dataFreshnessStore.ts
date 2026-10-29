import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import type { FreshnessData } from "@/lib/dataFreshness";

// Ein gemeinsamer Abruf von get_data_freshness() fuer Ampel und alle
// Kachelkoepfe einer Seite -- nicht je Kachel ein eigener. Jeder Abruf ist
// ein Eintrag in Supabases Log-Ingestion (1-GB-Kontingent, siehe
// docs/research/LOG-INGESTION-PLAN_2026-10-12.md), deshalb:
//   - nur alle 5 Min (die schnellsten Sammler laufen auch nur alle 5 Min),
//   - nur solange etwas angezeigt wird (Zaehler der Abonnenten),
//   - nicht bei verstecktem Tab; beim Zurueckkehren sofort, falls faellig.
// Dazwischen tickt nur die Uhr (jede Minute), damit "vor X Min" mitlaeuft.

const FETCH_INTERVAL_MS = 5 * 60_000;
const TICK_MS = 60_000;

export interface FreshnessSnapshot {
  data: FreshnessData | null;
  nowMs: number;
  /** Letzter Abruf fehlgeschlagen (Netz/RPC) -- die Daten sind dann vom Abruf davor. */
  fetchFailed: boolean;
}

// Server und erster Client-Render sehen dasselbe (nichts), keine
// Hydration-Abweichung -- der erste Abruf startet erst im Effekt.
const SERVER_SNAPSHOT: FreshnessSnapshot = { data: null, nowMs: 0, fetchFailed: false };

let snapshot: FreshnessSnapshot = SERVER_SNAPSHOT;
let lastFetchMs = 0;
let inFlight = false;
let fetchTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<FreshnessSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

async function fetchNow() {
  if (inFlight) return;
  inFlight = true;
  lastFetchMs = Date.now();
  const { data, error } = await supabase.rpc("get_data_freshness");
  inFlight = false;
  if (error) {
    console.error("Fehler beim Laden des Datenstands:", error.message);
    emit({ fetchFailed: true, nowMs: Date.now() });
    return;
  }
  emit({ data: (data as FreshnessData | null) ?? {}, fetchFailed: false, nowMs: Date.now() });
}

function fetchIfDue() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastFetchMs >= FETCH_INTERVAL_MS) void fetchNow();
}

function onVisibility() {
  if (document.visibilityState !== "visible") return;
  emit({ nowMs: Date.now() });
  fetchIfDue();
}

function start() {
  fetchIfDue();
  fetchTimer = setInterval(fetchIfDue, FETCH_INTERVAL_MS);
  tickTimer = setInterval(() => {
    if (document.visibilityState === "visible") emit({ nowMs: Date.now() });
  }, TICK_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stop() {
  if (fetchTimer) clearInterval(fetchTimer);
  if (tickTimer) clearInterval(tickTimer);
  fetchTimer = tickTimer = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function useDataFreshness(): FreshnessSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT
  );
}
