# Ideen-Backlog

Lose Sammlung von Themen, die besprochen, aber bewusst noch nicht geplant oder
gebaut wurden — nur zum späteren Durchdenken. Kein Umsetzungsplan, keine
Priorisierung. Ein Eintrag wandert erst dann in einen echten Umsetzungsplan
(mit AskUserQuestion-Abstimmung wie sonst auch), wenn Toby ihn aktiv wieder
aufgreift.

## Liquidity Pools (ICT/SMC-Sinn)

**Datum:** 20.09.2026

**Kontext:** Im Rahmen einer Frage zu Order-Book-Imbalance und Liquidity-Pools
eingeordnet — Order-Book-Imbalance ist in Nexus bereits abgedeckt (Kachel
"Orderbuch-Wände", `orderbook`-Faktor in der 14-Faktoren-Engine, CVD-Orderbook-
Divergenzpaar im Divergenz-Radar), aber statistisch noch unbewiesen (0%
historische Coverage, CVD-Orderbook-Divergenz komplett im geschützten
Test-Zeitraum).

**Liquidity Pools fehlen dagegen komplett** — anderes Konzept als die
Orderbuch-Wände: keine sichtbaren Limit-Orders im Buch, sondern implizite
Stop-Loss-Cluster, die sich an Equal Highs/Lows, ungetesteten Swing-Punkten
oder Session-Hochs/-Tiefs ansammeln (der Markt "sucht" diese Liquidität
gezielt auf, bevor die eigentliche Bewegung kommt — Stop-Hunt/Liquidity-Grab).

Am nächsten kommt aktuell `lib/swingDetection.ts` (Swing-Hoch/-Tief-Erkennung,
genutzt für GUSS/VWAP-Vector) — erkennt Swing-Punkte, interpretiert sie aber
nicht als Liquiditäts-Ziel.

**Nächster Schritt, falls Toby das aufgreift:** gemeinsam besprechen, was genau
als "Pool" gelten soll (Equal Highs/Lows-Toleranz? Session-Grenzen? wie viele
Berührungen?), dann wie bisher: Plan abstimmen, erst danach bauen.

## Zeitraum-Selector + Event-Anker aufräumen

**Datum:** 22.09.2026

**Kontext:** Nach dem Bau der MTF-Ampel (15M/1H/4H/1D/1W-Trendrichtung als
Badge in der Marktphase-Kachel) kam die Idee auf, den globalen
Zeitraum-Selector + Event-Anker (aktuell ganz oben, vor der
Gesamteinschätzung, wirkt in ~10 Kacheln: HeroHeader, Marktkontext,
Marktphase "Seit Anker", Live-Preis/OI-Änderung, Liquidationen) komplett zu
entfernen, weil die Ampel jetzt einen Multi-Timeframe-Überblick liefert.

**Zurückgestellt, weil unterschiedliche Fragen:** Die Ampel zeigt eine feste
Momentaufnahme (Richtung je Zeitrahmen), der Zeitraum/Anker beantwortet
"wie stark hat sich X seit einem wählbaren Referenzpunkt verändert" — die
Ampel ersetzt das nicht.

**Ergebnis (30.09.2026):** Im Rahmen einer Kachel-Bestandsaufnahme erneut
aufgegriffen. Toby: "ich nutze es kaum, eher würde ich direkt fragen: mach
mir ein report welcher von x bis y geht" — der eigentliche Bedarf ist ein
Zeitraum-basierter Report (anderes Feature), nicht ein kumulatives "seit
Anker"-Badge neben dem Live-Wert. Event-Anker deshalb, anders als am
22.09.2026 empfohlen, KOMPLETT entfernt statt nur repositioniert: Picker-UI
(AnchorPicker/AnchorChartPicker), lib/anchor.ts, alle "Seit Anker"-Anzeigen
in BtcPriceCard/OiChangeCard/LiquidationPanel/RegimeMatrixCard, sowie der
AnchoredSummary-Typ. Der Zeitraum-Selector (TimeframeSelector) bleibt
unveraendert bestehen -- das war nie Teil des Entfernungswunschs. Die
get_anchored_summary-RPC in der DB wurde bewusst NICHT gedroppt (gleiche
Vorsicht wie bei anderen DB-Loeschungen: Code ist jederzeit rueckgaengig
zu machen, ein DB-Objekt-Drop nicht ohne Weiteres) -- bei Bedarf spaeter
separat aufraeumen.

