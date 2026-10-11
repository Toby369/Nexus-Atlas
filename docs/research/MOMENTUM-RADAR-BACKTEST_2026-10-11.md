# Mo's Momentum Radar — Triple-Barrier-Backtest der großen Punkte — 2026-10-11

**STATUS: RESEARCH ONLY.** Keine Production-Änderung. Phase 2 aus
`MOMENTUM-RADAR-PLAN_2026-10-11.md`. Code: `research-python/momentum_radar_research/`.

## 1. Fragestellung

Toby-Auftrag (11.10.2026): "teste 15m, 1h, 4h, große Punkte, Setup wie bisher, binance BTCUSDT.P".
Wird Tobys Trade-Setup durch einen großen Punkt des Momentum Radars öfter profitabel als der
Zufallswert?

## 2. Daten

- Supabase `candles`, binance BTCUSDT **Perpetual** (Quelle `fapi`, passt zu BINANCE:BTCUSDT.P).
- 15m/1h/4h/1d, 2022-09-04 bis 2026-10-11, lückenlos (15m: 143.863 Kerzen).
- Export über den Supabase-MCP-Kanal (die Sandbox erreicht weder Binance noch den Supabase-Host
  direkt). Die CSVs liegen nicht im Repo, sie lassen sich mit derselben `string_agg`-Abfrage neu
  erzeugen (siehe Modul-README).
- Die ersten 60 Tage sind Anlaufzeit (EMA/SMA inkl. Tageswelle) und werden verworfen.

## 3. Methodik

**Signal:** 1:1 aus dem RECHENWERK des Pine-Skripts, Default-Einstellungen, keine Kalibrierung
(`radar.py`):
- Welle WaveTrend 9/12/3 (HLC3). Punkt = Kreuz Welle/Signallinie bei Welle ≤ -50 (Long) bzw.
  ≥ +50 (Short), am Schluss der Kerze.
- Groß = mindestens 60 % der mitzählenden Zeitebenen plus Geldfluss stehen auf derselben Seite.
  Mitzählen dürfen nur Zeitebenen echt über dem Chart (W aus, 15m/5m "nur anzeigen"):

  | Chart | zählt mit | nötig |
  |---|---|---|
  | 15m | D, 4h, 1h + Geldfluss | 3 von 4 |
  | 1h | D, 4h + Geldfluss | 2 von 3 |
  | 4h | D + Geldfluss | 2 von 2 |

- Höhere Zeitebenen exakt mit der Pine-Semantik `[1]` + `lookahead_on`: Ein HTF-Wert ist erst ab
  der Chart-Kerze sichtbar, die nach dem HTF-Schluss öffnet.

**Trade (wie `RSI-REVERSAL-TRIPLE-BARRIER_2026-09-14.md`):** Entry am Open der nächsten Kerze,
TP +1,5 % / SL -0,5 % Kursbewegung (3:1, bei 20x = +30 %/-10 % auf die Margin), Timeout 48 h. Der
Pfad läuft immer auf 15m-Kerzen. Berühren TP und SL dieselbe Kerze, gewinnt der SL. Gewinnschwelle
bei 3:1: **25 % TP-Rate**.

**Splits / Statistik:** wie im RSI-Backtest (train < 2026-01-14, validation bis < 2026-05-14,
test ≥ 2026-05-15, Purging an Split-Grenzen). Zweiseitiger Test der TP-Rate gegen 25 %. BH-FDR
getrennt für die Primärfamilie (große Punkte, 6 Zellen) und die Sekundärfamilie (24 Zellen).
Zellen mit n < 30 gelten als `INSUFFICIENT_DATA` und fließen nicht in die Korrektur ein.

**Bewusste Abweichung:** Trades einer Zelle überlappen nicht. Ein neues Signal zählt erst nach dem
Ausstieg aus dem vorherigen Trade, wie bei einem einzelnen Trader. Abhängige, gleichzeitige Trades
blähen die Signifikanz sonst künstlich auf.

