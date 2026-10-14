# Orderflow-4-Schritte — Ergebnisse (14.10.2026)

Protokoll: `ORDERFLOW-4-SCHRITTE-PROTOCOL_2026-10-13.md` mit Nachtrag 1–3.
Code: `research-python/orderflow_4step/` (51 Tests). Bestätigungsläufe je einmal aus
sauberen, gepushten Commits: **Long `9dfa16e`**, **Short `a43ca22`**. Gesamtprobe
01.10.2022 – 30.09.2026, Binance-Futures-15m-Kerzen.

## Kurzfassung

1. **Keine Entscheidung möglich.** Alle Hypothesen (Long und Short) enden in
   `INSUFFICIENT_DATA`. Das vollständige Framework (V4) erzeugt in vier Jahren nur
   **2 Long- und 5 Short-Trades**. Gefordert waren 100.
2. **Ursache sind die Regeln selbst, kein Code-Fehler.** Nach der Bestätigungskerze hat
   sich der Kurs schon so weit Richtung VWAP/POC bewegt, dass der Weg zu Ziel 1 fast immer
   kürzer ist als der Stop-Abstand. Bei den Long-Signalen scheitern 356 von 562 am
   Mindest-CRV von 1,5 (Median-CRV der abgelehnten: 0,4) und 158 haben gar kein Ziel über
   dem Einstieg. Diagnose: siehe unten.
3. **Was beschreibend sichtbar ist, spricht nicht für das Setup.** Auslöser plus
   Risikoregeln ohne Filter (V1) verlieren nach Kosten in beiden Richtungen deutlich:
   Long 48 Trades, −0,49 R je Trade; Short 59 Trades, −0,42 R je Trade. Die wenigen
   V4-Trades sind Long +1,0 R (2 Trades) und Short −6,2 R (5 Trades), zusammen −5,2 R.
   Mit n = 7 ist das statistisch bedeutungslos.
4. **Nebenbefund mit Wirkung auf die App:** `market_features.structure_trend` (die
   Quelle der MTF-Ampel und weiterer Kacheln) hat in der gespeicherten **Historie** einen
   Blick von 5 Kerzen in die Zukunft. Der Live-Wert der jüngsten Kerze ist korrekt, aber
   jede Auswertung auf der gespeicherten Historie ist dadurch zu optimistisch (12 % der
   1h-Kerzen weichen von der kausalen Version ab).

**Folge gemäss Protokoll (Abschnitt 7):** Keine Live-Signale, keine Dashboard-Kachel.

## Ergebnisse Gesamtprobe

| | Long V1 | Long V4 | Short V1 | Short V4 | Long+Short V4 |
|---|---|---|---|---|---|
| Signale | 562 | 102 | 489 | 70 | 172 |
| Trades | 48 | 2 | 59 | 5 | 7 |
| Trefferquote | 29 % | 100 % | 27 % | 20 % | – |
| R je Trade (nach Kosten) | −0,49 | +0,51 | −0,42 | −1,24 | – |
| R Summe | −23,4 | +1,0 | −24,7 | −6,2 | −5,2 |

Holm-korrigierte Hypothesen: alle `INSUFFICIENT_DATA` (n unter 100). Zur Einordnung, ohne
Entscheidungskraft:

- **H2 (Auslöser schlägt Zufall)** ist in beiden Richtungen nominal klar (p_holm ≈ 0,01),
  aber das liegt vor allem an V0. Die Zufallseinstiege haben sehr enge Stops (Tief der 3
  Vorkerzen). Dadurch fressen die festen Kosten in R-Einheiten viel mehr, und V0 verliert
  rund −0,15 R je Tag. Das ist eher ein Konstruktionseffekt der Nulllinie als ein Beleg
  für den Auslöser.
- **H3 (Ort bringt etwas)** ist exakt null: V1 und V2 haben **identische** Trades. Jeder
  Trade, der das CRV besteht, liegt ohnehin im Discount (bzw. Premium), weil nur dort
  genug Abstand zu VWAP/POC bleibt. Der Ort-Filter ist durch die Zielregel schon
  erzwungen.
- **H5 (Tagesregel)** ist null, weil es nie zwei Verluste in Folge gab, bei 2 bzw. 5
  Trades.
- **Sensitivität:** Long-V4 hat in allen 27 Parameter-Kombinationen 0–2 Trades,
  Short-V4 ebenso wenige. Die PBO-Werte (0,21 bzw. 0,03) sind bei so wenigen Trades nicht
  interpretierbar.

## Diagnose: Warum so wenige Trades?

Long-Signale der Gesamtprobe nach dem Grund, warum kein Trade entsteht (vor der
Kettenregel):

