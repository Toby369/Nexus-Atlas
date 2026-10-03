// Statische, regelbasierte BTC-Einordnung je verfolgtem Wirtschaftsereignis
// (kein KI-Modell -- dieselbe Philosophie wie exchangeDivergenceInfo in
// lib/panelInfo.ts). Die Termine selbst kommen aus economic_calendar_events
// (siehe Edge Function collect-economic-calendar), diese Texte beschreiben nur
// die allgemein bekannte, historisch beobachtete Wirkungsrichtung -- keine
// Prognose fuer den konkreten kommenden Termin.
export const ECONOMIC_EVENT_INTERPRETATION: Record<string, string> = {
  cpi: "Höher als erwartete CPI-Daten werden am Markt häufig als Signal für eine straffere Fed-Politik gelesen, was Risikoassets wie BTC tendenziell belastet — niedriger als erwartet wirkt oft umgekehrt. Kein Automatismus, keine Anlageberatung.",
  pce: "PCE ist der von der Fed selbst bevorzugte Inflationsmesswert und fließt direkt in ihre Zinsentscheide ein — die Marktreaktion verläuft tendenziell in dieselbe Richtung wie bei CPI. Kein Automatismus, keine Anlageberatung.",
  nfp: "Überraschend starke Beschäftigungsdaten werden oft als Argument für eine straffere Fed-Politik gelesen (belastend für Risikoassets), schwache Daten oft umgekehrt — die tatsächliche Reaktion hängt stark vom Gesamtkontext ab. Kein Automatismus, keine Anlageberatung.",
  fomc: "Der Zinsentscheid selbst und vor allem die begleitenden Aussagen zur weiteren Ausrichtung bewegen Risikoassets oft stärker als andere Einzeltermine — Überraschungen gegenüber den Markterwartungen lösen typischerweise die stärkste Reaktion aus. Kein Automatismus, keine Anlageberatung.",
};

// Pfeil/Farb-Logik (Nutzer-Wunsch 03.10.2026: "mit Pfeil Richtung und Farbe
// angezeigt werden was Resultat bedeuten würde") -- Quelle der Wahrheit fuer
// sowohl die Kachel (EconomicCalendarPanel) als auch die Push-Benachrichtigung
// (Supabase Edge Function send-state-change-push, die dieses Repo nicht
// importieren kann und die Logik daher dupliziert, siehe Kommentar dort).
// true = ein Anstieg gegenueber dem Vorwert gilt als baerisch fuer BTC (und
// ein Rueckgang damit als bullisch) -- fuer alle vier verfolgten Ereignisse
// dieselbe Grundaussage wie in ECONOMIC_EVENT_INTERPRETATION oben, hier nur
// als stures Flag statt Fliesstext.
export const EVENT_HIGHER_MEANS_BEARISH: Record<string, boolean> = {
  cpi: true,
  pce: true,
  nfp: true,
  fomc: true, // Zinserhöhung = bärisch, Zinssenkung = bullisch
};

// FRED-Serie je Ereignis in macro_snapshots (siehe collect-macro) -- liefert
// den tatsaechlich veroeffentlichten Wert fuer die "Resultat"-Anzeige, ohne
// eigenen neuen Collector.
export const EVENT_FRED_SYMBOL: Record<string, string> = {
  cpi: "CPIAUCSL",
  pce: "PCEPI",
  nfp: "PAYEMS",
  fomc: "DFF",
};

export type EconomicDirection = "up" | "down" | "flat";

export function economicDirectionMeaning(
  eventKey: string,
  direction: EconomicDirection
): { arrow: string; emoji: string; meaning: "bullisch" | "bärisch" | "neutral" } {
  if (direction === "flat") return { arrow: "→", emoji: "⚪", meaning: "neutral" };
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  const isBearish = direction === "up" ? bearishIfUp : !bearishIfUp;
  return {
    arrow: direction === "up" ? "↑" : "↓",
    emoji: isBearish ? "🔴" : "🟢",
    meaning: isBearish ? "bärisch" : "bullisch",
  };
}

// Allgemeine Legende (beide Richtungen) fuer die Vorwarnung, solange noch
// kein Resultat vorliegt.
export function economicDirectionLegend(eventKey: string): string {
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  return bearishIfUp
    ? "↑ höher als zuvor → 🔴 bärisch für BTC · ↓ niedriger → 🟢 bullisch für BTC"
    : "↑ höher als zuvor → 🟢 bullisch für BTC · ↓ niedriger → 🔴 bärisch für BTC";
}
