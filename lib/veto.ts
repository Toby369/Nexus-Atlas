import { FUNDING_ELEVATED_PCT } from "./fundingLevels";
import { CROWD_HEAVY_LONG, CROWD_SHORT } from "./positioning";
import type { FlowDirection } from "./spotPerpFlow";
import type { Side } from "./ruleCheck";

// Veto vor dem Klick (Toby 22.10.2026): letzte Pruefung nach dem Regelcheck.
// Funding und Positionierung warnen nur gegen die ueberfuellte Seite
// (Regelwerk Punkt 5), Termine und Verluste sperren (Punkte 14/15:
// max. 3 Trades pro Tag, Pause nach 2 Verlusten in Folge).

export type VetoAnswer = "ok" | "warnung" | "veto" | "offen";

export interface VetoRow {
  id: "funding" | "crowd" | "driver" | "events" | "journal";
  question: string;
  answer: VetoAnswer;
  label: string;
  detail: string;
}

export interface VetoInput {
  side: Side | null;
  /** Funding in % pro 8 h. */
  fundingPct: number | null;
  /** Anteil Long-Konten 0..100. */
  crowdLongPct: number | null;
  spot: FlowDirection | null;
  perp: FlowDirection | null;
  driverLabel: string | null;
  /** Naechstes Hochrisiko-Zeitfenster innerhalb von 30 Min, z.B. "US-Kasseneröffnung in 12 Min". */
  upcomingRisk: string | null;
  tradesToday: number;
  lossesInRow: number;
}

export const MAX_TRADES_PER_DAY = 3;
export const MAX_LOSSES_IN_ROW = 2;

const fmt = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

export function evaluateVeto(input: VetoInput): VetoRow[] {
  const { side } = input;
  const rows: VetoRow[] = [];

  if (input.fundingPct === null) {
    rows.push({ id: "funding", question: "Funding normal?", answer: "offen", label: "—", detail: "Keine Funding-Daten." });
  } else {
    const f = input.fundingPct;
    const crowded =
      side === "long" ? f >= FUNDING_ELEVATED_PCT : side === "short" ? f <= -FUNDING_ELEVATED_PCT : Math.abs(f) >= FUNDING_ELEVATED_PCT;
    rows.push({
      id: "funding",
      question: `Funding normal (unter ${fmt(FUNDING_ELEVATED_PCT, 2)} % pro 8 h)?`,
      answer: crowded ? "warnung" : "ok",
      label: `${fmt(f, 3)} %`,
      detail: crowded ? "Überfüllte Seite: kleinere Position, enger managen." : "Kein Hebel-Überhang.",
    });
  }

  if (input.crowdLongPct === null) {
    rows.push({ id: "crowd", question: "Masse nicht einseitig positioniert?", answer: "offen", label: "—", detail: "Keine Positionierungsdaten." });
  } else {
    const c = input.crowdLongPct;
    const heavyLong = c >= CROWD_HEAVY_LONG * 100;
    const heavyShort = c < CROWD_SHORT * 100;
    const against = side === "long" ? heavyLong : side === "short" ? heavyShort : heavyLong || heavyShort;
    rows.push({
      id: "crowd",
      question: "Masse nicht einseitig positioniert?",
      answer: against ? "warnung" : "ok",
      label: `${fmt(c)} % long`,
      detail: against
        ? "Viele kleine Konten auf deiner Seite: Treibstoff für die Gegenbewegung."
        : "Übliche Verteilung der Konten.",
    });
  }

  if (input.spot === null || input.perp === null) {
    rows.push({ id: "driver", question: "Treibt Spot mit (nicht nur Perp)?", answer: "offen", label: "—", detail: "Noch keine Flow-Daten." });
  } else {
    const want: FlowDirection | null = side === "long" ? "up" : side === "short" ? "down" : null;
    let answer: VetoAnswer;
    if (want === null) answer = input.spot === "flat" && input.perp !== "flat" ? "warnung" : "ok";
    else answer = input.spot === want ? "ok" : "warnung";
    rows.push({
      id: "driver",
      question: "Treibt Spot mit (nicht nur Perp)?",
      answer,
      label: input.spot === "flat" ? (input.perp === "flat" ? "Niemand" : "Perp") : input.spot === "up" ? "Spot kauft" : "Spot verkauft",
      detail: input.driverLabel ?? "",
    });
  }

  rows.push({
    id: "events",
    question: "Kein Termin in den nächsten 30 Min?",
    answer: input.upcomingRisk ? "veto" : "ok",
    label: input.upcomingRisk ? "Termin" : "Frei",
    detail: input.upcomingRisk ? `${input.upcomingRisk}. Erst nach dem Termin und der ersten Reaktion.` : "Kein Hochrisiko-Fenster.",
  });

  const tooManyTrades = input.tradesToday >= MAX_TRADES_PER_DAY;
  const tooManyLosses = input.lossesInRow >= MAX_LOSSES_IN_ROW;
  rows.push({
    id: "journal",
    question: `Heute unter ${MAX_TRADES_PER_DAY} Trades und weniger als ${MAX_LOSSES_IN_ROW} Verluste in Folge?`,
    answer: tooManyTrades || tooManyLosses ? "veto" : "ok",
    label: `${input.tradesToday}/${MAX_TRADES_PER_DAY} · ${input.lossesInRow}/${MAX_LOSSES_IN_ROW}`,
    detail: tooManyLosses
      ? "Zwei Verluste in Folge: Schluss für heute."
      : tooManyTrades
        ? "Drei Trades erreicht: Schluss für heute."
        : "Trades und Verluste unten nachführen.",
  });

  return rows;
}

const SHORT_NAME: Record<VetoRow["id"], string> = {
  funding: "Funding",
  crowd: "Masse",
  driver: "Spot treibt nicht",
  events: "Termin",
  journal: "Tageslimit",
};

/** Eine Zeile fuer die eingeklappte Veto-Kachel. */
export function vetoSummary(rows: VetoRow[]): { tone: "ok" | "warnung" | "veto"; short: string } {
  const vetos = rows.filter((r) => r.answer === "veto");
  if (vetos.length > 0) {
    const ev = vetos.find((r) => r.id === "events");
    return { tone: "veto", short: `Veto: ${ev ? ev.detail.split(".")[0] : vetos.map((r) => SHORT_NAME[r.id]).join(", ")}` };
  }
  const warns = rows.filter((r) => r.answer === "warnung");
  if (warns.length > 0) return { tone: "warnung", short: `Warnung: ${warns.map((r) => SHORT_NAME[r.id]).join(", ")}` };
  return { tone: "ok", short: "Frei" };
}
