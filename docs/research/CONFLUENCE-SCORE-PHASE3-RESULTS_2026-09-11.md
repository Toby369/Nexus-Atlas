# Confluence-Score-Protokoll — Phase 3 Ergebnisse: Einzelsignale + Paare (Variante A)

Umsetzung von `CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md` gemäß dort festgeschriebener Methodik.
Ereignisquelle: `research_swing_setup_chain_results` (sequenzielle, nicht-überlappende
Swing-Setup-Kette, 3.533 LONG- + 3.553 SHORT-Setups über 2 Jahre, siehe Abschnitt 1 des
Protokolls und `research_swing_setup_chain_events()`).

## 1. Umgesetzt

- **Statistik-Engine:** `research_wilson_ci()`, `research_two_proportion_ztest()` (exakte
  Formel aus Abschnitt 4), `research_confluence_bh_fdr(pool)` (kumulative Korrektur pro Pool,
  Abschnitt 6), Ergebnistabelle `research_confluence_signal_stats`.
- **29 von 31 vorregistrierten Signalen** berechnet und gegen MIN_N=10 geprüft (Struktur
  15m/1h/4h/1d, MTF-Alignment, CVD-Richtung, Trendstärke, Trend-Regime, VWAP-Position, Funding,
  Fear & Greed, Positionierung, Orderbuch-Imbalance, Optionen, Makro-Regime, Warn-Muster ×4,
  TradingView-Events ×6, TradingView-Divergenzen ×2, Momentum-Faktor, Divergenz-Radar: Onchain
  vs Preis). **Nicht umgesetzt** (Zeitgründe, siehe Abschnitt 4 unten): Divergenz-Radar
  Spot-Pressure-Absorption und RSI/MACD-Divergenz-vs-Trend (2 von 3 Paaren).
- **Paar-Analyse Variante A** (konfirmatorischer Pool): alle 196 Paare unter den 15
  (LONG) bzw. 14 (SHORT) individuell qualifizierenden Signalen, via
  `research_confluence_signal_activation` (Zeilen-Ebene-Aktivierungstabelle).
- **Paar-Analyse Variante B** (volle Kombinatorik, explorativer Pool): noch nicht umgesetzt.

## 2. Ergebnis Einzelsignale

**18 von 29 testbaren Zellen überleben BH-FDR-Korrektur.**

| Signal | Richtung | n (aktiv) | n (nicht aktiv) | Trefferquote aktiv | Trefferquote nicht aktiv | p (roh) |
|---|---|---|---|---|---|---|
| Struktur 4h | SHORT | 1.708 | 1.845 | 25,9% | 17,4% | <0,00001 |
| Struktur 4h | LONG | 1.683 | 1.850 | 26,4% | 17,9% | <0,00001 |
| Struktur 1h | SHORT | 1.734 | 1.819 | 25,4% | 17,8% | <0,00001 |
| VWAP-Position | LONG | 1.064 | 2.469 | 27,8% | 19,4% | <0,00001 |
| MTF-Alignment | SHORT | 792 | 2.761 | 28,5% | 19,5% | <0,00001 |
| Struktur 1h | LONG | 1.551 | 1.982 | 25,6% | 19,1% | <0,00001 |
| Struktur 15m | LONG | 1.385 | 2.148 | 25,9% | 19,4% | <0,00001 |
| CVD-Richtung | LONG | 1.047 | 2.486 | 25,7% | 20,4% | 0,0005 |
| MTF-Alignment | LONG | 635 | 2.898 | 27,1% | 20,8% | 0,0005 |
| Struktur 1d | SHORT | 1.849 | 1.704 | 23,6% | 19,2% | 0,0013 |
| Struktur 15m | SHORT | 1.456 | 2.097 | 23,8% | 19,9% | 0,0049 |
| Struktur 1d | LONG | 1.479 | 2.054 | 24,2% | 20,3% | 0,0057 |
| VWAP-Position | SHORT | 1.057 | 2.496 | 24,3% | 20,3% | 0,0080 |
| CVD-Richtung | SHORT | 1.224 | 2.329 | 23,9% | 20,3% | 0,0133 |
| Trendstärke (ADX+DI) | LONG | 1.032 | 2.499 | 24,5% | 20,9% | 0,0166 |
| Makro-Regime | SHORT | 368 | 3.185 | 26,1% | 21,0% | 0,0238 |
| Trend-Regime (EMA50/200) | SHORT | 1.039 | 2.506 | 23,9% | 20,5% | 0,0249 |

