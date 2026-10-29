// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). Lagebild (HeroHeader, inkl. Setup-
// und Regime-Score) und Zeitraum-Auswahl gehoeren bewusst NICHT dazu: sie
// stehen fest oben, unabhaengig vom gewaehlten Reiter (Ebene 1, siehe
// docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md).
import { FUTURES_KEYS, ORDERBOOK_KEYS, POSITIONING_KEYS } from "./dataFreshness";
import { FUTURES_QUELLEN, Q, type Quelle } from "./quellen";

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
  // Woher die Zahlen kommen (lib/quellen.ts). DashboardLayout schreibt daraus
  // die Zeile "Daten: …" unter die Kachel (components/basis/Quellenhinweis).
  // Pflicht, damit keine Kachel ohne Herkunft erscheint (Test in
  // dashboardTiles.test.ts); leer nur bei der Lern-Kachel.
  herkunft: Quelle[];
}

export const DASHBOARD_TILES: DashboardTileMeta[] = [
  // 22.10.2026 (Toby): Gesamteinschaetzung, Scores, MTF und KI-Bericht aus dem
  // Lagebild hierher verschoben (HeroHeader variant="hintergrund").
  {
    id: "lage-hintergrund",
    title: "Hintergrund: Scores & KI-Bericht",
    fullWidth: true,
    quellen: ["market_state", "regime_matrix", "briefing"],
    herkunft: [...FUTURES_QUELLEN, Q.nexus, Q.ki],
  },
  {
    id: "market-context",
    title: "Marktkontext",
    quellen: [...FUTURES_KEYS, "spot_binance", "spot_volume"],
    herkunft: [Q.binanceSpot, ...FUTURES_QUELLEN, Q.nexus],
  },
  { id: "regime-matrix", title: "Marktphase", quellen: ["regime_matrix", "candles_1h"], herkunft: [Q.binance, Q.nexus] },
  { id: "lernen", title: "Lernen", herkunft: [] },
  { id: "cycle-indicators", title: "Zyklus-Indikatoren", quellen: ["candles_1d"], herkunft: [Q.binance, Q.nexus] },
  { id: "economic-calendar", title: "Wirtschaftskalender", quellen: ["calendar"], herkunft: [Q.fred, Q.fed] },
  // Gemeinsamer State/Polling der Preis-Kacheln: LivePriceDataProvider.tsx.
  { id: "oi-change", title: "OI Change", size: "compact", quellen: FUTURES_KEYS, herkunft: FUTURES_QUELLEN },
  {
    id: "funding-rate",
    title: "Funding Rate",
    size: "compact",
    quellen: [...FUTURES_KEYS, ...POSITIONING_KEYS],
    herkunft: FUTURES_QUELLEN,
  },
  {
    id: "orderbook-walls",
    title: "Orderbuch-Wände",
    size: "compact",
    quellen: ORDERBOOK_KEYS,
    herkunft: [Q.binance, Q.bybit, Q.okx],
  },
  // Ersatz fuer die Gamma-Lage (GEX) aus Orderflow-Setups, siehe
  // lib/volatilityContext.ts.
  { id: "volatility", title: "Volatilitäts-Lage", quellen: ["candles_1h", "options"], herkunft: [Q.deribit, Q.binance] },
  {
    id: "divergence-radar",
    title: "Divergenz-Radar",
    quellen: ["divergence_radar"],
    herkunft: [Q.binance, Q.binanceSpot, Q.bgeometrics, Q.nexus],
  },
  // Der Konsistenz-Check der frueheren Signal Engine steckt im System-
  // Briefing (Lagebild).
  { id: "signal-review", title: "Periodischer Rückblick (KI)", herkunft: [Q.nexus, Q.ki] },
  // Buendelt Eskalation + Trade-Debate. Das System-Briefing steht im
  // Lagebild (HeroHeader), nicht als eigene Kachel.
  { id: "second-opinions", title: "Zweitmeinungen (KI)", herkunft: [Q.ki] },
  { id: "youtube-monitor", title: "Krypto-YouTube-Monitor (KI)", herkunft: [Q.youtube, Q.ki] },
  {
    id: "etf-flow",
    title: "ETF-Flows & Makro",
    quellen: ["etf", "macro", "term_basis"],
    herkunft: [Q.sosovalue, Q.yahoo, Q.fred, Q.deribit],
  },
  { id: "news-risk", title: "News & Risiko", quellen: ["news"], herkunft: [Q.news, Q.nexus] },
  // 25.10.2026 (Toby): Hebelkarte "kann weit hinten" -- letzte Kachel im Archiv.
  { id: "leverage-map", title: "Liquidations-/Hebelkarte", quellen: ["candles_1h"], herkunft: [Q.binance, Q.nexus] },
  // Das Institutional Playbook ist ein Modul im Wissen-Tab der Lernen-Seite.
  // Der Positionierung-Faktor bleibt Teil der 14-Faktoren-Engine (Lagebild),
  // hat aber keine eigene Detail-Kachel mehr.
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
