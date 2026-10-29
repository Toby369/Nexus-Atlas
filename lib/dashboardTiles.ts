// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). Lagebild (HeroHeader, inkl. Setup-
// und Regime-Score) und Zeitraum-Auswahl gehoeren bewusst NICHT dazu: sie
// stehen fest oben, unabhaengig vom gewaehlten Reiter (Ebene 1, siehe
// docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md).
import { FUTURES_KEYS, ORDERBOOK_KEYS, POSITIONING_KEYS } from "./dataFreshness";

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
  // Datenquellen (Schluessel aus lib/dataFreshness.ts), deren Stand der
  // Kachelkopf zeigt ("vor 4 Min", gelb/rot bei Verspaetung). Fehlt bei
  // KI-Kacheln, die auf Knopfdruck oder woechentlich entstehen und ihren
  // Stand selbst anzeigen.
  quellen?: string[];
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  // 22.10.2026 (Toby): Gesamteinschaetzung, Scores, MTF und KI-Bericht aus dem
  // Lagebild hierher verschoben (HeroHeader variant="hintergrund").
  {
    id: "lage-hintergrund",
    title: "Hintergrund: Scores & KI-Bericht",
    fullWidth: true,
    quellen: ["market_state", "regime_matrix", "briefing"],
  },
  { id: "market-context", title: "Marktkontext", quellen: [...FUTURES_KEYS, "spot_binance", "spot_volume"] },
  { id: "regime-matrix", title: "Marktphase", quellen: ["regime_matrix", "candles_1h"] },
  { id: "lernen", title: "Lernen" },
  { id: "cycle-indicators", title: "Zyklus-Indikatoren", quellen: ["candles_1d"] },
  { id: "economic-calendar", title: "Wirtschaftskalender", quellen: ["calendar"] },
  // Gemeinsamer State/Polling der Preis-Kacheln: LivePriceDataProvider.tsx.
  { id: "oi-change", title: "OI Change", size: "compact", quellen: FUTURES_KEYS },
  { id: "funding-rate", title: "Funding Rate", size: "compact", quellen: [...FUTURES_KEYS, ...POSITIONING_KEYS] },
  { id: "orderbook-walls", title: "Orderbuch-Wände", size: "compact", quellen: ORDERBOOK_KEYS },
  // Ersatz fuer die Gamma-Lage (GEX) aus Orderflow-Setups, siehe
  // lib/volatilityContext.ts.
  { id: "volatility", title: "Volatilitäts-Lage", quellen: ["candles_1h", "options"] },
  { id: "divergence-radar", title: "Divergenz-Radar", quellen: ["divergence_radar"] },
  // Der Konsistenz-Check der frueheren Signal Engine steckt im System-
  // Briefing (Lagebild).
  { id: "signal-review", title: "Periodischer Rückblick (KI)" },
  // Buendelt Eskalation + Trade-Debate. Das System-Briefing steht im
  // Lagebild (HeroHeader), nicht als eigene Kachel.
  { id: "second-opinions", title: "Zweitmeinungen (KI)" },
  { id: "youtube-monitor", title: "Krypto-YouTube-Monitor (KI)" },
  { id: "etf-flow", title: "ETF-Flows & Makro", quellen: ["etf", "macro", "term_basis"] },
  { id: "news-risk", title: "News & Risiko", quellen: ["news"] },
  // 25.10.2026 (Toby): Hebelkarte "kann weit hinten" -- letzte Kachel im Archiv.
  { id: "leverage-map", title: "Liquidations-/Hebelkarte", quellen: ["candles_1h"] },
  // Das Institutional Playbook ist ein Modul im Wissen-Tab der Lernen-Seite.
  // Der Positionierung-Faktor bleibt Teil der 14-Faktoren-Engine (Lagebild),
  // hat aber keine eigene Detail-Kachel mehr.
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
