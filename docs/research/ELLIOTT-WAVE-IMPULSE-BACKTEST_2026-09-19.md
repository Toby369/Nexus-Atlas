# Elliott-Wave-Impuls-Reversal: Backtest — 2026-09-19

## 1. Fragestellung

Toby liefert eine vollständige, formale Spezifikation für einen Elliott-Wave-Indikator (fraktale
Zick-Zack-Pivots + Fibonacci-Proportionen + die drei "eisernen" Elliott-Wave-Regeln zur
automatischen Erkennung von Impulswellen 1-2-3-4-5) und bittet darum, diesen nachzubauen und
gegen "Toby Setup" zu testen. Die Grundidee: nach einer bestätigten Impulswelle folgt laut
Elliott-Wave-Theorie eine A-B-C-Korrektur — das Ende von Welle 5 ist damit ein potenzielles
Reversal-Signal in die Gegenrichtung.

Da "Toby Setup" seit der Korrektur vom 19.09.2026 vier benannte Standards umfasst (Standard 1
Referenz TP 35%, Standard 2 TP 30%, Standard 3 TP 25%, Standard 4 TP 20% — alle SL 10%, siehe
`knowledge_base` module='mein_system' und `research-python/TOBY_SETUP_STANDARDS.py`), wurden
diesmal **alle vier Standards parallel getestet**, statt sich auf einen zu beschränken.

## 2. Methodik

### 2.1 Pivot-Erkennung — auf HIGH/LOW, nicht CLOSE

Anders als bei den bisherigen Pivot-basierten Projekten dieser Session (Old-Money-Stack,
AVWAP-Pivot — beide auf CLOSE) folgt dieses Projekt exakt Tobys eigener Spezifikation:
`pivot_high` operiert auf dem HIGH-Array, `pivot_low` auf dem LOW-Array (Pine-Äquivalent
`ta.pivothigh(high,N,N)`/`ta.pivotlow(low,N,N)`). Pivot-Tiefe `N=8` (Mittelwert aus Tobys
empfohlenem Bereich 5-12). Gleiche Look-Ahead-sichere Reveal-Lag-Konvention wie in allen
bisherigen Projekten dieser Session: ein Pivot bei Bar `i` wird erst bei Bar `i+N` bekannt.

### 2.2 Zick-Zack-Konstruktion (eigene Ergänzung, nicht Teil von Tobys Spezifikation)

Tobys Spezifikation beschreibt Pivot-Highs und -Lows als getrennt erkannte Ereignisse, geht aber
implizit von EINER alternierenden Punktfolge (Start→P1→P2→P3→P4→P5) aus. Diese Zusammenführung
wurde nach Standard-Zick-Zack-Technik umgesetzt: folgen zwei Pivots desselben Typs aufeinander
(ohne dass zwischendurch der andere Typ auftrat), bleibt nur der EXTREMERE (höheres Hoch/tieferes
Tief) im Zick-Zack — erst ein Pivot des jeweils anderen Typs hängt einen neuen Punkt an.

**Dokumentierte Einschränkung:** ein Signal feuert, sobald P5 zum ersten Mal als alternierender
Punkt angehängt wird (an seiner eigenen Enthüllungs-Bar). Erscheint später ein noch extremerer
Punkt desselben Typs, wird P5 in der Zick-Zack-Struktur zwar ersetzt, das bereits gefeuerte Signal
aber NICHT rückwirkend annulliert — entspricht der Grenze eines Live-Indikators, der zum
Zeitpunkt des Labels bereits gehandelt hätte.

### 2.3 Die drei eisernen Regeln + Fibonacci-Filter (exakt nach Tobys Parametertabelle)

- **Regel 1** (Welle 2 durchbricht nicht Start): `P2 > Start` (bullisch, gespiegelt für bärisch).
- **Regel 2** (Welle 3 nicht kürzeste): `Länge3 ≥ Länge1 ODER Länge3 ≥ Länge5`.
- **Regel 3** (Welle 4 überlappt nicht Welle 1): `P4 > P1` (bullisch, gespiegelt für bärisch).
- **Fibonacci Welle 2**: Retracement ∈ [0,382, 0,786] von Länge1.
- **Fibonacci Welle 3**: Extension ≥ 1,618 × Länge1.
- **Fibonacci Welle 4**: Retracement ≤ 0,50 von Länge3.

