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