**Pre-registriert** (im Code-Kopf von `run_backtest.py` festgehalten, keine Anpassung nach Ansicht
der Ergebnisse): Primär großer Punkt. Sekundär kleiner Punkt, jeder Punkt, großer Punkt +
Trendfilter EMA50 (4h), großer Punkt + Trendfilter Struktur (4h). Baseline: durchgehend im Markt,
stündlicher Einstieg.

**Look-Ahead-Sicherheit:** `tests/test_radar.py` prüft unter anderem, dass sich kein Signal ändert,
wenn alle späteren Daten abgeschnitten werden (624 Punkte im synthetischen Testsatz). 9/9 Tests
grün.

## 4. Ergebnisse — Primärfamilie (große Punkte), Test-Split

| TF | Richtung | n | TP-Rate | Erwartung (R) | p | BH |
|---|---|---|---|---|---|---|
| 15m | Long | 40 | 22,5 % | -0,10 | 0,72 | nein |
| 15m | Short | 32 | 31,3 % | +0,25 | 0,41 | nein |
| 1h | Long | 22 | 18,2 % | -0,27 | 0,46 | zu wenig Daten |
| 1h | Short | 17 | 41,2 % | +0,65 | 0,12 | zu wenig Daten |
| 4h | Long | 0 | – | – | – | keine Signale |
| 4h | Short | 1 | – | – | – | keine Signale |

**Keine Zelle besteht die Korrektur.** Die beiden positiven Test-Zellen (15m Short, 1h Short)
waren in train **unter** der Gewinnschwelle (21,5 % bzw. 18,9 %, 1h Short in train sogar
p = 0,04 schlechter als Zufall). Das ist das typische Bild von Rauschen, keine stabile Kante.

## 5. Gepoolt über alle Splits (deskriptiv)

| Variante | TF | Richtung | n | TP-Rate | 95 %-KI | Erwartung (R) |
|---|---|---|---|---|---|---|
| **groß** | 15m | Long | 242 | 22,3 % | 17,5–28,0 % | -0,09 |
| **groß** | 15m | Short | 430 | 22,6 % | 18,9–26,7 % | -0,07 |
| **groß** | 1h | Long | 140 | 20,0 % | 14,2–27,4 % | -0,19 |
| **groß** | 1h | Short | 264 | 21,6 % | 17,1–26,9 % | -0,13 |
| klein | 15m | Long | 2143 | 24,4 % | 22,6–26,2 % | -0,00 |
| klein | 15m | Short | 2149 | 24,0 % | 22,3–25,9 % | -0,03 |
| klein | 1h | Long | 585 | 20,5 % | 17,4–24,0 % | -0,16 |
| klein | 1h | Short | 549 | 22,2 % | 18,9–25,9 % | -0,09 |
| klein (= alle) | 4h | Long | 185 | 23,2 % | 17,7–29,8 % | -0,04 |
| klein (= alle) | 4h | Short | 226 | 22,6 % | 17,6–28,4 % | -0,09 |
| Baseline immer im Markt | 1h | Long | 7.089 | 24,6 % | – | 0,00 |
| Baseline immer im Markt | 1h | Short | 7.167 | 24,3 % | – | -0,02 |

Kernaussagen:

1. **Große Punkte sind nicht besser als kleine, eher schlechter** (15m: 22,3–22,6 % gegenüber
   24,0–24,4 %). Die Mehrheit der Zeitebenen bringt in dieser Form keinen Mehrwert.
2. **Kein Punkt-Typ schlägt die Baseline "immer im Markt"** (~24,5 %). Auf 1h liegen alle
   Punkt-Varianten sogar spürbar darunter (20–22 %).
