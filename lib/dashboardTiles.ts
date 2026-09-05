// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). MarketStateCard und die Zeitraum-
// Auswahl sind bewusst NICHT Teil dieser Liste -- MarketStateCard ist die
// fest platzierte Synthese ganz oben, die Zeitraum-Auswahl ist ein
// Steuerelement, keine Datenkachel.
export interface DashboardTileMeta {
  id: string;
  title: string;
  // Ab lg: (3-spaltiges Grid, siehe DashboardLayout.tsx) spannt diese Kachel
  // alle 3 Spalten statt einer -- fuer "institutional-playbook" gesetzt
  // (drei Tabs mit mehreren Absaetzen je Tab waeren in 1/3-Spalte zu eng).
  // Ehemals auch fuer "live-price" gesetzt (Preis+OI Change+Chart+Kurznotiz+
  // OI-je-Boerse in einer Kachel gebuendelt) -- Nutzer-Feedback 05.09.2026
  // ("kann noch nicht alle Kacheln individuell Groesse einstellen und
  // verschieben") fuehrte dazu, diese 5 Abschnitte wieder in eigenstaendige
  // Kacheln aufzuteilen (siehe components/LivePriceDataProvider.tsx). Jede
  // Kachel ist jetzt selbst per Hoehen-Resize/Breiten-Buttons steuerbar,
  // wodurch das urspruengliche Problem (grosse leere Flaechen unter
  // kuerzeren Nachbarn in derselben Grid-Zeile) nicht mehr zwingend
  // zurueckkehrt wie vor der Buendelung.
  fullWidth?: boolean;
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  { id: "market-context", title: "Marktkontext" },
  { id: "regime-matrix", title: "Marktphase" },
  { id: "handelslage", title: "Handelslage" },
  { id: "lernen", title: "Lernen" },
  { id: "leverage-map", title: "Liquidations-/Hebelkarte" },
  { id: "cycle-indicators", title: "Zyklus-Indikatoren" },
  { id: "economic-calendar", title: "Wirtschaftskalender" },
  // Vormals eine einzige fullWidth-Kachel "live-price" -- seit 05.09.2026
  // in 5 eigenstaendige, individuell verschieb-/groessenbare Kacheln
  // aufgeteilt (siehe fullWidth-Kommentar oben + LivePriceDataProvider.tsx
  // fuer den weiterhin gemeinsamen State/Polling).
  { id: "btc-price", title: "BTC Preis" },
  { id: "oi-change", title: "OI Change" },
  { id: "kurznotiz", title: "Kurznotiz (Gesamteinschätzung)" },
  { id: "oi-by-exchange", title: "OI je Börse" },
  { id: "funding-rate", title: "Funding Rate" },
  { id: "spot-pressure", title: "Spot Pressure" },
  { id: "orderbook-walls", title: "Orderbuch-Wände" },
  { id: "divergence-radar", title: "Divergenz-Radar" },
  { id: "news-analysis", title: "News-Einordnung (KI)" },
  { id: "signal-engine", title: "Signal Engine (KI)" },
  { id: "escalation", title: "Eskalation: Zweitmeinungen (KI)" },
  { id: "youtube-monitor", title: "Krypto-YouTube-Monitor (KI)" },
  { id: "positioning", title: "Positionierung" },
  { id: "liquidations", title: "Liquidationen" },
  { id: "etf-flow", title: "ETF-Flows & Makro" },
  { id: "news-risk", title: "News & Risiko" },
  { id: "institutional-playbook", title: "Institutional Playbook", fullWidth: true },
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
