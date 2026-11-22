import type { RuleCheckResult } from "./ruleCheck";
import type { vetoSummary } from "./veto";

// Kopf-Zeile im Lagebild (Toby 25.10.2026): EIN Satz "was tue ich jetzt?".
// Ohne 4H-Ausbruch der Plan-Satz, sonst der Stand des Regelchecks; ein Veto
// oder eine Warnung wird angehaengt. Farbe: grau warten, gruen Setup steht,
// gelb Setup mit Warnung, rot Veto oder kein Trade.

export type HeadTone = "neutral" | "ok" | "warn" | "stop";

export function headActionLine(
  check: RuleCheckResult,
  veto: ReturnType<typeof vetoSummary>,
  plan: string | null
): { text: string; tone: HeadTone } {
  const base = check.side === null ? (plan ?? check.verdict.short) : check.verdict.short;
  if (veto.tone === "veto") return { text: `${base} · ${veto.short}`, tone: "stop" };
  if (check.verdict.tone === "trade") {
    return veto.tone === "warnung" ? { text: `${base} · ${veto.short}`, tone: "warn" } : { text: base, tone: "ok" };
  }
  return { text: base, tone: check.side !== null && check.verdict.tone === "stop" ? "stop" : "neutral" };
}

/**
 * Kopf-Zeile aus dem Setup-Rechner (Toby 22.11.2026): gleiche Aussage wie
 * die Setup-Karte im Reiter "Trade", damit oben nie etwas anderes steht.
 * Ohne Idee der Plan-Satz.
 */
export function headFromSetup(
  idea: { verdict: { tone: "trade" | "wait" | "watch" | "stop"; short: string }; halfSize: string[] } | undefined,
  plan: string | null
): { text: string; tone: HeadTone } {
  if (!idea) return { text: plan ?? "Keine eigenen Zeichnungen in der Nähe", tone: "neutral" };
  const half = idea.halfSize.length > 0 ? " · halbe Grösse" : "";
  switch (idea.verdict.tone) {
    case "trade":
      return { text: idea.verdict.short + half, tone: half ? "warn" : "ok" };
    case "stop":
      return { text: idea.verdict.short, tone: "stop" };
    case "watch":
      return { text: idea.verdict.short, tone: "warn" };
    default:
      return { text: idea.verdict.short, tone: "neutral" };
  }
}
