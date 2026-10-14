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

**Erledigt (11.10.2026):** Variante (a) fuer die Anzeige -- Quadrant-Zeile aus der
Marktphase-Kachel entfernt, Marktkontext ist die einzige Anzeige; die DB-Spalte bleibt als
Forschungs-Input. Siehe `OI-PREIS-QUADRANT-VERGLEICH_2026-10-11.md`.

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

**Erledigt (11.10.2026):** Briefing-, Master-Report-, Report- und YouTube-Überzeugungsgrad
je Kachel benannt (auch in der Report-E-Mail).

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

**Erledigt (11.10.2026):** Warnung "Widerspruch zur MTF-Ampel" im Lagebild oben, sobald die
Gesamteinschaetzung eine Richtung zeigt und mindestens 3 von 5 Zeitrahmen dagegen stehen
(`lib/lagebild.ts::detectMtfStateConflict`, Schwelle `MTF_CONFLICT_MIN_OPPOSING`).

## structure_trend in market_features: Lookahead in der Historie

**Datum:** 14.10.2026

**Kontext:** Beim Orderflow-4-Schritte-Backtest gefunden
(`ORDERFLOW-4-SCHRITTE-PROTOCOL_2026-10-13.md`, Nachtrag 1).
`collect-candles::computeMarketStructure` trägt einen Fraktal-Swing bei Kerze j ein,
obwohl er erst nach Kerze j+5 feststeht. Weil jeder Lauf die letzten 250 Zeilen neu
schreibt, hat die gespeicherte Historie von `structure_trend` (und `swing_type`, `bos`,
`choch`) einen Blick von bis zu 5 Kerzen in die Zukunft. Auf 1h weichen 12 % der Kerzen
von der kausalen Version ab. Der Live-Wert der jüngsten Kerze ist korrekt.

**Betroffen:** jede Auswertung, die diese Spalten historisch nutzt (z. B. Confluence-
und Gesamteinschätzungs-Research, Rekonstruktion der Warn-Muster).

**Nächster Schritt, falls Toby das aufgreift:** Swing erst bei j+5 verarbeiten
(Referenz: `research-python/orderflow_4step/features.py::causal_structure_trend`),
Historie neu berechnen und prüfen, welche bisherigen Research-Ergebnisse sich ändern.
