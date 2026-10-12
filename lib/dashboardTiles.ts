// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). Lagebild (HeroHeader, inkl. Setup-
// und Regime-Score) und Zeitraum-Auswahl gehoeren bewusst NICHT dazu: sie
// stehen fest oben, unabhaengig vom gewaehlten Reiter (Ebene 1, siehe
// docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md).
export interface DashboardTileMeta {
  id: string;
  title: string;
  // Ab lg: (3-spaltiges Grid, siehe DashboardLayout.tsx) spannt diese Kachel
  // alle 3 Spalten -- fuer Kacheln mit Fliesstext, der in einer 1/3-Spalte
  // zu eng waere.
  fullWidth?: boolean;
  // "compact" markiert reine Kennzahl-Kacheln (ein-zwei Zeilen, keine
  // Listen/Charts), die DashboardLayout.tsx in einer eigenen, einheitlichen
  // Reihe VOR den Inhalts-Kacheln zeigt -- ohne Breiten-Regler und ohne
  // freies Hoehen-Resize. Default "content".
  size?: "compact" | "content";
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  { id: "market-context", title: "Marktkontext" },
  { id: "regime-matrix", title: "Marktphase" },
  { id: "lernen", title: "Lernen" },
  { id: "leverage-map", title: "Liquidations-/Hebelkarte" },
  { id: "cycle-indicators", title: "Zyklus-Indikatoren" },
  { id: "economic-calendar", title: "Wirtschaftskalender" },
  // Gemeinsamer State/Polling der vier Preis-Kacheln: LivePriceDataProvider.tsx.
  { id: "btc-price", title: "BTC Preis", size: "compact" },
  { id: "oi-change", title: "OI Change", size: "compact" },
  { id: "funding-rate", title: "Funding Rate", size: "compact" },
  { id: "orderbook-walls", title: "Orderbuch-Wände", size: "compact" },
  { id: "divergence-radar", title: "Divergenz-Radar" },
  // Der Konsistenz-Check der frueheren Signal Engine steckt im System-
  // Briefing (Lagebild).
  { id: "signal-review", title: "Periodischer Rückblick (KI)" },
  // Buendelt Eskalation + Trade-Debate. Das System-Briefing steht im
  // Lagebild (HeroHeader), nicht als eigene Kachel.
  { id: "second-opinions", title: "Zweitmeinungen (KI)" },
  { id: "youtube-monitor", title: "Krypto-YouTube-Monitor (KI)" },
  { id: "liquidations", title: "Liquidationen" },
  { id: "etf-flow", title: "ETF-Flows & Makro" },
  { id: "news-risk", title: "News & Risiko" },
  // Das Institutional Playbook ist ein Modul im Wissen-Tab der Lernen-Seite.
  // Der Positionierung-Faktor bleibt Teil der 14-Faktoren-Engine (Lagebild),
  // hat aber keine eigene Detail-Kachel mehr.
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
