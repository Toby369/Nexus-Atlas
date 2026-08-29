// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). MarketStateCard und die Zeitraum-
// Auswahl sind bewusst NICHT Teil dieser Liste -- MarketStateCard ist die
// fest platzierte Synthese ganz oben, die Zeitraum-Auswahl ist ein
// Steuerelement, keine Datenkachel.
export interface DashboardTileMeta {
  id: string;
  title: string;
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  { id: "market-context", title: "Marktkontext" },
  { id: "regime-matrix", title: "Market State Matrix" },
  { id: "live-price", title: "Live-Preis & Open Interest" },
  { id: "spot-pressure", title: "Spot Pressure" },
  { id: "positioning", title: "Positionierung" },
  { id: "liquidations", title: "Liquidationen" },
  { id: "etf-flow", title: "ETF Flows" },
  { id: "news-risk", title: "News & Risiko" },
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
