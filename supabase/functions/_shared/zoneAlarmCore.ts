// Zonen mit Gedaechtnis, Phase 4: Ergebnis-Alarme (Toby 21.11.2026: nur
// Ergebnis, nur gedrehte Zonen; Annaeherung und Eintritt meldet AutarkTrade).
// Reines TypeScript ohne Laufzeit-Imports, genutzt von send-state-change-push
// und getestet in lib/zoneAlarm.test.ts.
//
// Ein Alarm entsteht fuer jedes Ereignis NACH dem ersten bestaetigten Bruch
// einer Zone (die Zone ist dann gebrochen bzw. gedreht), sobald der Schluss
// der Zeiteinheit es entschieden hat:
// - Beruehrung von der neuen Seite = "Retest abgelehnt" (Schluss blieb auf der neuen Seite)
// - Fehlausbruch = kurz zurueck ueber/unter die Zone, wieder abgelehnt
// - weiterer Bruch = "akzeptiert": die Zone ist zurueckerobert, Rolle wieder getauscht

import type { ZoneHistory, ZoneTimeframe } from "./zoneHistoryCore.ts";

export interface ZoneAlarm {
  /** Eindeutig je Zone und Ereignis, fuer die Dedupe ueber push_messages.details. */
  key: string;
  title: string;
  body: string;
  details: string[];
}

const TF_TEXT: Record<ZoneTimeframe, string> = { "1h": "1h", "4h": "4h", "1d": "1D" };
/** Ganzzahl mit Schweizer Tausender-Apostroph (’), unabhaengig von der ICU-Version (Node/Deno). */
const fmt = (n: number) => {
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, "’")}`;
};
const dayFmt = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });
const day = (iso: string) => dayFmt.format(new Date(iso));
const clockFmt = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Zurich" });
const TF_MS: Record<ZoneTimeframe, number> = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
/** Schlusszeit der entscheidenden Kerze, z.B. "21.11. 15:00" (Zürcher Zeit). */
const closeStamp = (openIso: string, tf: ZoneTimeframe) => {
  const d = new Date(new Date(openIso).getTime() + TF_MS[tf]);
  return `${day(d.toISOString())} ${clockFmt.format(d)}`;
};

/**
 * Alarme fuer Ereignisse, die mit einer Kerze ab `sinceIso` (Kerzenbeginn)
 * entschieden wurden. Nur Ereignisse nach dem ersten Bruch.
 */
export function zoneAlarms(
  h: ZoneHistory,
  zone: { low: number; high: number; label: string | null },
  sinceIso: string
): ZoneAlarm[] {
  const lo = Math.min(zone.low, zone.high);
  const hi = Math.max(zone.low, zone.high);
  const tf = TF_TEXT[h.tf];
  const range = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  // Das Label aus AutarkTrade beginnt oft mit der Zeiteinheit ("1h, retestzone"): nicht doppelt nennen.
  const label = (zone.label ?? "").replace(new RegExp(`^${tf}\\b[\\s,·:-]*`, "i"), "").trim();
  const name = `Zone ${range} (${tf}${label ? ` · ${label}` : ""})`;
  const sinceMs = new Date(sinceIso).getTime();
  const out: ZoneAlarm[] = [];
  let lastBreak: string | null = null;
  let retests = 0;
  for (const e of h.events) {
    const afterBreak = lastBreak !== null;
    const fresh = new Date(e.decidedAt).getTime() >= sinceMs;
    // Seite nach dem Ereignis: bei Bruch getauscht, sonst unveraendert.
    const sideAfter = e.kind === "bruch" ? (e.side === "above" ? "below" : "above") : e.side;
    const role = sideAfter === "above" ? "S" : "R";
    const where = sideAfter === "above" ? "über" : "unter";
    const close = `${tf}-Schluss ${fmt(e.decidedClose)} ${where} der Zone (${closeStamp(e.decidedAt, h.tf)})`;
    if (e.kind === "beruehrung" && afterBreak) retests++;
    if (afterBreak && fresh) {
      const key = `zone:${lo}-${hi}:${h.tf}:${e.kind}:${e.time}`;
      if (e.kind === "beruehrung") {
        out.push({
          key,
          title: `${name}: Retest ${e.near ? "knapp " : ""}abgelehnt`,
          body: `${close}. Seit Bruch ${day(lastBreak!)} jetzt ${role} (${retests}. Retest).`,
          details: [key, `Bruch: ${day(lastBreak!)}`, `Retest: ${day(e.time)}${e.near ? " (knapp, bis 0,25 ATR davor)" : ""}`],
        });
      } else if (e.kind === "fehlausbruch") {
        out.push({
          key,
          title: `${name}: Fehlausbruch`,
          body: `Kurz ${sideAfter === "above" ? "unter" : "über"} der Zone, ${close}. Weiter ${role}.`,
          details: [key, `Bruch: ${day(lastBreak!)}`, `Fehlausbruch: ${day(e.time)}`],
        });
      } else {
        out.push({
          key,
          title: `${name}: akzeptiert`,
          body: `Bruch bestätigt, ${close}. Jetzt wieder ${role}.`,
          details: [key, `Vorheriger Bruch: ${day(lastBreak!)}`, `Neuer Bruch: ${day(e.time)}`],
        });
      }
    }
    if (e.kind === "bruch") {
      lastBreak = e.time;
      retests = 0;
    }
  }
  return out;
}

/**
 * Alarme fuer den Push: wie zoneAlarms, aber
 * - ohne Ereignisse, die schon vor dem Anlegen der Zone entschieden waren
 *   (sonst wuerde eine neue Zone ihre ganze juengste Vorgeschichte nachliefern), und
 * - nur das juengste Ereignis je Zone: ein aelteres ist dann ueberholt
 *   (z.B. "Retest abgelehnt" um 12 Uhr, "akzeptiert" um 13 Uhr).
 * Wiederholte Laeufe liefern dieselbe Auswahl, daher bleibt die Dedupe ueber `key` stabil.
 */
export function zoneAlarmsForPush(
  h: ZoneHistory,
  zone: { low: number; high: number; label: string | null },
  sinceIso: string,
  createdAtIso: string | null
): ZoneAlarm[] {
  const createdMs = createdAtIso ? new Date(createdAtIso).getTime() : null;
  const fresh = zoneAlarms(h, zone, sinceIso).filter((a) => {
    if (createdMs === null) return true;
    // key endet auf ":<Ereigniszeit>" (ISO enthaelt selbst Doppelpunkte), daher ueber die Ereignisliste suchen.
    const ev = h.events.find((e) => a.key.endsWith(`:${e.kind}:${e.time}`));
    return !ev || new Date(ev.decidedAt).getTime() + TF_MS[h.tf] > createdMs;
  });
  return fresh.slice(-1);
}
