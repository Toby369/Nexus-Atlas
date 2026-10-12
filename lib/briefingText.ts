// Trennt den Kernsatz (ersten Satz) eines Briefing-Abschnitts vom Rest, damit
// Lagebild und E-Mail ihn fett setzen koennen -- wie die fetten Einstiegssaetze
// eines Marktbericht-Newsletters. Dezimalpunkte ("1.2 %") brechen nicht, weil
// nach ihnen kein Leerzeichen folgt; uebliche Abkuerzungen ("286 Mio. USD")
// werden uebersprungen.
const ABBREVIATIONS = new Set(["mio", "mrd", "ca", "bzw", "z.b", "u.a", "inkl", "evtl", "nr", "vs", "usw", "d.h"]);

export function splitLeadSentence(text: string): { lead: string; rest: string } {
  // Manche Modelle setzen den Kernsatz trotz Vorgabe selbst in **...** --
  // die Anzeige fettet ihn ohnehin, die Sternchen wuerden roh erscheinen.
  const trimmed = text.replace(/\*\*/g, "").trim();
  const boundary = /[.!?](\s+)/g;
  for (let match = boundary.exec(trimmed); match; match = boundary.exec(trimmed)) {
    const wordBefore = /([\p{L}.]+)$/u.exec(trimmed.slice(0, match.index))?.[1]?.toLowerCase() ?? "";
    if (trimmed[match.index] === "." && ABBREVIATIONS.has(wordBefore)) continue;
    const end = match.index + 1;
    return { lead: trimmed.slice(0, end), rest: trimmed.slice(end).trim() };
  }
  return { lead: trimmed, rest: "" };
}