Ein zeitraum-basierter Report ("von X bis Y") ist damit als NEUE, separate
Idee im Backlog offen, falls Toby das aufgreifen will -- vermutlich am
ehesten eine Erweiterung der bestehenden Report Engine (`/reports`) um
einen frei waehlbaren Start/Ende statt nur "timeframe" (4H/1D/...).

## OI/Preis-Quadrant: zwei unabhaengige Berechnungen derselben Taxonomie

**Datum:** 10.10.2026

**Kontext:** Im Rahmen einer Redundanz-Audit-Recherche (Toby: "haben wir zu
viele differenzierte Metriken?") aufgefallen: Die Regime-Matrix
(`lib/marketRegime.ts`, `oi_price_quadrant`, Teil der 5-Saeulen-Engine) und
die Marktkontext-Kachel (`lib/marketContext.ts::classifyMarketContext`)
klassifizieren BEIDE dieselben vier Kategorien (long_buildup/short_buildup/
short_covering/long_unwind) aus Preis x Open-Interest-Richtung -- mit
unterschiedlichen Formeln/Schwellen, auf zwei verschiedenen Kacheln
(RegimeMatrixCard vs. MarketContextCard). Anders als bei CVD-Footprint vs.
dem `cvd`-Faktor oder VWAP-Vector vs. TradingView-VWAP-Stretch (beide
bereits im Code/PanelInfo explizit als "verwandt, aber methodisch anders"
gekennzeichnet) ist dieses Paar bisher NIRGENDS dokumentiert oder
gegeneinander abgeglichen -- einziger durch die Audit-Recherche gefundener,
bislang unadressierter Fall.

**Naechster Schritt, falls Toby das aufgreift:** gemeinsam entscheiden, ob
(a) eine der beiden Berechnungen entfaellt und durch die andere ersetzt
wird, (b) beide bleiben, aber mit derselben expliziten "koennen
unterschiedlich ausfallen, weil..."-Kennzeichnung wie bei den anderen
beiden Faellen versehen werden, oder (c) ein Divergenz-Radar-Paar dafuer
ergaenzt wird (gleiche Machart wie `computeSystemBriefingVsStateDivergence`).

**Ergebnis (10.10.2026):** Methodik beider Berechnungen verglichen:

| | Regime-Matrix (`oi_price_quadrant`) | Marktkontext (`classifyMarketContext`) |
|---|---|---|
| Ort | DB-Funktion `compute_market_state_matrix_series` | `lib/marketContext.ts` (Frontend) |
| Zeitfenster | fest 6h (6 x 1h-Kerzen) | gewaehlter Zeitraum (15M ... 1M) |
| Preis | Binance-1h-Schlusskurs | Bybit `last_price` |
| OI | nur Binance | aggregiert ueber alle Boersen |
| Flat-Schwelle | keine (reines Vorzeichen) | 0.4% x sqrt(Minuten/60), bei 6h ~0.98% |
| Zusatz | -- | Spot-Bestaetigung, Datenqualitaets-Sperren |

Echtdaten der letzten 30 Tage (719 Stundenwerte): die Regime-Matrix lieferte
**kein einziges Mal** "neutral"; mit den Marktkontext-Schwellen bei 6h waeren
~88% der Werte "Keine klare Struktur" gewesen. Die beiden Kacheln
widersprechen sich also die meiste Zeit -- nicht wegen eines Fehlers, sondern
weil die Regime-Matrix die Richtung zeigt und der Marktkontext nur
bedeutsame Bewegungen einordnet.

Umgesetzt: **Variante (b)** -- beide PanelInfo-Texte (`marktkontextInfo`,
`REGIME_MATRIX_METRIC_INFO.oiPriceQuadrant`) tragen jetzt dieselbe
"verwandt, aber methodisch anders"-Kennzeichnung wie die beiden anderen
Faelle, inkl. Hinweis auf die fehlende Mindestschwelle im Quadranten;
Querverweis-Kommentare in `lib/marketRegime.ts` und `lib/marketContext.ts`.
Nebenbei korrigiert: `marktkontextInfo` sagte "wenn weder Preis noch OI
einen Mindestschwellenwert ueberschreiten" -- tatsaechlich reicht es, wenn
EINER der beiden darunter bleibt.

**Weiterhin offen (Entscheidung Toby):** Variante (a)-light -- dem
DB-Quadranten eine Flat-Schwelle geben (z.B. dieselbe ~0.98% fuer 6h), damit
"neutral" wieder vorkommt. Aendert eine DB-Funktion der Regime-Engine und
alle historischen Matrix-Zeilen (Research-Ergebnisse der Phase 1 nutzen den
Quadranten), deshalb bewusst nicht ohne Freigabe umgesetzt.

## "Ueberzeugungsgrad"-Label fuer vier unabhaengige KI-Einschaetzungen

**Datum:** 10.10.2026

**Kontext:** Nach der Umbenennung von "Confidence" zu "Ueberzeugungsgrad"
(09./10.10.2026, siehe Commit-Historie) im Rahmen derselben Redundanz-
Audit-Recherche aufgefallen: Der neue Begriff steht jetzt identisch auf
VIER Kacheln (System-Briefing, Master-Report, die 3 Report-Engine-Slots,
YouTube-Gesamtanalyse) fuer vier methodisch unabhaengige KI-Aufrufe mit
jeweils eigenem Kontext -- kein Rechenfehler, aber derselbe Oberflaechen-
Effekt, der die juengste Verwirrung ausloeste ("sind das nicht dieselben
Zahlen?"), nur unter neuem Namen statt "Confidence".

**Naechster Schritt, falls Toby das aufgreift:** Label pro Kachel
disambiguieren (z.B. "System-Briefing-Ueberzeugungsgrad",
"Master-Report-Ueberzeugungsgrad"), damit auf einen Blick klar ist, dass es
vier getrennte Zahlen sind, keine vier Messungen derselben Sache.

## MTF-Ampel ohne Divergenz-Check gegen die Gesamteinschaetzung

**Datum:** 10.10.2026

**Kontext:** Toby beobachtete eine "Bullish"-Headline (14-Faktoren-Engine,
Verlaesslichkeit nur 36/100) neben einer MTF-Ampel, die nur 1 von 5
Zeitrahmen gruen zeigte. Recherche ergab: `overall_state` (Headline) und
die MTF-Ampel (`lib/mtfSignal.ts`) sind zwei bewusst unabhaengige Engines
(dokumentiert in `docs/research/METHODIC_DIVERGENCE_2026-08-29.md`,
Abschnitt 7 "Offene Fragen" -- dort bereits als offener Punkt genannt:
"Sollte computeEngineDivergence MTF-Alignment als dritte Vergleichsgroesse
einbeziehen? Aktuell bewusst nicht umgesetzt."). Anders als die
Divergenz-Paare 14-Faktoren-vs-System-Briefing und Master-Report-vs-
beide-Engines (beide bereits mit Warn-Hinweis versehen) hat die MTF-Ampel
selbst noch KEINEN Abgleich gegen die Gesamteinschaetzung.

**Naechster Schritt, falls Toby das aufgreift:** ein weiteres
Divergenz-Radar-Paar (oder eine Erweiterung von `computeEngineDivergence`)
analog zu den bestehenden, das warnt, wenn `overall_state` stark
gerichtet ist, aber die MTF-Ampel ueberwiegend widerspricht.
