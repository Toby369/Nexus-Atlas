import { DASHBOARD_TILE_IDS } from "./dashboardTiles";

// Reiter-Navigation: pro Reiter sind nur die Kacheln EINES Themas sichtbar,
// der Rest ist ausgeblendet statt nur optisch getrennt. Ebene 1 (Lagebild mit
// Setup-/Regime-Score) steht fest oberhalb der Reiter, Ebene 2 steckt als
// Aufklapper in den Score-Karten -- die Reiter gruppieren also nur die
// Ebene-3-Kacheln thematisch (siehe NEXUS-STRUKTUR-KONZEPT).
export interface DashboardTabMeta {
  id: string;
  label: string;
  tileIds: string[];
}

export const DASHBOARD_TABS: DashboardTabMeta[] = [
  {
    id: "marktkontext",
    label: "Marktkontext",
    tileIds: [
      "market-context",
      "regime-matrix",
      "divergence-radar",
    ],
  },
  {
    id: "preis-orderflow-makro",
    label: "Preis, Orderflow & Makro",
    tileIds: [
      "oi-change",
      "funding-rate",
      "orderbook-walls",
      "leverage-map",
      "liquidations",
      "cycle-indicators",
      "economic-calendar",
      "etf-flow",
      "news-risk",
    ],
  },
  // Bewertende KI-Analysen und aktiv bediente Werkzeuge/Lernen in einem
  // Reiter -- nach dem Buendeln der wenig genutzten KI-Kacheln sind es nur
  // noch vier Kacheln (System-Briefing steht im Lagebild).
  {
    id: "ki-tools",
    label: "KI & Tools",
    tileIds: [
      "second-opinions",
      "signal-review",
      "youtube-monitor",
      "lernen",
    ],
  },
];

export const DEFAULT_DASHBOARD_TAB = DASHBOARD_TABS[0].id;

// Ehrlichkeits-/Vollstaendigkeits-Absicherung (gleiches Prinzip wie an
// anderen Stellen dieser Session): eine neue Kachel, die in
// lib/dashboardTiles.ts registriert, aber hier vergessen wird, wuerde sonst
// stillschweigend in KEINEM Tab mehr auftauchen. assertAllTilesAssigned()
// wirft in diesem Fall hart -- lieber ein sofortiger Fehler beim Start als
// eine verschwundene Kachel, die niemand bemerkt.
export function assertAllTilesAssigned(): void {
  const assigned = new Set(DASHBOARD_TABS.flatMap((tab) => tab.tileIds));
  const missing = DASHBOARD_TILE_IDS.filter((id) => !assigned.has(id));
  if (missing.length > 0) {
    throw new Error(
      `dashboardTabs: folgende Kacheln sind in keinem Tab zugeordnet: ${missing.join(", ")}`
    );
  }
  const duplicates = DASHBOARD_TABS.flatMap((tab) => tab.tileIds).filter(
    (id, idx, arr) => arr.indexOf(id) !== idx
  );
  if (duplicates.length > 0) {
    throw new Error(`dashboardTabs: folgende Kacheln sind in mehreren Tabs zugeordnet: ${duplicates.join(", ")}`);
  }
}

assertAllTilesAssigned();