| Grund | V1 | V2 | V3 |
|---|---|---|---|
| CRV < 1,5 | 356 | 334 | 80 |
| kein Ziel 1 über dem Einstieg | 158 | 54 | 20 |
| handelbar | 48 | 48 | 2 |

Verteilung des CRV bei den am CRV gescheiterten Signalen (10/25/50/75/90 %): 0,08 /
0,18 / 0,40 / 0,79 / 1,14.

Inhaltlich heisst das: Auf 15m liegen „Discount“ (unter dem Tages-VWAP bzw. der Value
Area) und „Ziel“ (VWAP/POC) so nah beieinander, dass nach der vom Framework verlangten
Bestätigung kaum noch Gewinnspielraum bleibt. Das ist ein bekannter Zielkonflikt von
Bestätigungs-Einstiegen: Je sicherer der Einstieg, desto weniger Weg bleibt bis zum Ziel.

## Was daraus folgt (Vorschläge, nicht Teil des Protokolls)

Jede Änderung wäre ein **neuer** Test mit neuem, vorregistriertem Protokoll. Diese Daten
dürfen dafür nicht noch einmal als Bestätigung dienen. Denkbare Richtungen:

1. **Ziele weiter fassen:** Ziel 1 am gegenüberliegenden Value-Area-Rand (VAH) statt am
   VWAP/POC. Das entspricht eher der Auktionslogik „von Rand zu Rand“.
2. **Höherer Zeitrahmen:** Auslöser auf 1h statt 15m, Kontext auf 1d. Mehr Abstand zwischen
   Ort und Ziel, aber noch weniger Signale.
3. **Echte Orderflow-Daten:** Taker-Delta pro Kerze ist eine grobe Näherung für
   Absorption. Mit Footprint- oder Orderbuchdaten könnte das anders aussehen. Das wäre ein
   neuer Datensammler mit Kosten- und Log-Ingestion-Fragen.

**Separat und unabhängig vom Backtest:** `collect-candles::computeMarketStructure` sollte
kausal werden (Swing erst bei j+5 eintragen), damit Auswertungen auf der gespeicherten
Historie nicht zu optimistisch sind.
Eingetragen in `IDEEN-BACKLOG.md`.

## Rohberichte

### Long (Commit 9dfa16e)

Commit: `9dfa16e863ddd4e3e022e5fa2795092f77770853`

1h-Struktur: 36022 Kerzen verglichen. Port des Originals vs. gespeichert: 100.0% (bestätigt den Port). Übereinstimmung kausal vs. gespeichert: 87.8%. Kausal um 5 Kerzen vorgezogen vs. gespeichert: 87.6%.

#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 562 | 48 | 29.2% | -0.487 | -23.35 | -0.0160 | 22.91 | 32% |
| V2 | 436 | 48 | 29.2% | -0.487 | -23.35 | -0.0160 | 22.91 | 32% |
| V3 | 102 | 2 | 100.0% | +0.509 | +1.02 | +0.0007 | 0.00 | 100% |
| V4 | 102 | 2 | 100.0% | +0.509 | +1.02 | +0.0007 | 0.00 | 100% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.1467, 5–95 %: -0.1992 bis -0.0905

Ausstiegsgründe V4: {'t1_then_breakeven': 2}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_FORMING_BULLISH': {'count': 1, 'mean': 0.527}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': 0.491}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |               0.0007 |     0.0000 |    0.0018 | 0.1134 |              2 |   0.3402 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.1307 |   nan      |  nan      | 0.0020 |             48 |   0.0080 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |             48 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |               0.0167 |     0.0035 |    0.0267 | 0.0010 |              2 |   0.0050 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              2 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 292 | 18 | 38.9% | -0.279 | -5.02 | -0.0069 | 4.44 | 50% |
| V2 | 225 | 18 | 38.9% | -0.279 | -5.02 | -0.0069 | 4.44 | 50% |
| V3 | 59 | 1 | 100.0% | +0.491 | +0.49 | +0.0007 | 0.00 | 100% |
| V4 | 59 | 1 | 100.0% | +0.491 | +0.49 | +0.0007 | 0.00 | 100% |

Ausstiegsgründe V4: {'t1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': 0.491}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 133 | 14 | 21.4% | -0.572 | -8.01 | -0.0219 | 12.58 | 25% |
| V2 | 96 | 14 | 21.4% | -0.572 | -8.01 | -0.0219 | 12.58 | 25% |
| V3 | 23 | 0 | – | – | – | – | – | – |
| V4 | 23 | 0 | – | – | – | – | – | – |

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 137 | 16 | 25.0% | -0.646 | -10.33 | -0.0283 | 12.32 | 20% |
| V2 | 115 | 16 | 25.0% | -0.646 | -10.33 | -0.0283 | 12.32 | 20% |
| V3 | 20 | 1 | 100.0% | +0.527 | +0.53 | +0.0014 | 0.00 | 100% |
| V4 | 20 | 1 | 100.0% | +0.527 | +0.53 | +0.0014 | 0.00 | 100% |