3. **Im 4h-Chart gibt es praktisch keine großen Punkte** (1 in 4 Jahren). Dort braucht ein großer
   Punkt "Tageswelle in der Zone UND Geldfluss in Signalrichtung". Beim Long-Punkt ist der
   60er-Geldfluss aber nur in 22 % der Fälle positiv, weil der Kurs gerade gefallen ist. Beide
   Bedingungen widersprechen sich fast immer. Das ist eine strukturelle Eigenschaft des
   Rechenwerks, kein Datenproblem.

## 6. Trendfilter (Fix F7) und Befund 4 aus dem Code-Review

Mit Trendfilter bleiben fast keine großen Punkte übrig:

| TF | groß ohne Filter (Long/Short) | + EMA50 (4h) | + Struktur (4h) |
|---|---|---|---|
| 15m | 260 / 505 | 2 / 1 | 13 / 6 |
| 1h | 141 / 273 | 1 / 3 | 14 / 17 |

Das bestätigt Befund 4 aus dem Code-Review mit Daten. Ein großer Long-Punkt entsteht fast nur,
wenn der 4h-Kurs **unter** der EMA50 liegt, also im Abwärtstrend ("alles überverkauft"). Er ist
damit ein Gegentrend-Signal. Für eine Aussage zur Qualität der gefilterten Punkte reichen die
Fallzahlen nicht (alle n < 30).

## 7. Klassifikation

**NO_EDGE** für die großen Punkte als Einstiegssignal mit Tobys Setup, auf 15m und 1h. Auf 4h ist
das Signal **nicht testbar**, weil es praktisch nie auftritt.

Begründung in einem Satz: Weder große noch kleine Punkte erreichen die 25-%-Gewinnschwelle robust
oder schlagen den Markt-Durchschnitt. Große Punkte sind nicht besser als kleine, und die
Ergebnisse sind über train, validation und test nicht stabil.

Das deckt sich mit den beiden nächstverwandten Studien: Wave Anchor (gleicher WaveTrend-Kern,
`NO_INCREMENTAL_EVIDENCE`) und RSI-Reversal (gleiche Signalfamilie "überverkauft, dann dreht",
0/24 Zellen).

## 8. Limitationen

- **Kein Golden-Value-Abgleich gegen TradingView.** Der Nachbau folgt dem Pine-Code Zeile für
  Zeile, wurde aber nicht gegen einen TradingView-Datenexport verglichen. Kleine Abweichungen
  sind möglich, vor allem bei der EMA-Initialisierung (nach 60 Tagen Anlaufzeit vernachlässigbar)
  und bei Pivot-Gleichständen in der Struktur (betrifft nur den Trendfilter).
- Nur Default-Einstellungen und Mo's feste Konstanten. Das ist gewollt, keine Optimierung.
- Gebühren, Funding und Slippage sind nicht modelliert. Sie würden das Ergebnis nur verschlechtern.
- Die Anleitung sagt ausdrücklich, dass der Radar kein Einstiegskurs ist: "Level aus dem VWAP
  Vector". Getestet wurde der Punkt als **alleiniger** Trigger mit Entry am nächsten Open. Die
  Kombination Punkt + VWAP-Vector-Level ist eine andere Hypothese und hier nicht abgedeckt.
- Nicht getestet (sekundäre Hypothesen aus dem Plan): Raute (H4), Geldfluss-Divergenz (H5),
  Divergenzen (H6), Spot/Futures (H8, keine Spot-Daten).

## 9. Konsequenz für Phase 3

Keine Nexus-Integration der großen Punkte als Signal, weder Webhook-Badge noch native Berechnung.
Das ist dieselbe Konsequenz wie bei Wave Anchor. Der Radar bleibt nutzbar als Chart-Werkzeug für
Kontext (Lage der Zeitebenen, Geldfluss), aber ohne belegten Vorteil als Einstiegsauslöser.

---

# Teil 2 — Folge-Backtest: Punkt + VWAP-Vector-Level und übrige Signale

Toby, 11.10.2026: "ja" zu beiden Folge-Vorschlägen. Code: `run_followup.py`, `vwap_vector.py`.
Gleiche Daten, Splits, Barrieren und Statistik wie Teil 1. Pre-registriert im Kopf von
`run_followup.py`.