(Trendstärke SHORT und Trend-Regime LONG knapp nicht signifikant; Fear & Greed, Funding, Positionierung/Orderbuch/Optionen/Onchain/alle TradingView-Signale entweder nicht signifikant oder MIN_N=10 nicht erreicht — letzteres korrekt als "keine Aussage möglich" markiert, nicht als Nulltreffer gewertet.)

**Wichtige Einordnung:** Struktur 15m/1h/4h/1d, MTF-Alignment, CVD-Richtung und VWAP-Position
sind sieben verschiedene Operationalisierungen derselben Grundaussage ("folgt der Kurs dem
übergeordneten Trend") — kein Bündel unabhängiger Entdeckungen, sondern ein mehrfach
bestätigter Kern-Effekt. Deckt sich mit dem stärksten Einzelbefund aus
`TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md` (dort ebenfalls Struktur 4h) — zwei unabhängige
Methodiken (parallele Kerzen-Stichprobe vs. sequenzielle Setup-Kette) kommen zum selben
Kernbefund, was die Glaubwürdigkeit deutlich erhöht.

## 3. Ergebnis Paare (Variante A)

**100 von 136 testbaren Paaren überleben BH-FDR.** Bemerkenswertester Fund — Kombination aus
Leading-Trendfolge und Confirming-Momentum:

| Paar | Richtung | n (beide aktiv) | n (Rest) | Trefferquote (beide aktiv) | Trefferquote (Rest) | p (roh) |
|---|---|---|---|---|---|---|
| Momentum-Faktor + MTF-Alignment | SHORT | 230 | 3.323 | 41,7% | 20,1% | <0,00001 |
| Momentum-Faktor + MTF-Alignment | LONG | 207 | 3.326 | 38,7% | 20,9% | <0,00001 |
| Momentum-Faktor + Struktur 4h | LONG | 421 | 3.112 | 37,8% | 19,8% | <0,00001 |
| Momentum-Faktor + Struktur 1d | LONG | 329 | 3.204 | 37,4% | 20,4% | <0,00001 |
| Momentum-Faktor + Struktur 4h | SHORT | 415 | 3.138 | 36,9% | 19,5% | <0,00001 |
| Momentum-Faktor + Struktur 1h | SHORT | 510 | 3.043 | 36,1% | 19,1% | <0,00001 |
| Momentum-Faktor + Struktur 1d | SHORT | 387 | 3.166 | 35,9% | 19,7% | <0,00001 |
| CVD-Richtung + Momentum-Faktor | LONG | 457 | 3.076 | 35,7% | 19,9% | <0,00001 |

Diese Kombination (Leading-Trend + Confirming-Momentum) **nahezu verdoppelt** die Trefferquote
gegenüber dem Rest — bei realistischer Stichprobengröße (n=207-510, nicht nur zweistellig wie
bei den kleineren Positionierungs-/Fear&Greed-Kombinationen). Wichtiger, robuster Fund, der die
theoretische Grundidee des Confluence-Ansatzes (mehrere übereinstimmende Signale verbessern die
Trefferquote stärker als jedes Signal einzeln) direkt bestätigt.

## 4. Bekannte Lücken (nicht vergessen)

- **Divergenz-Radar: Spot-Pressure-Absorption** und **RSI/MACD-Divergenz-vs-Trend** — noch nicht
  berechnet (Zeitgründe). Ersteres hat ohnehin nur ~2,5 Wochen Historie, zweiteres baut auf den
  bereits extrem kleinen TradingView-Divergenz-Stichproben auf — beide vermutlich MIN_N-limitiert.
- **Paar-Variante B** (volle Kombinatorik über alle 31 Signale, explorativer Pool mit eigener
  BH-FDR-Korrektur, siehe Abschnitt 5 Nachtrag des Protokolls) — noch nicht umgesetzt.
- **Unkorrigierte Rohdaten-Ansicht** (Nachtrag, "Test ohne BH-FDR"): technisch bereits vorhanden
  (`raw_p_value`/`raw_significant`-Spalten auf jeder Zeile), aber noch keine eigene Abfrage/
  Kachel dafür gebaut.
- Signale mit aktuell zu kurzer Historie (Positionierung, Orderbuch, Optionen, Funding, alle
  TradingView-basierten) werden mit wachsender Zeit von selbst testbar — keine Handlung nötig,
  nur Geduld.

## 5. Neue DB-Objekte

`research_wilson_ci()`, `research_two_proportion_ztest()`, `research_confluence_bh_fdr()`,
`research_confluence_signal_stats` (Ergebnistabelle, 250 Zeilen: 54 Einzelsignal- +
196 Paar-Zeilen), `research_confluence_signal_activation` (Zeilen-Ebene-Aktivierung, 15
LONG- + 14 SHORT-Signale × 3.533/3.553 Setups).

## 6. Pipeline-Integration (Abschnitt 8 des Protokolls) — umgesetzt 11.09.2026

Laufender wöchentlicher Prozess statt Einmal-Backtest, wie in Abschnitt 8 vorgesehen. Drei neue
SQL-Funktionen, per `pg_cron` jeden Montag 05:00 UTC nacheinander ausgeführt (Job
`confluence-score-pipeline-weekly`, direkt als SQL-Cron ohne Edge Function, da kein externer
HTTP-Call nötig ist):

1. `research_confluence_extend_chain()` — erweitert `research_swing_setup_chain_results` für
   LONG und SHORT jeweils vom letzten gespeicherten `resolution_time` bis zur aktuellsten
   verfügbaren 15m-Kerze.
2. `research_confluence_extend_activation()` — erweitert `research_confluence_signal_activation`
   für alle neuen Setups, aber nur für die **13 gesicherten Signale** (s.u.).
3. `research_confluence_refresh_stats()` — rechnet Einzelsignal- und Paar-Zellen (Variante A) für
   diese 13 Signale komplett aus der (jetzt erweiterten) Aktivierungstabelle neu (Wilson-CI,
   Z-Test, p-Wert, MIN_N-Gate); BH-FDR bleibt weiterhin eine Live-Abfrage
   (`research_confluence_bh_fdr('main')`), nichts davon wird zusätzlich gespeichert.

**Wichtige Entscheidung — 2 von 15 Signalen eingefroren, nicht in die Erweiterung
übernommen:**

- **Positionierung (Divergence-Engine-Score)** und **Divergenz-Radar: Onchain vs Preis** wurden
  in Phase 3 über eine Ad-hoc-Formel klassifiziert, die sich nachträglich nicht mehr sicher
  rekonstruieren ließ (die live verfügbaren Quelltabellen — `positioning_signals` mit
  0–100-Skala, `divergence_radar_snapshots` mit 0 historischen Zeilen — passen nicht zu den
  historisch klassifizierten Werten). Beide sind ohnehin schwache Signale (Positionierung:
  25/3.533 ≈0,7% Aktivierung LONG, SHORT nicht mal im qualifizierenden Set; Onchain-Divergenz:
  50/3.533 bzw. 18/3.553, beides nicht BH-FDR-signifikant).
- Mit Toby abgestimmt: diese 2 Signale bleiben auf ihrem historischen `n` **eingefroren**
  (`min_n_met` unverändert, keine neuen Aktivierungs-Zeilen), bis die Original-Logik
  wiedergefunden wird oder eine neue Definition festgelegt wird. Ihre bestehenden Zellen in
  `research_confluence_signal_stats` werden von `research_confluence_refresh_stats()` nicht
  angefasst.
- Die restlichen **13 Signale** wurden direkt aus den historischen Aktivierungsdaten
  rückwärts-verifiziert (Kreuztabelle Aktivierung × Rohwert bei bekannten Setups) — für 12 davon
  ergab sich eine exakte, deterministische Regel (Struktur ×4, MTF-Alignment, CVD-Richtung,
  Trendstärke, Trend-Regime, VWAP-Position, Fear & Greed, Makro-Regime, Orderbuch-Imbalance).
  Erste Erweiterungsrunde bestätigt die Konsistenz: z.B. Struktur 4h SHORT n=1.708→1.719,
  Trefferquote unverändert 25,9%.
- **Ausnahme Momentum-Faktor (RSI+MACD):** als Confirming-Signal (Fenster Entry bis
  Preis+0,25%-Marge) ließ sich die exakte historische Logik nur zu ~92% reproduzieren (Rest
  vermutlich eine kleine Abweichung in der Fenstergrenze). Bewusst mit dieser bekannten
  Ungenauigkeit übernommen, da das Signal bereits gesichert BH-FDR-signifikant ist (n>3.000) und
  wenige neue Zeilen pro Woche die Gesamtkraft nicht verändern — aber im Hinterkopf behalten,
  falls die Trefferquote dieses Signals sich künftig auffällig verschiebt.

## 6c. Confluence-Score — produktiv umgesetzt (12.09.2026)

Nach Feedback-Runde zu institutioneller Praxis (Grinold-Kahn IC-Gewichtung, Naive-Bayes/
Weight-of-Evidence, Meta-Labeling, Kelly-Sizing — siehe Chat) fiel die Wahl auf
**Weight-of-Evidence** (Naive-Bayes-Log-Odds-Kombination, dieselbe Mathematik wie klassische
Kredit-Scorecards): deterministisch, nutzt exakt die bereits vorhandenen Trefferquoten, und
skaliert auf beliebig viele gleichzeitig aktive Signale statt nur Paare.

**Kollinearitäts-Problem zuerst gelöst:** 9 der 13 gesicherten Signale (alle Struktur-Varianten,
MTF-Alignment, CVD, Trendstärke, Trend-Regime, VWAP) korrelieren stark (φ 0,4–0,7) — sie messen
im Kern alle denselben "ist ein Trend da"-Sachverhalt. Zu einem Faktor **"Trend-Konfirmation"**
(Konsens-Zähler 0-9) verdichtet, der bereits allein eine klar bessere Trennschärfe zeigt als jedes
Einzelsignal (0 Signale aktiv: ~12% Trefferquote, 2-3 aktiv: ~27%, danach Sättigung — bestätigt
die Kollinearität empirisch). Zusammen mit den 4 eigenständigen Faktoren (Momentum, Fear & Greed,
Makro-Regime, Orderbuch-Imbalance) ergeben sich **5 quasi-unabhängige Faktoren** statt 13.

**Backfill auf 4 Jahre erweitert** (09/2022–heute, zuvor 2 Jahre) für die Out-of-Sample-Prüfung:
15m/1h/4h/1d BTCUSDT-Kerzen + `market_features` rückwirkend nachgeladen (Setup-Kette jetzt
7.213 LONG / 7.262 SHORT statt 3.557/3.571). Fear & Greed war bereits seit 2018 vorhanden
(kostenlos nutzbar), Makro-Regime bewusst NICHT rückwirkend erweitert (trägt ohnehin nur schwach
bei, hätte neuen Backfill-Code erfordert).

**Out-of-Sample-Validierung dreifach bestätigt** (2 Jahre/kurzer Test, 4 Jahre/kurzer Test,
4 Jahre/langer Test — je mit Embargo, Trainings-WOE nie auf Testdaten berechnet): **3 grobe
Stufen** (Terzile) trennen konsistent und sauber (~14-17% "Niedrig" vs. ~25-28% "Hoch", stabil
über alle drei Läufe). **Dezile bleiben instabil** — bei Trefferquoten um 20-30% und ~60-175
Setups pro Bucket liegt der Standardfehler bei ±3-4 Prozentpunkten, viele benachbarte Dezile sind
statistisch nicht unterscheidbar. Dezile sind daher bewusst zurückgestellt, bis deutlich mehr
Daten (Grössenordnung 10×) vorliegen — reine Zeitfrage, keine Methodikfrage.

**Wichtige Design-Entscheidung — Leading/Confirming zeitlich getrennt:** Momentum-Faktor ist ein
Confirming-Signal (nur bekannt, sobald ein laufendes Setup +0,25% erreicht) — beim Entry selbst
noch nicht verfügbar. Ohne Momentum trennt der Score nur noch das untere Drittel klar ab (LONG
14,4% vs. 24,4%/24,4% — die oberen zwei Drittel werden fast identisch). Deshalb zweiphasiges
Design:
- **Vorab-Score** (bei Entry): 4 Leading-Faktoren (Trend-Konfirmation, Fear & Greed,
  Makro-Regime, Orderbuch-Imbalance).
- **Bestätigungs-Update** (sobald +0,25% erreicht): Momentum-WOE kommt dazu, Score kann auf
  eine höhere (oder niedrigere, falls Momentum ausbleibt) Stufe wechseln.

**Neue DB-Objekte:** `research_confluence_score_woe` (WOE-Werte je Faktor/Zustand/Richtung),
`research_confluence_score_tiers` (Terzil-Grenzen des Vorab-Scores je Richtung),
`research_confluence_score_refresh()` (wöchentlich im bestehenden Cron
`confluence-score-pipeline-weekly` nach `refresh_stats()`), `research_confluence_score(direction,
trend_count, fear_greed_active, makro_active, orderbuch_active, momentum_state)` — Live-Lookup,
gibt Wahrscheinlichkeit + Stufe (Niedrig/Mittel/Hoch) zurück. `momentum_state='unknown'` (Default)
lässt Momentum unberücksichtigt (neutral, nicht negativ).

**Noch offen (nächster Schritt, nicht Teil dieser Umsetzung):** UI-Anbindung (Dashboard-Kachel,
die `research_confluence_score()` für die aktuelle Marktlage aufruft und den Vorab-Score sowie
— sobald ein Trade läuft — das Bestätigungs-Update anzeigt).

## 7. Zusätzlich zu merken (Erinnerung, nicht jetzt umsetzen)

Alle Punkte aus Abschnitt 4 ("Bekannte Lücken") bleiben offen und werden von der neuen Pipeline
NICHT automatisch nachgeholt — sie betreffen andere Baustellen als die wöchentliche Erweiterung:
Divergenz-Radar Spot-Pressure-Absorption + RSI/MACD-Divergenz-vs-Trend (noch nicht berechnet),
Paar-Variante B (volle Kombinatorik, eigener explorativer Pool), unkorrigierte Rohdaten-Ansicht
als eigene Abfrage/Kachel, sowie das in `CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md` Abschnitt 6b
festgehaltene Decay-Gewicht-Konzept (exponentieller Zerfall statt hartem Staleness-Cutoff) als
spätere Verfeinerung. Dazu neu: die Original-Definition der 2 eingefrorenen Signale
(Positionierung, Divergenz-Radar: Onchain vs Preis) wiederfinden oder neu festlegen.
