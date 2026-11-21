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
  const name = `Zone ${range} (${tf}${zone.label ? ` · ${zone.label}` : ""})`;
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
    const close = `${tf}-Schluss ${fmt(e.decidedClose)} ${where} der Zone`;
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
