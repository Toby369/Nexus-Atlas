import type { MarketState } from "./types";
import type { MtfTimeframeDot } from "./mtfSignal";

// Lagebild: reine Logik fuer den verdichteten Kopfbereich in
// HeroHeader.tsx -- Fazit-Satz, MTF-Widerspruchs-Warnung und die
// Regelbasiert, kein KI-Aufruf.

export interface MtfDirectionCounts {
  bullish: number;
  bearish: number;
  neutral: number;
  /** Davon erst in Trendbildung (ADX < 25), in bullish/bearish enthalten. */
  bullishForming: number;
  bearishForming: number;
}

function dotDirection(dot: MtfTimeframeDot): 1 | -1 | 0 {
  if (dot.status === "bullish_confirmed" || dot.status === "bullish_forming") return 1;
  if (dot.status === "bearish_confirmed" || dot.status === "bearish_forming") return -1;
  return 0;
}

export function countMtfDirections(dots: MtfTimeframeDot[]): MtfDirectionCounts {
  const counts = { bullish: 0, bearish: 0, neutral: 0, bullishForming: 0, bearishForming: 0 };
  for (const dot of dots) {
    if (dot.status === "bullish_forming") counts.bullishForming++;
    if (dot.status === "bearish_forming") counts.bearishForming++;
    const dir = dotDirection(dot);
    if (dir > 0) counts.bullish++;
    else if (dir < 0) counts.bearish++;
    else counts.neutral++;
  }
  return counts;
}

// MTF-Widerspruch: Warnung, sobald die Gesamteinschaetzung
// eine Richtung anzeigt, aber mindestens so viele Zeitrahmen in die
// Gegenrichtung zeigen. Bei unterdrueckter Richtung ("Unklar") gibt es
// nichts, dem widersprochen werden koennte.
export const MTF_CONFLICT_MIN_OPPOSING = 3;

export interface MtfStateConflict {
  direction: "bullish" | "bearish";
  opposing: number;
  total: number;
}

export function detectMtfStateConflict(
  overallState: MarketState["overall_state"],
  directionSuppressed: boolean,
  dots: MtfTimeframeDot[]
): MtfStateConflict | null {
  if (directionSuppressed) return null;
  if (overallState !== "BULLISH" && overallState !== "BEARISH") return null;
  const counts = countMtfDirections(dots);
  const opposing = overallState === "BULLISH" ? counts.bearish : counts.bullish;
  if (opposing < MTF_CONFLICT_MIN_OPPOSING) return null;
  return { direction: overallState === "BULLISH" ? "bullish" : "bearish", opposing, total: dots.length };
}

export function buildLagebildSentence(input: {
  overallState: MarketState["overall_state"];
  directionSuppressed: boolean;
  conflict: MtfStateConflict | null;
  dots: MtfTimeframeDot[];
}): string {
  const { overallState, directionSuppressed, conflict, dots } = input;

  let head: string;
  if (overallState === "INSUFFICIENT_DATA") head = "Zu wenige Daten für eine Einschätzung.";
  else if (directionSuppressed || overallState === "MIXED") head = "Keine klare Richtung.";
  else if (conflict) head = `Leicht ${conflict.direction === "bullish" ? "bullisch" : "bärisch"}, aber übergeordnet nicht bestätigt.`;
  else if (overallState === "BULLISH") head = "Bullisch.";
  else if (overallState === "BEARISH") head = "Bärisch.";
  else head = "Neutral.";

  // Kurzfristig = 15M+1H, uebergeordnet = 4H+1D (1W bewusst aussen vor,
  // reagiert zu traege fuer eine Tagesaussage).
  const byLabel = new Map(dots.map((d) => [d.timeframe, dotDirection(d)]));
  const sum = (labels: string[]) => labels.reduce((acc, l) => acc + (byLabel.get(l) ?? 0), 0);
  const shortTerm = sum(["15M", "1H"]);
  const higher = sum(["4H", "1D"]);
  let tf = "";
  if (shortTerm > 0 && higher < 0) tf = " Kurzfristig (15M/1H) bullisch, übergeordnet (4H/1D) bärisch.";
  else if (shortTerm < 0 && higher > 0) tf = " Kurzfristig (15M/1H) bärisch, übergeordnet (4H/1D) bullisch.";
  else if (shortTerm > 0 && higher > 0) tf = " Zeitrahmen bis 1D überwiegend bullisch.";
  else if (shortTerm < 0 && higher < 0) tf = " Zeitrahmen bis 1D überwiegend bärisch.";

  // Setup-/Regime-Score entfielen am 29.10.2026 (Toby, Speicherplatz).
  return head + tf;
}
