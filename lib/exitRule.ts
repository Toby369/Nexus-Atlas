// Ausstiegsregel (Toby 22.11.2026). Anlass: ein guter Long am AVWAP wurde
// geschlossen, weil Nexus "Spot verkauft" (4H-Schnitt, 2 h alt) und
// "US-Anleger verkaufen" (Sonntag, ETF vom Donnerstag) zeigte. Danach stieg
// der Kurs um 3 %. Lehre: Anzeigen im Dashboard sind Hintergrund fuer die
// Groesse VOR dem Einstieg, kein Ausstiegsgrund.

export const EXIT_RULE_TITLE = "Offener Trade: raus nur nach Plan";

export const EXIT_RULE_POINTS = [
  "am Stop",
  "am Ziel (oder Teilausstieg und Trailing nach Plan)",
  "bei Invalidierung: eine Kerze der Einstiegs-Zeiteinheit schliesst zurück durch den Cluster bzw. die Zone",
];

export const EXIT_RULE_NOT =
  "Kein Ausstiegsgrund: eine Farbe oder Meldung im Dashboard (Spot, US-Anleger, Gesamtlage, Push). Sie zählt vor dem Einstieg für die Grösse.";

export const EXIT_RULE_TEXT = `${EXIT_RULE_TITLE}: ${EXIT_RULE_POINTS.join("; ")}. ${EXIT_RULE_NOT}`;
