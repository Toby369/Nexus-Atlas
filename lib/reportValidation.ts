// Regelbasierte Post-Validation fuer AI-generierte Report-Texte (Phase 2,
// Punkt 1). Prueft Kernaussagen der "summary"/"keyFactors"-Felder GEGEN die
// tatsaechlichen Rohdaten, die dem Modell als Kontext mitgegeben wurden --
// z.B. behauptet der Text "Retail ueberwiegend short", aber
// global_long_account_ratio liegt ueber 50%, ist das ein Widerspruch.
//
// Bewusst rein regelbasiert (keine zweite AI-Anfrage): dieselbe Philosophie
// wie das bereits bestehende PromptProfile.validate() (Schema-Pruefung) --
// nur eine Ebene weiter, Inhalt statt Form. Ergaenzt validate(), ersetzt es
// nicht: validate() prueft "ist das JSON wohlgeformt", diese Datei prueft
// "stimmt der Text mit den Zahlen ueberein, die das Modell bekommen hat".
//
// Absichtlich konservativ: nur Aussagen, die eindeutig als Richtungsclaim
// erkennbar sind (z.B. "Retail... short"), werden geprueft. Uneindeutige
// oder nicht erkannte Formulierungen fuehren NICHT zu einem Fehlalarm --
// eine verpasste Pruefung ist besser als ein falsches FLAGGED_CONTRADICTION
// auf einen stilistisch anderen, aber inhaltlich korrekten Text.

export interface ReportValidationResult {
  status: "ok" | "flagged_contradiction";
  contradictions: string[];
}

function extractReportText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.summary === "string") parts.push(d.summary);
  if (Array.isArray(d.keyFactors)) parts.push(d.keyFactors.filter((k) => typeof k === "string").join(" "));
  if (Array.isArray(d.conflicts)) parts.push(d.conflicts.filter((c) => typeof c === "string").join(" "));
  if (typeof d.componentBiases === "object" && d.componentBiases !== null) {
    parts.push(Object.values(d.componentBiases as Record<string, unknown>).filter((v) => typeof v === "string").join(" "));
  }
  if (Array.isArray(d.items)) {
    for (const item of d.items) {
      if (typeof item === "object" && item !== null) {
        const i = item as Record<string, unknown>;
        if (typeof i.reasoning === "string") parts.push(i.reasoning);
        if (typeof i.headline === "string") parts.push(i.headline);
      }
    }
  }
  return parts.join(" ");
}

// "Retail [...] short" / "Retail [...] long" -- bis zu 60 Zeichen Abstand,
// damit z.B. "Retail-Positionierung ist klar short" noch erkannt wird, aber
// nicht zwei unabhaengige Saetze faelschlich verknuepft werden.
const RETAIL_DIRECTION_RE = /retail[^.!?]{0,60}?\b(short|long)\b/i;
const TOP_TRADER_DIRECTION_RE = /top[- ]trader[^.!?]{0,60}?\b(short|long)\b/i;
const FUNDING_POSITIVE_RE = /funding[^.!?]{0,40}?\b(positiv|negativ)\b/i;

function claimedDirection(text: string, re: RegExp): "short" | "long" | null {
  const match = text.match(re);
  if (!match) return null;
  return match[1].toLowerCase() as "short" | "long";
}

function claimedFundingSign(text: string): "positiv" | "negativ" | null {
  const match = text.match(FUNDING_POSITIVE_RE);
  if (!match) return null;
  return match[1].toLowerCase() as "positiv" | "negativ";
}

interface PositioningRatios {
  global_long_account_ratio: number | null;
  top_trader_long_account_ratio: number | null;
}

// Mittelwert ueber alle Boersen, die einen Wert liefern -- eine einzelne
// fehlende Boerse (haeufig, siehe reportContext.ts) darf die Pruefung nicht
// blockieren, aber mit ZU WENIG Boersen ist kein belastbarer Vergleich
// moeglich (return null statt eines aus 1 Wert "gemittelten" Werts waere
// hier bewusst uebertrieben streng; ein einzelner Wert ist noch aussagekraeftig
// genug fuer diese grobe Richtungspruefung).
function averageRatio(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/**
 * Prueft die "summary"/"keyFactors"/etc.-Textfelder eines AI-Report-Outputs
 * gegen die Rohdaten, die im selben Request-Kontext an das Modell gingen.
 * `context` ist die jeweilige sliceContextFor*()-Teilmenge aus
 * app/api/reports/run/route.ts -- diese Funktion greift ausschliesslich
 * ueber optionale Felder zu, ein Report-Typ ohne "positioning" o.ae.
 * ueberspringt die entsprechende Pruefung einfach (kein Fehlalarm).
 */
export function validateReportAgainstData(data: unknown, context: unknown): ReportValidationResult {
  const text = extractReportText(data);
  const contradictions: string[] = [];

  if (text.length === 0) {
    return { status: "ok", contradictions: [] };
  }

  const ctx = typeof context === "object" && context !== null ? (context as Record<string, unknown>) : {};
  const positioning = ctx.positioning as Record<string, PositioningRatios | null> | undefined;

  if (positioning) {
    const retailLong = averageRatio(
      Object.values(positioning)
        .filter((v): v is PositioningRatios => v !== null && typeof v === "object" && "global_long_account_ratio" in v)
        .map((v) => v.global_long_account_ratio)
    );
    const claimedRetail = claimedDirection(text, RETAIL_DIRECTION_RE);
    if (claimedRetail && retailLong !== null) {
      const actual = retailLong > 0.5 ? "long" : "short";
      if (actual !== claimedRetail) {
        contradictions.push(
          `Report behauptet "Retail ${claimedRetail}", aber global_long_account_ratio liegt im Schnitt bei ` +
            `${(retailLong * 100).toFixed(1)}% (tatsächlich ${actual}).`
        );
      }
    }

    const topTraderLong = averageRatio(
      Object.values(positioning)
        .filter((v): v is PositioningRatios => v !== null && typeof v === "object" && "top_trader_long_account_ratio" in v)
        .map((v) => v.top_trader_long_account_ratio)
    );
    const claimedTopTrader = claimedDirection(text, TOP_TRADER_DIRECTION_RE);
    if (claimedTopTrader && topTraderLong !== null) {
      const actual = topTraderLong > 0.5 ? "long" : "short";
      if (actual !== claimedTopTrader) {
        contradictions.push(
          `Report behauptet "Top Trader ${claimedTopTrader}", aber top_trader_long_account_ratio liegt im ` +
            `Schnitt bei ${(topTraderLong * 100).toFixed(1)}% (tatsächlich ${actual}).`
        );
      }
    }
  }

  const funding = ctx.funding as { avg_current_rate?: number | null } | undefined;
  const claimedFunding = claimedFundingSign(text);
  if (funding && claimedFunding && typeof funding.avg_current_rate === "number") {
    const actual = funding.avg_current_rate >= 0 ? "positiv" : "negativ";
    if (actual !== claimedFunding) {
      contradictions.push(
        `Report behauptet Funding "${claimedFunding}", aber avg_current_rate ist ` +
          `${(funding.avg_current_rate * 100).toFixed(4)}% (tatsächlich ${actual}).`
      );
    }
  }

  return {
    status: contradictions.length > 0 ? "flagged_contradiction" : "ok",
    contradictions,
  };
}
