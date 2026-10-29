import { supabase } from "./supabase";
import type { ZoneLevel } from "./zones";

// Eigene Zonen (Toby 27.10.2026, Regel: "eigene Chart-Levels, Nexus als
// Abgleich"). Sobald mindestens eine eingetragen ist, rechnen Regelcheck,
// Plan-Satz, Kopf-Zeile und Briefing-Push damit statt mit den Nexus-Keylevels.
// Seit 29.10.2026 kommen sie aus AutarkTrade (source='autark', Sync alle
// 5 Min, Funktion replace_own_zones_from_autark); Handeingabe nur als Notloesung.

export interface OwnZone {
  id: number;
  price: number;
  low: number | null;
  high: number | null;
  label: string | null;
  source: "manual" | "autark" | string;
}

export interface AutarkSyncStatus {
  lastSyncAt: string | null;
  zoneCount: number | null;
}

/** Ohne Lebenszeichen des Syncs seit so vielen Minuten gelten die AutarkTrade-Zonen als veraltet. */
export const AUTARK_SYNC_STALE_MINUTES = 30;

const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export async function fetchOwnZones(): Promise<OwnZone[]> {
  const { data, error } = await supabase
    .from("own_zones")
    .select("id, price, price_low, price_high, label, source")
    .order("price", { ascending: false });
  if (error || !data) {
    if (error) console.error("Eigene Zonen: Fehler beim Laden:", error.message);
    return [];
  }
  return data.map((r) => ({
    id: Number(r.id),
    price: Number(r.price),
    low: num(r.price_low),
    high: num(r.price_high),
    label: typeof r.label === "string" && r.label.trim() ? r.label.trim() : null,
    source: (r.source as string) ?? "manual",
  }));
}

export async function fetchAutarkSyncStatus(): Promise<AutarkSyncStatus | null> {
  const { data, error } = await supabase
    .from("autark_sync_status")
    .select("last_sync_at, zone_count")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("AutarkTrade-Sync-Status: Fehler beim Laden:", error.message);
    return null;
  }
  return data ? { lastSyncAt: (data.last_sync_at as string | null) ?? null, zoneCount: num(data.zone_count) } : null;
}

export function isSyncStale(lastSyncAt: string | null, nowMs: number): boolean {
  if (!lastSyncAt) return true;
  return nowMs - new Date(lastSyncAt).getTime() > AUTARK_SYNC_STALE_MINUTES * 60 * 1000;
}

/** Eigene Zonen (mit Bereich und Name), falls vorhanden, sonst die Nexus-Keylevels. */
export function activeLevels(own: OwnZone[], nexus: { price: number }[]): ZoneLevel[] {
  return own.length > 0
    ? own.map(({ price, low, high, label }) => ({ price, low, high, label }))
    : nexus.map(({ price }) => ({ price }));
}
