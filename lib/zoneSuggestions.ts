import type { Candle } from "./candles";
import { computeZoneHistory, type ZoneTimeframe } from "./zoneHistory";
import { ENTRY_LEVEL_TOLERANCE_PCT } from "./tpStandard";
import { ganzzahlCh } from "./zahlCh";
import { zoneHigh, zoneLow, type ZoneLevel } from "./zones";

// Zonen mit Gedaechtnis, Phase 5 (docs/research/ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md):
// Nexus-Keylevels als Abgleich. Vorgeschlagen werden nur gedrehte Levels
// (bestaetigter Bruch, danach mindestens ein Retest), die bei keiner eigenen
// Zone liegen -- hoechstens eines ueber und eines unter dem Kurs. Nexus
// zeichnet nichts selbst; Toby entscheidet, ob er die Zone in AutarkTrade
// uebernimmt. Gleiche Regeln wie die eigenen Zonen (lib/zoneHistory.ts).

export interface NexusLevelInput {
  price: number;
  /** Zeitrahmen der Pivots im Level ("1h" | "4h" | "1d" | "1w"). */
  timeframes: string[];
}

export interface ZoneSuggestion {
  price: number;
  tf: ZoneTimeframe;
  /** R = ueber dem Kurs, S = darunter (Rolle nach dem Drehen). */
  role: "R" | "S";
  breakAt: string;
  retests: number;
}

const TF_RANK: Record<string, number> = { "1h": 1, "4h": 2, "1d": 3, "1w": 3 };
const TF_TEXT: Record<ZoneTimeframe, string> = { "1h": "1h", "4h": "4h", "1d": "1D" };

/** Hoechste Zeiteinheit der Pivots; 1W wird auf Tageskerzen ausgewertet. */
export function levelTimeframe(timeframes: string[]): ZoneTimeframe | null {
  const best = timeframes.filter((t) => t in TF_RANK).sort((a, b) => TF_RANK[b] - TF_RANK[a])[0];
  return best === undefined ? null : best === "1w" ? "1d" : (best as ZoneTimeframe);
}

/** Liegt das Level bei einer eigenen Zone (Kanten ±0,25 %, wie das Retest-Band)? */
function nearOwnZone(price: number, own: ZoneLevel[]): boolean {
  const tol = ENTRY_LEVEL_TOLERANCE_PCT / 100;
  return own.some((z) => zoneLow(z) * (1 - tol) <= price && price <= zoneHigh(z) * (1 + tol));
}

export function suggestMissingZones(
  levels: NexusLevelInput[],
  own: ZoneLevel[],
  candles: Partial<Record<ZoneTimeframe, Candle[]>>,
  price: number | null
): { above: ZoneSuggestion | null; below: ZoneSuggestion | null } {
  const out: { above: ZoneSuggestion | null; below: ZoneSuggestion | null } = { above: null, below: null };
  if (price === null || price <= 0) return out;
  for (const l of levels) {
    const tf = levelTimeframe(l.timeframes);
    const c = tf ? candles[tf] : undefined;
    if (!tf || !c || c.length === 0 || nearOwnZone(l.price, own)) continue;
    const h = computeZoneHistory(c, l.price, l.price, tf);
    // Letzter bestaetigter Bruch und die Retests danach.
    let breakAt: string | null = null;
    let retests = 0;
    for (const e of h.events) {
      if (e.kind === "bruch") {
        breakAt = e.time;
        retests = 0;
      } else if (breakAt && e.kind === "beruehrung") retests++;
    }
    if (!breakAt || retests === 0 || !h.side) continue;
    // Rolle aus der Lage nach dem Drehen; muss zur Lage zum aktuellen Kurs passen.
    const role = h.side === "below" ? "R" : "S";
    if ((role === "R") !== (l.price > price)) continue;
    const s: ZoneSuggestion = { price: l.price, tf, role, breakAt, retests };
    const slot = role === "R" ? "above" : "below";
    const cur = out[slot];
    if (!cur || Math.abs(l.price - price) < Math.abs(cur.price - price)) out[slot] = s;
  }
  return out;
}

const dayFmt = new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });

/** Kurzzeile, z. B. "R 61’956 · 4h · Bruch 18.11. · 2× Retest". */
export function suggestionText(s: ZoneSuggestion): string {
  return `${s.role} ${ganzzahlCh(s.price)} · ${TF_TEXT[s.tf]} · Bruch ${dayFmt.format(new Date(s.breakAt))} · ${s.retests}× Retest`;
}
