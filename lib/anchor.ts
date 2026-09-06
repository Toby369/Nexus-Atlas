// Event-Driven-Anker (Phase 1 "Anchored Analytics", siehe Feasibility-
// Review vom 29.08.2026): ergaenzt die festen Timeframes (lib/timeframes.ts)
// um einen frei waehlbaren Zeitpunkt, ab dem Liquidationen/OI/Preis
// kumuliert werden (get_anchored_summary-RPC). Bewusst ein eigener,
// unabhaengiger URL-Parameter statt eine Erweiterung von TimeframeId --
// ein Anker ersetzt die festen Zeitraeume nicht, sondern ist eine
// zusaetzliche, davon unabhaengige Betrachtung.
export const ANCHOR_PARAM = "anchor";
// Optionales Ende eines Anker-ZEITRAUMS (statt "ab Anker bis jetzt") --
// Nutzer-Wunsch 06.09.2026: per Klick+Ziehen auf einem Kerzenchart einen
// festen Start+Ende waehlen, analog zu TradingViews "Fixed Range"-Tool.
// Fehlt dieser Param (haeufigster Fall, manueller Einzel-Anker), bleibt das
// bisherige Verhalten (Anker bis jetzt) unveraendert -- siehe
// get_anchored_summary/get_market_series (p_anchor_end/p_until, beide
// default null = "bis jetzt").
export const ANCHOR_END_PARAM = "anchorEnd";

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

function formatUtcMinute(date: Date): string {
  const [datePart, timePart] = date.toISOString().split("T");
  return `${datePart} ${timePart.slice(0, 5)}`;
}

// Badge fuer einen Anker-ZEITRAUM (Start+Ende, per Chart-Drag gewaehlt) --
// eigene Funktion statt formatAnchorBadge zu ueberladen, da die Bedeutung
// eine andere ist ("zwischen X und Y" statt "seit X bis jetzt").
export function formatAnchorRangeBadge(start: Date, end: Date): string {
  return `Anker: ${formatUtcMinute(start)} → ${formatUtcMinute(end)} UTC`;
}

// Parst das Ende eines Anker-Zeitraums: dieselben Regeln wie
// parseAnchorParam (kein ungueltiger/zukuenftiger Wert), zusaetzlich muss
// es NACH dem Start liegen -- ein Ende vor/gleich dem Start ist kein
// gueltiger Zeitraum und wird als "kein Ende gesetzt" behandelt (faellt auf
// das bisherige "bis jetzt"-Verhalten zurueck statt einen Fehler zu werfen).
export function parseAnchorEndParam(
  value: string | null | undefined,
  start: Date | null
): Date | null {
  if (!start) return null;
  const end = parseAnchorParam(value);
  if (!end) return null;
  if (end.getTime() <= start.getTime()) return null;
  return end;
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
