// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). MarketStateCard und die Zeitraum-
// Auswahl sind bewusst NICHT Teil dieser Liste -- MarketStateCard ist die
// fest platzierte Synthese ganz oben, die Zeitraum-Auswahl ist ein
// Steuerelement, keine Datenkachel.
export interface DashboardTileMeta {
  id: string;
  title: string;
  // Ab lg: (3-spaltiges Grid, siehe DashboardLayout.tsx) spannt diese Kachel
  // alle 3 Spalten statt einer -- fuer "live-price" gesetzt, weil sie Preis,
  // OI Change, Chart, Kurznotiz UND OI-je-Boerse buendelt und dadurch weit
  // hoeher ist als jede andere Kachel: ohne volle Breite haette ihre Zeile
  // die Grid-Zeilenhoehe der kompletten Zeile diktiert und riesige leere
  // Flaechen unter den kuerzeren Nachbarn erzeugt (Nutzer-Report 01.09.2026:
  // "kacheln bis weiter an rand. und ordnung!").
  fullWidth?: boolean;
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  { id: "market-context", title: "Marktkontext" },
  { id: "regime-matrix", title: "Marktphase" },
  { id: "handelslage", title: "Handelslage" },
  { id: "lernen", title: "Lernen" },
  { id: "leverage-map", title: "Liquidations-/Hebelkarte" },
  { id: "cycle-indicators", title: "Zyklus-Indikatoren" },
  // Bewusst als drittes Element platziert (nicht ans Ende): fuellt genau die
  // Luecke, die die vollbreite "live-price"-Kachel direkt danach in Zeile 1,
  // Spalte 3 sonst leer laesst (siehe fullWidth-Kommentar oben).
  { id: "economic-calendar", title: "Wirtschaftskalender" },
  { id: "live-price", title: "Preis & Open Interest", fullWidth: true },
  { id: "spot-pressure", title: "Spot Pressure" },
  { id: "positioning", title: "Positionierung" },
  { id: "liquidations", title: "Liquidationen" },
  { id: "etf-flow", title: "ETF-Flows & Makro" },
  { id: "news-risk", title: "News & Risiko" },
  // fullWidth wie "live-price": drei Tabs mit mehreren Absaetzen je Tab
  // waeren in einer einzelnen 1/3-Spalte zu eng/hoch fuer die Zeilen-
  // Nachbarn (siehe fullWidth-Kommentar oben).
  { id: "institutional-playbook", title: "Institutional Playbook", fullWidth: true },
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
