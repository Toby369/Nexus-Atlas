import { DASHBOARD_TILE_IDS } from "./dashboardTiles";

// Tab-Navigation (09.09.2026, Nutzer-Feedback: "laptop ansicht von nexus zu
// unuebersichtlich" + Referenz-Screenshot eines anderen Trading-Journals mit
// fester Tab-Leiste oben). Loest das Problem staerker als eine reine
// Abschnitts-Gliederung auf einer einzigen langen Seite: pro Tab sind nur
// die Kacheln EINES Themas gleichzeitig sichtbar, der Rest ist ausgeblendet
// statt nur optisch getrennt.
//
// Ersetzt den bisherigen "Alle Details anzeigen"-Toggle (DetailsToggle) --
// die Tabs uebernehmen dessen Aufgabe (Standardansicht kompakt halten)
// gruendlicher, ein zusaetzlicher Klick zum Aufklappen ist damit nicht mehr
// noetig.
export interface DashboardTabMeta {
  id: string;
  label: string;
  tileIds: string[];
}

export const DASHBOARD_TABS: DashboardTabMeta[] = [
  {
    id: "uebersicht",
    label: "Übersicht",
    tileIds: [
      "market-context",
      "regime-matrix",
      "handelslage",
      "spot-pressure",
      "divergence-radar",
      "kurznotiz",
    ],
  },
  {
    id: "preis-orderflow",
    label: "Preis & Orderflow",
    tileIds: ["btc-price", "oi-change", "oi-by-exchange", "funding-rate", "orderbook-walls"],
  },
  {
    id: "ki-analysen",
    label: "KI-Analysen",
    tileIds: [
      "news-analysis",
      "signal-engine",
      "signal-review",
      "escalation",
      "trade-debate",
      "custom-query",
      "youtube-monitor",
    ],
  },
  {
    id: "makro-risiko",
    label: "Makro & Risiko",
    tileIds: [
      "positioning",
      "liquidations",
      "etf-flow",
      "news-risk",
      "economic-calendar",
      "institutional-playbook",
    ],
  },
  {
    id: "zyklus-lernen",
    label: "Zyklus & Lernen",
    tileIds: ["cycle-indicators", "leverage-map", "lernen"],
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