Ausstiegsgründe V4: {'t1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_FORMING_BULLISH': {'count': 1, 'mean': 0.527}}

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.2500 |     8.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.2500 |    12.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.5000 |     5.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.5000 |     8.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.5000 |    12.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.7500 |     5.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.7500 |     8.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.0000 |  0.7500 |    12.0000 |   2.0000 |     0.0007 |    1.0175 |
|   -1.5000 |  0.2500 |     5.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.2500 |     8.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.2500 |    12.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.5000 |     5.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.5000 |     8.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.5000 |    12.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.7500 |     5.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.7500 |     8.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -1.5000 |  0.7500 |    12.0000 |   1.0000 |     0.0003 |    0.4908 |
|   -2.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |

PBO (CSCV, 8 Gruppen): 0.21428571428571427

### Short (Commit a43ca22)

Commit: `a43ca224307c8fe50f75e30507db8e2fcb054a76` · Richtung: **short**

1h-Struktur: 36022 Kerzen verglichen. Port des Originals vs. gespeichert: 100.0% (bestätigt den Port). Übereinstimmung kausal vs. gespeichert: 87.8%. Kausal um 5 Kerzen vorgezogen vs. gespeichert: 87.6%.

#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 489 | 59 | 27.1% | -0.418 | -24.68 | -0.0169 | 24.46 | 32% |
| V2 | 390 | 59 | 27.1% | -0.418 | -24.68 | -0.0169 | 24.46 | 32% |
| V3 | 70 | 5 | 20.0% | -1.236 | -6.18 | -0.0042 | 3.76 | 20% |
| V4 | 70 | 5 | 20.0% | -1.236 | -6.18 | -0.0042 | 3.76 | 20% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.1559, 5–95 %: -0.2129 bis -0.0992

Ausstiegsgründe V4: {'stop': 4, 't1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 4, 'mean': -1.162}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': -1.533}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |              -0.0042 |    -0.0093 |   -0.0004 | 0.9515 |              5 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.1391 |   nan      |  nan      | 0.0010 |             59 |   0.0050 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |             59 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |               0.0127 |    -0.0049 |    0.0293 | 0.0722 |              5 |   0.2888 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              5 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 245 | 26 | 19.2% | -0.591 | -15.35 | -0.0210 | 15.56 | 21% |
| V2 | 208 | 26 | 19.2% | -0.591 | -15.35 | -0.0210 | 15.56 | 21% |
| V3 | 39 | 2 | 0.0% | -1.810 | -3.62 | -0.0050 | 1.20 | 0% |
| V4 | 39 | 2 | 0.0% | -1.810 | -3.62 | -0.0050 | 1.20 | 0% |

Ausstiegsgründe V4: {'stop': 2}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 2, 'mean': -1.81}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 100 | 11 | 27.3% | -0.691 | -7.60 | -0.0208 | 8.84 | 33% |
| V2 | 74 | 11 | 27.3% | -0.691 | -7.60 | -0.0208 | 8.84 | 33% |
| V3 | 9 | 1 | 0.0% | -1.533 | -1.53 | -0.0042 | 0.00 | 0% |
| V4 | 9 | 1 | 0.0% | -1.533 | -1.53 | -0.0042 | 0.00 | 0% |

Ausstiegsgründe V4: {'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': -1.533}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 144 | 22 | 36.4% | -0.079 | -1.73 | -0.0047 | 11.68 | 50% |
| V2 | 108 | 22 | 36.4% | -0.079 | -1.73 | -0.0047 | 11.68 | 50% |
| V3 | 22 | 2 | 50.0% | -0.514 | -1.03 | -0.0028 | 1.41 | 50% |
| V4 | 22 | 2 | 50.0% | -0.514 | -1.03 | -0.0028 | 1.41 | 50% |

Ausstiegsgründe V4: {'t1_then_breakeven': 1, 'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 2, 'mean': -0.514}}

#### Long + Short V4 kombiniert (beschreibend)

Long-V4 neu gerechnet: 2 Trades, identisch mit dem Long-Lauf.
Kombiniert: 7 Trades, R je Tag -0.0035 (95 %-KI -0.0088 bis +0.0004), einseitiges p 0.9169, R Summe -5.16.

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.2500 |     8.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.2500 |    12.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.5000 |     5.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.5000 |     8.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.5000 |    12.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.7500 |     5.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.7500 |     8.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.0000 |  0.7500 |    12.0000 |   5.0000 |    -0.0042 |   -6.1794 |
|   -1.5000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |

PBO (CSCV, 8 Gruppen): 0.02857142857142857
