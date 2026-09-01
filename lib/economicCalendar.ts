// Statische, regelbasierte BTC-Einordnung je verfolgtem Wirtschaftsereignis
// (kein KI-Modell -- dieselbe Philosophie wie kurznotizInfo/exchangeDivergenceInfo
// in lib/panelInfo.ts). Die Termine selbst kommen aus economic_calendar_events
// (siehe Edge Function collect-economic-calendar), diese Texte beschreiben nur
// die allgemein bekannte, historisch beobachtete Wirkungsrichtung -- keine
// Prognose fuer den konkreten kommenden Termin.
export const ECONOMIC_EVENT_INTERPRETATION: Record<string, string> = {
  cpi: "Höher als erwartete CPI-Daten werden am Markt häufig als Signal für eine straffere Fed-Politik gelesen, was Risikoassets wie BTC tendenziell belastet — niedriger als erwartet wirkt oft umgekehrt. Kein Automatismus, keine Anlageberatung.",
  pce: "PCE ist der von der Fed selbst bevorzugte Inflationsmesswert und fließt direkt in ihre Zinsentscheide ein — die Marktreaktion verläuft tendenziell in dieselbe Richtung wie bei CPI. Kein Automatismus, keine Anlageberatung.",
  nfp: "Überraschend starke Beschäftigungsdaten werden oft als Argument für eine straffere Fed-Politik gelesen (belastend für Risikoassets), schwache Daten oft umgekehrt — die tatsächliche Reaktion hängt stark vom Gesamtkontext ab. Kein Automatismus, keine Anlageberatung.",
  fomc: "Der Zinsentscheid selbst und vor allem die begleitenden Aussagen zur weiteren Ausrichtung bewegen Risikoassets oft stärker als andere Einzeltermine — Überraschungen gegenüber den Markterwartungen lösen typischerweise die stärkste Reaktion aus. Kein Automatismus, keine Anlageberatung.",
};