Werte aus Tobys Parametertabelle übernommen (nicht die abweichenden Prozentangaben im
Fließtext-Abschnitt "Schritt C", da die Tabelle explizit als Pine-Script-Implementierungsvorgabe
gekennzeichnet ist). 12 Unit-Tests verifizieren jede einzelne Regel/jeden Filter separat
(Verletzung → korrekt kein Signal) anhand handverifizierter, gegen `pivot_high`/`pivot_low`
geprüfter OHLC-Sequenzen (bullischer und bärischer Fall symmetrisch getestet).

### 2.4 Entry & Trade-Management

Entry = Schlusskurs der Enthüllungs-Bar von P5, Richtung = Gegenteil des erkannten Impulses
(bullischer Impuls → SHORT-Reversal, bärischer Impuls → LONG-Reversal). Trade-Exit-Logik 1:1
identisch zu den bisherigen Toby-Setup-Backtests dieser Session (SL/TP-Barriere, danach
Trailing-Rücksetzer ab TP-Berührung, realistischer SL-Fill am tatsächlichen Kerzentief/-hoch) —
diesmal parametrisiert über alle 4 Standards gleichzeitig (SL 10%/0,5% bei allen vier, nur TP
variiert: 1,75%/1,5%/1,25%/1,0% Kursbewegung).

### 2.5 Daten

Gleiche BTCUSDT-Datensätze wie beim AVWAP-Pivot-Projekt: 5m (213.196 Kerzen, 2024-09-04 bis
2026-09-14), 15m (141.668 Kerzen, 2022-09-04 bis 2026-09-18), 1h (35.422 Kerzen, 2022-09-04 bis
2026-09-18).

## 3. Ergebnis

### 3.1 Signalhäufigkeit — deutlich seltener als AVWAP-Pivot

| TF | Signale gesamt | LONG | SHORT | ≈ Signale/Tag |
|---|---|---|---|---|
| 5m | 186 | 88 | 98 | 0,25 (~1 alle 4 Tage) |
| 15m | 118 | 54 | 64 | 0,08 (~1 alle 12 Tage) |
| 1h | 35 | 11 | 24 | 0,024 (~1 alle 6 Wochen) |

Zum Vergleich: der AVWAP-Pivot-Backtest (18.09.) lieferte 6,5 bis 56 Signale/Tag — die
Elliott-Wave-Regeln filtern also um mehrere Größenordnungen strenger. Das ist methodisch
konsistent mit der Grundidee ("seltene, hochwertige Muster statt Rauschen"), bedeutet aber auch
deutlich kleinere Stichproben (339 Trades gepoolt über alle TF/Richtungen, gegenüber 83.515 bei
AVWAP-Pivot).

### 3.2 Trefferquote pro Standard (gepoolt über alle 3 Zeitebenen + beide Richtungen)

| Standard | TP | CRV | n | Winrate | Gewinnschwelle (1/(1+CRV)) | Differenz |
|---|---|---|---|---|---|---|
| 1 (Referenz) | 1,75% | 3,5:1 | 339 | 17,7% | 22,2% | **-4,5 Pp** (z=-2,00) |
| 2 | 1,5% | 3:1 | 339 | 19,5% | 25,0% | **-5,5 Pp** (z=-2,35) |
| 3 | 1,25% | 2,5:1 | 339 | 23,6% | 28,6% | **-5,0 Pp** (z=-2,03) |
| 4 | 1,0% | 2:1 | 339 | 29,5% | 33,3% | **-3,8 Pp** (z=-1,50) |

Alle vier Standards liegen **unter** ihrer jeweiligen Gewinnschwelle, konsistent auf allen drei
Zeitebenen einzeln betrachtet (siehe Rohdaten). Ausgang-Verteilung (Standard 1, gepoolt): 273/339
(80,5%) SL, 60/339 (17,7%) TRAIL_EXIT, 6/339 (1,8%) END_OF_DATA (Datensatzende).

## 4. Kernbefund: Klar unter der Gewinnschwelle — deutlicher als beim AVWAP-Pivot-Test