## 10. Familie A — Punkt + VWAP-Vector-Level (Mo's Anleitung Kapitel 6)

**Umsetzung der Regel "Level aus dem VWAP Vector, dorthin die Order, kein Level in Reichweite =
kein Trade":**
- Levels wie Nexus' VWAP-Vector-Nachbau (`lib/tradingIndicatorsContext.ts`): Tag-, Wochen- und
  Monats-VWAP sowie VWAP seit dem letzten bestätigten 1H-Swing-Hoch bzw. -Tief (fraktal,
  Lookback 20). Gerechnet auf 15m mit hlc3 × Volumen. Ein Swing gilt erst nach 20 Folgekerzen
  als bekannt.
- Nach dem Punkt: Limit-Order am nächsten Level in Trade-Richtung (Long: höchstes Level unter dem
  Kurs, Short: tiefstes darüber), sofern es innerhalb der Reichweite liegt (0,5 % oder 1,0 %).
  Die Order ist 8 Chart-Kerzen gültig. In der Füll-Kerze zählt nur der SL (konservativ).
- Baseline A0: dieselbe Limit-Logik stündlich, **ohne** Radar-Punkt.

**Ergebnis Test-Split:** keine Zelle besteht BH-FDR. Bei den großen Punkten haben alle
Test-Zellen n ≤ 8.

**Gepoolt über alle Splits (Auszug):**

| Signal | TF | Richtung | Reichweite | Punkte | ohne Level | Trades | TP-Rate | 95 %-KI |
|---|---|---|---|---|---|---|---|---|
| groß | 15m | Long | 1,0 % | 256 | 88 % | 25 | 28,0 % | 14,3–47,6 % |
| groß | 15m | Short | 1,0 % | 487 | 87 % | 52 | 25,0 % | 15,2–38,2 % |
| groß | 1h | Long | 1,0 % | 141 | 75 % | 32 | 28,1 % | 15,6–45,4 % |
| groß | 1h | Short | 1,0 % | 266 | 70 % | 68 | 20,6 % | 12,7–31,6 % |
| jeder | 15m | Long | 1,0 % | 2723 | 66 % | 526 | 24,5 % | 21,0–28,4 % |
| jeder | 15m | Short | 1,0 % | 2975 | 68 % | 564 | 25,2 % | 21,8–28,9 % |
| jeder | 1h | Long | 1,0 % | 725 | 66 % | 203 | 26,6 % | 21,0–33,1 % |
| jeder | 1h | Short | 1,0 % | 826 | 69 % | 212 | 21,7 % | 16,7–27,7 % |
| jeder | 4h | Short | 1,0 % | 226 | 39 % | 123 | 30,1 % | 22,7–38,7 % |
| **A0: nur Level, kein Punkt** | 1h | Long | 1,0 % | 11.271 | 69 % | 2706 | 25,8 % | 24,2–27,5 % |
| **A0: nur Level, kein Punkt** | 1h | Short | 1,0 % | 12.193 | 72 % | 2715 | 24,1 % | 22,6–25,8 % |

Kernaussagen:

1. **Großer Punkt + Level kommt kaum vor.** Bei 70–88 % der großen Punkte liegt **kein**
   VWAP-Level in Trade-Richtung. Der Grund ist mechanisch: Ein großer Long-Punkt entsteht nach
   einem Abverkauf, dann hängen alle VWAPs (Tag, Woche, Swing) **über** dem Kurs. Mo's Regel
   "kein Level = kein Trade" filtert also fast alle großen Punkte weg. Die übrigen 25–68 Trades
   reichen für keine Aussage (KI ±15 Prozentpunkte).
2. **Der Punkt fügt dem Level nichts hinzu.** "Jeder Punkt + Level" liegt bei 22–27 % und damit
   auf dem Niveau von "nur Level, ohne Punkt" (24–26 %). Die Baseline selbst hat ebenfalls
   keine Kante: Eine reine Limit-Order am VWAP-Level schlägt die 25 % nicht robust.
