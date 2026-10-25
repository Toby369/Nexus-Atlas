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
  /** Feste Reihenfolge ohne Verschieben/Minimieren; Kacheln nicht in lib/dashboardTiles.ts. */
  fixed?: boolean;
}

// 25.10.2026 (Toby): Reiter nach der Frage, die er gerade stellt -- "Trade"
// (vor jedem Einstieg), "Markt" (warum bewegt sich der Kurs: OI, CVD, Spot
// Pressure, wer treibt, Funding, Hebel), "Termine", "Wochenblick" (langsame
// Daten) und "Archiv" (alles, was nicht zum Regelwerk gehoert). Hoechstens
// 5 Reiter, damit sie am Handy in eine Zeile passen.
export const DASHBOARD_TABS: DashboardTabMeta[] = [
  { id: "trade", label: "Trade", tileIds: ["zones", "rule-check", "veto"], fixed: true },
  { id: "markt", label: "Markt", tileIds: ["market-context", "oi-change", "funding-rate", "leverage-map"] },
  { id: "termine", label: "Termine", tileIds: ["economic-calendar", "news-risk"] },
  { id: "wochenblick", label: "Wochenblick", tileIds: ["etf-flow", "cycle-indicators"] },
  {
    id: "archiv",
    label: "Archiv",
    tileIds: [
      "lage-hintergrund",
      "regime-matrix",
      "divergence-radar",
      "volatility",
      "orderbook-walls",
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
  const assigned = new Set(DASHBOARD_TABS.filter((tab) => !tab.fixed).flatMap((tab) => tab.tileIds));
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