Anders als bei AVWAP-Pivot-Konfluenz (Trefferquote lag DORT knapp AN/UNTER der Schwelle,
22,4-25,3% vs. 25%) liegt die Elliott-Wave-Reversal-Trefferquote bei allen vier Standards
spürbar (3,8 bis 5,5 Prozentpunkte) unter der jeweiligen Gewinnschwelle. Die z-Werte (-1,5 bis
-2,35) deuten auf einen eher realen als zufälligen Effekt hin, sind aber bei n=339 nicht
überwältigend — und die vier Standards sind keine vier unabhängigen Tests (dieselben 339 Trades,
nur andere TP-Distanz), eine formale Mehrfachtest-Korrektur wäre hier nicht sinnvoll anwendbar.
Die durchgehend negative Richtung auf allen drei Zeitebenen UND allen vier Standards ist dennoch
ein konsistentes, nicht zufällig wirkendes Muster.

## 5. Kritische Einordnung

- **Zick-Zack-Zusammenführung ist eine eigene Ergänzung** (Abschnitt 2.2), nicht Teil von Tobys
  Spezifikation — eine andere, ebenfalls plausible Merge-Konvention könnte andere Ergebnisse
  liefern. Nicht getestet.
- **Pivot-Tiefe N=8 ungetestet gegen Alternativen**: Tobys empfohlener Bereich (5-12) wurde nur
  am Mittelwert getestet, kein Parameter-Sweep über die gesamte Bandbreite.
- **Kein Bestätigungs-Fenster nach P5**: das Signal feuert sofort bei P5s eigener Enthüllung,
  nicht erst wenn der erste Punkt der A-Welle die P5-Extremstelle bestätigt — manche
  Live-Pine-Indikatoren warten diese zusätzliche Bestätigung ab, was hier bewusst nicht
  nachgebildet wurde (siehe Einschränkung in Abschnitt 2.2).
- **Kleine Stichprobe** (339 Trades gepoolt, 11-98 je Timeframe/Richtungs-Bucket einzeln) — die
  z-Werte sind grenzwertig signifikant, nicht überwältigend. Insbesondere der 1h-LONG-Bucket
  (n=11) ist zu klein für eine belastbare Einzelaussage.
- **Kein Train/Test-Split**: wie bei allen bisherigen Backtests dieser Session eine reine
  In-Sample-Messung über den vollen verfügbaren Zeitraum.
- **Keine Slippage über die reine Fee-Annahme hinaus** (0,06%/Seite), keine Order-Ablehnung/
  Teilausführung, keine Funding-Kosten.

## 6. Kurzfazit

Der nachgebaute Elliott-Wave-Impuls-Indikator (fraktale Zick-Zack-Pivots auf HIGH/LOW + die drei
eisernen Regeln + Fibonacci-Filter nach Tobys exakter Spezifikation) liefert auf allen drei
Zeitebenen (5m/15m/1h) und allen vier Toby-Setup-Standards eine Trefferquote **unter** der
jeweiligen CRV-Gewinnschwelle — deutlicher als beim zuvor getesteten AVWAP-Pivot-Ansatz. Die
Signalfrequenz ist dabei um Größenordnungen niedriger (0,024 bis 0,25 Signale/Tag) als bei den
bisherigen gefilterten Ansätzen dieser Session, was die kleine Stichprobe erklärt, aber auch
bedeutet: selbst mit einer sehr strengen, mathematisch exakten Elliott-Wave-Definition entsteht
hier keine positive Kante gegenüber Tobys reiner SL/TP/Trailing-Mechanik — im Gegenteil, die
Trefferquote fällt tendenziell noch etwas schlechter aus als beim ungefilterten Baseline und beim
AVWAP-Pivot-Test.

## 7. Artefakte

- `research-python/elliott_wave_setup/elliott_wave_engine.py` — Zick-Zack-Konstruktion +
  Impuls-Regelprüfung + Fibonacci-Filter
- `research-python/elliott_wave_setup/backtest.py` — Trade-Auflösung + $-P&L über alle 4
  Toby-Standards
- `research-python/elliott_wave_setup/run_backtest.py` — Orchestrierung über 5m/15m/1h × 4
  Standards
- `research-python/elliott_wave_setup/tests/` — 19 Unit-Tests (Pivots, Impuls-Regeln inkl. aller
  Verletzungsfälle, Backtest, Metriken)
- `research-python/elliott_wave_setup/output/signals_{5m,15m,1h}.csv`,
  `trades_{5m,15m,1h}.csv` — vollständige Einzel-Signal-/Trade-Rohdaten (nicht committed, siehe
  `.gitignore`)
