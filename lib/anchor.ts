// Event-Driven-Anker (Phase 1 "Anchored Analytics", siehe Feasibility-
// Review vom 29.08.2026): ergaenzt die festen Timeframes (lib/timeframes.ts)
// um einen frei waehlbaren Zeitpunkt, ab dem Liquidationen/OI/Preis
// kumuliert werden (get_anchored_summary-RPC). Bewusst ein eigener,
// unabhaengiger URL-Parameter statt eine Erweiterung von TimeframeId --
// ein Anker ersetzt die festen Zeitraeume nicht, sondern ist eine
// zusaetzliche, davon unabhaengige Betrachtung.
export const ANCHOR_PARAM = "anchor";

// Parst den rohen "anchor"-URL-Query-Param sicher zu einem Date -- null bei
// fehlendem/ungueltigem Wert ODER wenn der Wert in der Zukunft liegt. Ein
// Anker in der Zukunft haette keine sinnvolle Bedeutung fuer
// get_anchored_summary (die RPC wuerde nicht ablehnen, sondern einfach die
// gesamte verfuegbare Historie zurueckliefern -- das saehe fuer den Nutzer
// wie ein stiller Fehler aus statt einer klaren Ablehnung, deshalb wird das
// hier bereits an der Parse-Stelle abgefangen).
export function parseAnchorParam(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > Date.now()) return null;
  return parsed;
}

// Badge-Text exakt wie in der Aufgabenstellung vorgegeben: "Anchored to:
// YYYY-MM-DD HH:mm UTC".
export function formatAnchorBadge(date: Date): string {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split("T");
  return `Anchored to: ${datePart} ${timePart.slice(0, 5)} UTC`;
}

// Formatiert einen Anker fuer ein <input type="datetime-local">-Feld
// ("YYYY-MM-DDTHH:mm"). Der Picker wird bewusst als UTC behandelt (nicht
// als Browser-Lokalzeit) -- ein <input type="datetime-local"> traegt selbst
// keine Zeitzoneninfo; das Feld wird im UI explizit als "UTC" beschriftet,
// und der eingegebene Wert wird 1:1 als UTC interpretiert (siehe
// parseAnchorInputValue), statt ihn ueber new Date() als Browser-Lokalzeit
// misszuverstehen.
export function formatAnchorInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

// Kehrt formatAnchorInputValue um: interpretiert den <input>-Rohwert
// ("YYYY-MM-DDTHH:mm", ohne Zeitzone) explizit als UTC.
export function parseAnchorInputValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
