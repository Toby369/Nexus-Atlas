// Zentrale Registry der frei verschiebbaren/minimierbaren Dashboard-Kacheln
// (siehe components/DashboardLayout.tsx). HeroHeader (seit 13.09.2026 inkl.
// der vormaligen MarketStateCard, siehe dortiger Kommentar) und die
// Zeitraum-Auswahl sind bewusst NICHT Teil dieser Liste -- HeroHeader ist
// die fest platzierte Synthese ganz oben, die Zeitraum-Auswahl ist ein
// Steuerelement, keine Datenkachel. Aus demselben Grund seit 12.09.2026 auch
// der Setup-Score (ConfluenceScoreCard) nicht mehr Teil dieser Liste --
// Ebene-1-Bewertungen (siehe docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md)
// stehen fest oben, unabhaengig vom gewaehlten Tab, statt in einem Tab
// versteckt/verschiebbar zu sein. (Vorher fehlte "confluence-score" zudem in
// lib/dashboardTabs.ts DASHBOARD_TABS -- assertAllTilesAssigned() haette das
// beim naechsten Import hart zum Absturz gebracht.)
export interface DashboardTileMeta {
  id: string;
  title: string;
  // Ab lg: (3-spaltiges Grid, siehe DashboardLayout.tsx) spannt diese Kachel
  // alle 3 Spalten statt einer -- fuer "system-briefing" gesetzt (Fliesstext
  // aus vielen fusionierten Quellen waere in 1/3-Spalte zu eng). Ehemals auch
  // fuer "live-price" gesetzt (Preis+OI Change+Chart+Kurznotiz+OI-je-Boerse
  // in einer Kachel gebuendelt) -- Nutzer-Feedback 05.09.2026 ("kann noch
  // nicht alle Kacheln individuell Groesse einstellen und verschieben")
  // fuehrte dazu, diese 5 Abschnitte wieder in eigenstaendige Kacheln
  // aufzuteilen (siehe components/LivePriceDataProvider.tsx). Jede Kachel
  // ist jetzt selbst per Hoehen-Resize/Breiten-Buttons steuerbar, wodurch
  // das urspruengliche Problem (grosse leere Flaechen unter kuerzeren
  // Nachbarn in derselben Grid-Zeile) nicht mehr zwingend zurueckkehrt wie
  // vor der Buendelung. Ehemals auch fuer "institutional-playbook" gesetzt --
  // diese Kachel ist seit 20.09.2026 Bestandteil von "lernen" (Wissen-Tab,
  // eigenes Modul neben Welz/Salomon/Mein System, siehe
  // components/LernenDashboard.tsx), keine eigene Kachel mehr.
  fullWidth?: boolean;
  // Dashboard-Aufraeumung (22.09.2026, Nutzer-Feedback "zu viele Kacheln
  // unterschiedlicher Groessen"/Mockup-Vorschlag): "compact" markiert reine
  // Kennzahl-Kacheln (ein-zwei Zeilen, keine Listen/Charts), die
  // DashboardLayout.tsx in einer eigenen, einheitlich behandelten Reihe VOR
  // den Inhalts-Kacheln zeigt -- ohne Breiten-Regler, ohne freies Hoehen-
  // Resize (siehe dortiger Kommentar). Default "content" (unveraendertes
  // Verhalten), keine Kachel wird entfernt oder inhaltlich veraendert.
  size?: "compact" | "content";
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
  // fuer den weiterhin gemeinsamen State/Polling). Die vier reinen
  // Kennzahl-Kacheln davon sind seit 22.09.2026 "compact" (siehe Feld oben).
  { id: "btc-price", title: "BTC Preis", size: "compact" },
  { id: "oi-change", title: "OI Change", size: "compact" },
  { id: "funding-rate", title: "Funding Rate", size: "compact" },
  { id: "orderbook-walls", title: "Orderbuch-Wände", size: "compact" },
  { id: "divergence-radar", title: "Divergenz-Radar" },
  // "News-Einordnung (KI)" (vormals eigene Kachel) ist seit 20.09.2026 ein
  // aufklappbarer Abschnitt in "news-risk" (NewsRiskPanel.tsx) -- deckte
  // dieselben Schlagzeilen ab, keine eigene Kachel mehr.
  { id: "signal-engine", title: "Signal Engine (KI)" },
  { id: "signal-review", title: "Periodischer Rückblick (KI)" },
  { id: "escalation", title: "Eskalation: Zweitmeinungen (KI)" },
  { id: "trade-debate", title: "Trade-Debate (KI)" },
  { id: "custom-query", title: "Freie Anfrage (KI)" },
  { id: "youtube-monitor", title: "Krypto-YouTube-Monitor (KI)" },
  // Umsetzungsplan Phase 4 (18.09.2026): fusioniert Regelwerk+Salomon+alle
  // berechneten Nexus-Faktoren zu einer Synthese -- fullWidth, da der
  // Fliesstext aus vielen fusionierten Quellen in einer 1/3-Spalte zu eng
  // waere.
  { id: "system-briefing", title: "System-Briefing: Regelwerk & Nexus-Faktoren (KI)", fullWidth: true },
  { id: "liquidations", title: "Liquidationen" },
  { id: "etf-flow", title: "ETF-Flows & Makro" },
  { id: "news-risk", title: "News & Risiko" },
  // "Institutional Playbook" (vormals eigene Kachel) ist seit 20.09.2026 ein
  // Modul im "Wissen"-Tab der "lernen"-Kachel (neben Welz/Salomon/Mein
  // System) -- reines statisches Nachschlagewerk ohne Live-Daten, passt
  // inhaltlich besser zur Lernen-Kachel als zu den KI-Einschaetzungen.
  //
  // "Positionierung" (vormals eigene Kachel, PositioningPanel.tsx) ist seit
  // 21.09.2026 entfernt (Nutzer-Wunsch) -- der zugrundeliegende
  // "Positionierung"-Faktor bleibt unveraendert Teil der 14-Faktoren-Engine
  // und wird weiterhin in HeroHeader angezeigt, nur die eigenstaendige
  // Detail-Kachel (Retail-/Top-Trader-Ratios je Boerse, Taker-Flow,
  // regelbasierte Einschaetzung) faellt weg.
];

export const DASHBOARD_TILE_IDS = DASHBOARD_TILES.map((t) => t.id);