3. **Einzige Auffälligkeit: 4h, jeder Short-Punkt + Level** (30,1 %, n = 123). Sie hält im
   Test-Split nicht (11 %, n = 9) und ist eine von 24 Zellen. Das ist kein Beleg, höchstens ein
   Punkt zum Weiterbeobachten.

## 11. Familie B — Raute, Divergenz, Geldfluss-Divergenz (Markt-Entry)

**Ergebnis Test-Split:** keine Zelle besteht BH-FDR.

**Gepoolt über alle Splits:**

| Signal | TF | Long: n / TP | Short: n / TP |
|---|---|---|---|
| Raute (als Umkehr-Einstieg) | 15m | 40 / **12,5 %** | 60 / **13,3 %** |
| Divergenz Welle | 15m | 737 / 25,0 % | 821 / 24,4 % |
| Divergenz Welle | 1h | 176 / **16,5 %** | 225 / **19,1 %** |
| Divergenz Welle | 4h | 49 / 16,3 % | 78 / 26,9 % |
| Geldfluss-Divergenz (MF) | 15m | 1048 / 26,0 % | 1120 / 23,8 % |
| Geldfluss-Divergenz (MF) | 1h | 323 / 27,2 % | 345 / 21,7 % |
| Geldfluss-Divergenz (MF) | 4h | 68 / 23,5 % | 85 / 17,6 % |

Kernaussagen:

1. **Raute als Einstieg ist klar schlecht** (12–13 % auf 15m, KI-Obergrenze 24–26 %). Das
   bestätigt Mo's eigene Anleitung ("kein Einstieg, sondern eine Warnung"). Auf 1h/4h kommt sie
   zu selten vor (≤ 9).
2. **Divergenzen auf 1h sind schlechter als Zufall** (16,5 % bzw. 19,1 %, in train mit
   p = 0,015 bzw. 0,012 signifikant darunter). Gegen die laufende Bewegung einzusteigen, weil
   eine Divergenz da ist, kostet auf 1h Geld. Auch das deckt sich mit der Anleitung ("Divergenz
   ist KEIN Einstieg … kann sich mehrfach verlängern").
3. **Die Geldfluss-Divergenz** (laut Anleitung "die wichtigste Beobachtung") liegt durchweg im
   Bereich 18–27 %, ohne stabile Kante. Long auf 1h (27,2 %) war in train 29,5 %, in test 13,5 %.

## 12. Gesamtklassifikation (Teil 1 + Teil 2)

**NO_EDGE.** Kein getestetes Signal des Momentum Radars liefert mit Tobys Setup (3:1, 48 h)
eine robuste, über train/validation/test stabile Trefferquote über der 25-%-Gewinnschwelle:
große Punkte, kleine Punkte, Punkt + VWAP-Level, Raute, Divergenz und Geldfluss-Divergenz.
Zwei Signale schneiden sogar klar **schlechter** als Zufall ab: die Raute als Umkehr-Einstieg und
Divergenzen auf 1h. Beide warnt Mo's eigene Anleitung schon als Einstieg.

Zusätzlich gelten die Limitationen aus Abschnitt 8. Für Teil 2 kommt hinzu: Der VWAP Vector
ist Nexus' Nachbau (5 Levels). Mo's Original kennt zusätzlich "offene POCs" und ATR-
Erweiterungen, deren Quellcode nicht vorliegt.

## 13. Konsequenz

Phase 3 (Nexus-Integration) entfällt für alle getesteten Radar-Signale. Der Radar bleibt ein
persönliches Chart-Werkzeug. Wenn Toby ihn nutzt, dann am ehesten als **Warnsystem**: Raute und
Divergenz sind laut Daten schlechte Einstiege, also eher ein Grund, **nicht** gegen die Bewegung
einzusteigen. Ein Auslöser für Trades ist er nicht.
