import { nearestZones, planSentence, type ZoneLevel } from "./zones";

// Push nach dem System-Briefing (Toby 27.10.2026: "Text nicht verstaendlich").
// Titel und Text baut Nexus selbst statt der KI: Kurs und Richtung im Titel,
// im Text die naechste Zone darueber und darunter plus der Plan-Satz wie im
// Dashboard. Ohne Kurs oder Zonen bleibt es bei Schlagzeile/Kernaussage.

const BIAS_LABEL: Record<string, string> = { bullish: "bullisch", bearish: "bärisch", neutral: "neutral" };

const fmt = (n: number) => n.toLocaleString("de-CH", { maximumFractionDigits: 0 });

export function buildBriefingPush(input: {
  kurs: number | null;
  levels: ZoneLevel[];
  bias: string;
  schlagzeile: string | null;
  kernaussage: string;
}): { title: string; body: string } {
  const { kurs, levels, bias } = input;
  const biasLabel = BIAS_LABEL[bias] ?? bias;
  const title = kurs !== null ? `BTC ${fmt(kurs)} · ${biasLabel}` : withBtcPrefix(input.schlagzeile);

  const plan = planSentence(levels, kurs);
  if (kurs === null || plan === null) return { title, body: input.kernaussage };

  const { above, below } = nearestZones(levels, kurs, 1);
  const lage =
    above[0] && below[0]
      ? `Kurs zwischen Unterstützung ${fmt(below[0].price)} und Widerstand ${fmt(above[0].price)}.`
      : above[0]
        ? `Kurs unter dem Widerstand ${fmt(above[0].price)}.`
        : `Kurs über der Unterstützung ${fmt(below[0].price)}.`;
  return { title, body: `${lage} ${plan}` };
}

/** "BTC · ..." ohne doppeltes BTC, wenn die Schlagzeile schon damit beginnt. */
export function withBtcPrefix(schlagzeile: string | null): string {
  if (!schlagzeile) return "NEXUS Atlas · System-Briefing";
  return /^BTC\b/i.test(schlagzeile) ? schlagzeile : `BTC · ${schlagzeile}`;
}
