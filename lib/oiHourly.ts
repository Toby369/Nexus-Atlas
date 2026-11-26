// OI je Stunde (Toby 26.11.2026): zweite Balkenzeile unter dem Spot-Druck.
// Quelle: RPC get_oi_hourly (letzter OI-Wert je Boerse und Stunde,
// Aenderung gegen die Vorstunde). Blau = OI steigt (Hebel kommt rein),
// grau = OI faellt (Hebel geht raus). Rot/Gruen bleibt Kaufen/Verkaufen.

export interface OiHourRow {
  hour_start: string;
  change_pct: number | null;
}

export interface OiHourBar {
  startMs: number;
  changePct: number | null;
  complete: boolean;
}

/** Ab dieser Summe ueber die letzten 2 Stunden gibt es einen Hinweis. */
export const OI_NOTE_PCT = 1;

/** Auf dieselben Stunden wie die Spot-Balken legen (startMs-Liste). */
export function alignOiBars(rows: OiHourRow[], hourStarts: number[], nowMs: number): OiHourBar[] {
  const byHour = new Map(rows.map((r) => [Date.parse(r.hour_start), r.change_pct === null ? null : Number(r.change_pct)]));
  const currentStart = Math.floor(nowMs / 3_600_000) * 3_600_000;
  return hourStarts.map((startMs) => ({ startMs, changePct: byHour.get(startMs) ?? null, complete: startMs < currentStart }));
}

/** "Hebel abgebaut −1,2 % (2 h)" bzw. "Hebel baut auf +1,1 % (2 h)", sonst null. */
export function oiNote(bars: OiHourBar[]): { text: string; tone: "out" | "in" } | null {
  const last2 = bars.slice(-2).map((b) => b.changePct);
  if (last2.length < 2 || last2.some((v) => v === null)) return null;
  const sum = (last2 as number[]).reduce((s, v) => s + v, 0);
  const v = Math.abs(sum).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (sum <= -OI_NOTE_PCT) return { text: `Hebel abgebaut −${v} % (2 h)`, tone: "out" };
  if (sum >= OI_NOTE_PCT) return { text: `Hebel baut auf +${v} % (2 h)`, tone: "in" };
  return null;
}
