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
//
// 12.09.2026 -- von 5 auf 3 Reiter konsolidiert (NEXUS-STRUKTUR-KONZEPT
// Abschnitt 3: "einheitlicher, leichter lesbar"). Urspruenglich als 1:1-
// Abbildung der 3 Ebenen (Bewertung/Signale im Detail/Beobachtung) geplant --
// bei der Umsetzung zeigte sich, dass Ebene 1 (Setup-Score, Gesamteinschaetzung,
// Gesamteinschaetzung-Score) ohnehin schon fest OBERHALB dieser Tabs sitzt
// (siehe app/page.tsx, lib/dashboardTiles.ts-Kommentar) und Ebene 2 keine
// eigenen Kacheln mehr hat (die validierten/unbestaetigten Signale stecken
// als Aufklapper IN der Setup-Score-Kachel, nicht in eigenen Tiles -- siehe
// GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md-Korrektur). Ein
// dritter, redundanter "Ebene 2"-Tab ohne eigenen Inhalt haette nur verwirrt.
// Die 3 Reiter gruppieren stattdessen die bestehenden Kacheln inhaltlich neu
// (statt 5 feinere Themen) -- weniger Klicks, gleiche Kacheln, kein
// Datenverlust.
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
      "handelslage",
      "spot-pressure",
      "divergence-radar",
      "kurznotiz",
      "positioning",
      "orderbook-walls",
    ],
  },
  {
    id: "preis-orderflow-makro",
    label: "Preis, Orderflow & Makro",
    tileIds: [
      "btc-price",
      "oi-change",
      "oi-by-exchange",
      "funding-rate",
      "leverage-map",
      "cycle-indicators",
      "economic-calendar",
      "etf-flow",
      "news-risk",
      "liquidations",
    ],
  },
  {
    id: "ki-lernen",
    label: "KI-Analysen & Lernen",
    tileIds: [
      "news-analysis",
      "signal-engine",
      "signal-review",
      "escalation",
      "trade-debate",
      "custom-query",
      "youtube-monitor",
      "institutional-playbook",
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
