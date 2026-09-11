# Swing-Setup mit Trailing-Exit: 2-Jahres-Backtest + Ausführungs-Sensitivität — 2026-09-11

## 1. Fragestellung

Aufbauend auf dem Triple-Barrier-Backtest (`TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md`)
wurde ein zweites, unabhängiges Setup getestet: statt eines starren TP wird nach Erreichen
des Kursziels ein **Trailing-Exit** simuliert — die Position bleibt offen, bis der Kurs um
einen festen Prozentsatz vom bisherigen Hoch (LONG) bzw. Tief (SHORT) zurückfällt. Ziel:
prüfen, ob Trailing gegenüber einem harten TP zusätzlichen MFE (Maximum Favorable Excursion)
einfängt, und den vollen 2-Jahres-Datensatz statt nur einer Stichprobe auswerten.

Im Verlauf der Auswertung kam eine zweite, wichtigere Frage hinzu: **wie empfindlich ist der
Erwartungswert gegenüber der Annahme, wie ein Stop-Loss tatsächlich gefüllt wird?**

## 2. Methodik

**Setup-Parameter** (`research_swing_setup_events()`):
- Intervall: 15m, BTCUSDT, voller verfügbarer Datensatz 2024-09-04 bis 2026-09-04
- Entry = Open der nächsten Kerze nach Signal (kein Lookahead), jede 15m-Kerze als Signal,
  LONG und SHORT getrennt
- TP 1,75% / SL 0,5% (CRV 3,5:1, angelehnt an Tobys reales Verhältnis aus dem Triple-Barrier-
  Test, hier ohne Hebel-Umrechnung direkt als Kursbewegung)
- Max. Haltedauer 192 Bars = 48h (vertikale Barriere)
- Trailing-Exit-Logik: sobald TP berührt wird, läuft ein Trailing-Fenster bis zum Ende der
  48h; erste Kerze, die um 0,25% vom bisherigen Peak seit TP-Touch zurückfällt, schließt die
  Position (`TRAIL_EXIT`). Fällt kein solcher Rücksetzer innerhalb des Fensters, wird die
  letzte Kerze des Fensters als Fallback verwendet (`OPEN_AT_HORIZON`)
- Tie-Break bei SL+TP in derselben Kerze: SL gewinnt (konservativ, wie beim Triple-Barrier-
  Test)
- `mfe_pct` bei SL-Ausgängen = tatsächliches Kerzentief/-hoch der auslösenden Kerze (nicht
  der nominelle SL-Preis) — siehe Abschnitt 4, das ist der zentrale Befund dieser Auswertung

**Backfill:** in 2-Wochen-Chunks je Richtung eingefügt (101 Chunks nach der initialen
Stichprobe), da Einzelabfragen über größere Zeitfenster wiederholt an ein 60s-Tool-Timeout
liefen — Details dazu unten unter "Technische Anmerkung".

**Vollständigkeit geprüft:** LONG und SHORT je 70.080 distinkte Signal-Zeitpunkte,
identischer Min/Max-Bereich (2024-09-04 00:00 bis 2026-09-03 23:45) — keine Lücken.

## 3. Ergebnis: Outcome-Verteilung (voller 2-Jahres-Datensatz)

| Richtung | Ausgang | n | Anteil | Ø MFE | Ø Dauer |
|---|---|---|---|---|---|
| LONG | SL | 53.446 | 76,3% | -0,69% | 5,7h |
| LONG | TRAIL_EXIT | 15.340 | 21,9% | +2,00% | 12,5h |
| LONG | TIMEOUT | 1.292 | 1,8% | — | — |
| LONG | OPEN_AT_HORIZON | 2 | 0,003% | +1,78% | 47,8h |
| SHORT | SL | 54.029 | 77,1% | -0,70% | 5,9h |
| SHORT | TRAIL_EXIT | 15.205 | 21,7% | +2,04% | 11,1h |
| SHORT | TIMEOUT | 846 | 1,2% | — | — |

**TP-Touch-Rate** (TRAIL_EXIT + OPEN_AT_HORIZON) liegt bei ~21,8% beider Richtungen — bei
CRV 3,5:1 (TP 1,75% / SL 0,5%) beträgt die rechnerische Gewinnschwelle 1/(1+3,5) = 22,2%.
Die reinen Barrieren liegen also fast exakt auf Breakeven, dieselbe Beobachtung wie beim
Triple-Barrier-Test mit Tobys realen Werten. Der einzige mögliche Edge kommt aus dem
Trailing selbst: realisierter Ø-Gewinn bei TRAIL_EXIT (+2,00% / +2,04%) liegt spürbar über
dem nominellen TP (1,75%) — Trailing fängt tatsächlich zusätzlichen MFE ein, wie in der
Ausgangs-Stichprobe erwartet.

`OPEN_AT_HORIZON` (2 Fälle, 0,003%): TP wurde berührt, aber der Kurs lief bis zum 48h-Fenster-
Ende durch, ohne auch nur 0,25% vom Hoch zurückzugeben — reiner Rand-Fall starker Trends,
statistisch vernachlässigbar.

## 4. Kernbefund: Erwartungswert kippt je nach Ausführungs-Annahme

Der SL-Preis ist bei 0,5% definiert. `mfe_pct` bei SL-Ausgängen protokolliert aber nicht
diesen Preis, sondern das tatsächliche Tief/Hoch der 15m-Kerze, die den Stop zuerst berührt
hat — weil aus 15m-OHLC-Daten nicht rekonstruierbar ist, an welchem Punkt innerhalb der
Kerze der Kurs die Marke gekreuzt hat.

**Verteilung der SL-Ausgänge (statt nur Durchschnitt):**

| Richtung | Median | p05 | p01 | Schlechtester Wert |
|---|---|---|---|---|
| LONG | -0,61% | -1,12% | -1,75% | -9,47% |
| SHORT | -0,62% | -1,15% | -1,68% | -5,75% |

**Erwartungswert pro abgeschlossenem Trade** (SL + TRAIL_EXIT, ohne TIMEOUT), unter zwei
Annahmen:

| Richtung | Theoretisch (SL fix bei -0,5%) | Real (Kerzentief/-hoch) | Differenz |
|---|---|---|---|
| LONG | +0,058% | -0,089% | -0,147 Pp |
| SHORT | +0,059% | -0,094% | -0,153 Pp |

Unter der Annahme eines exakt gefüllten Stops ist der Erwartungswert leicht positiv. Unter
der Annahme, dass der Stop erst am Kerzentief/-hoch auslöst, ist er **negativ** — die
gesamte Kante aus Abschnitt 3 wird aufgezehrt.

**Wichtig: das ist überwiegend kein Crash-Tail-Effekt, sondern ein strukturelles
Auflösungs-Artefakt.** Aufschlüsselung des Zusatzverlusts gegenüber dem theoretischen Stop:

| Richtung | n (SL) | Zusatzverlust gesamt (Pp-Summe) | davon aus Trades <-2% | Anteil |
|---|---|---|---|---|
| LONG | 53.446 | -10.127 | -706 | 7,0% |
| SHORT | 54.029 | -10.587 | -577 | 5,5% |

Nur 5,5-7% des gesamten Effekts stammt aus den echten Extremfällen (<-2%, ca. 0,5-0,6% aller
SL-Trades). Der überwiegende Teil (93-95%) ist der breite, gewöhnliche Überschuss: bei einer
15m-Kerze, die den Stop auslöst, ist es der Normalfall, dass die Kerze schon ein Stück über
die Marke hinausgelaufen ist, bevor sie schließt (Median-Überschuss ~0,11-0,12
Prozentpunkte pro Trade) — kein Ausreißer-, sondern ein Auflösungsproblem der 15m-Simulation.

**Die echten Tail-Ereignisse existieren trotzdem** und häufen sich an identifizierbaren
Tagen (Auszug, sortiert nach schlechtestem Wert):

| Datum | Richtung | Anzahl Extremfälle (<-1,5%) | Schlechtester Wert |
|---|---|---|---|
| 2025-10-10 | LONG | 10 | -9,47% |
| 2024-12-05 | LONG | 7 | -8,91% |
| 2025-01-20 | LONG | 10 | -5,43% |
| 2025-11-21 | LONG | 11 | -5,12% |
| 2025-08-24 | LONG | 38 | -3,73% |

Diese Tage sind vermutlich echte Liquidations-Kaskaden/Flash-Crashes — separates,
identifizierbares Tail-Risiko, aber eben nicht die Hauptursache des Effekts aus Abschnitt 4.

## 5. Einordnung

- **Kein Signifikanztest, sondern eine Ausführungs-Sensitivitätsanalyse.** Anders als die
  bisherigen Session-Ergebnisse geht es hier nicht um "gibt es einen Edge", sondern um "wie
  stabil ist die Aussage über die Annahme hinweg, wie ein Stop gefüllt wird".
- **Die Wahrheit liegt vermutlich zwischen den beiden Polen.** Ein realer Stop-Market-Order
  würde weder exakt bei -0,5% (zu optimistisch) noch systematisch am vollen 15m-Kerzentief
  (pessimistischster Fall, überschätzt Slippage bei normaler Marktlage) gefüllt. Um das enger
  einzugrenzen, bräuchte es feinere Daten (1m-Kerzen) für die tatsächliche Kreuzungspreis-
  Berechnung — liegen in diesem Projekt aktuell nicht vor (nur 15m/1h/4h/1d).
- **Nicht enthalten:** Trading-Gebühren, Funding-Kosten, Hebel-Umrechnung, Tobys realer
  Teil-Exit-Mechanismus. Bei einem bereits ohne diese Kosten negativen bis knapp-neutralen
  Erwartungswert würden Gebühren/Funding die Lage tendenziell weiter verschlechtern, nicht
  verbessern.
- **Konsistent mit dem Triple-Barrier-Befund:** dort wie hier liegt die reine TP/SL-Barriere
  nahe am rechnerischen Breakeven — ein Edge entsteht (falls überhaupt) erst durch einen
  zusätzlichen Filter (dort MTF-Alignment) bzw. hier durch den Trailing-Mechanismus, und
  genau dieser schmale Vorteil ist es, der durch die SL-Ausführungsfrage wieder aufgezehrt
  wird.

## 6. Technische Anmerkung: Backfill-Mechanik

Der 2-Jahres-Backfill (101 Chunks à 2 Wochen/Richtung) lief zunächst in einzelne
Timeout-Probleme: Mehrfach-Chunk-Batches (>60s) und — durch einen eigenen Fehler —
zwei identische, parallel abgesetzte Queries blockierten sich gegenseitig über den
UNIQUE-Constraint auf `signal_time`, sichtbar in `pg_stat_activity` als eine aktive und eine
auf `transactionid` wartende Session. Nach Abbruch der hängenden Backends lief ein sauberer
Einzel-Chunk (1 Richtung, 14 Tage) in ~30s durch. Der Rest wurde danach strikt seriell (ein
Chunk nach dem anderen, kein Batching, keine parallelen Aufrufe) eingefügt — ohne weitere
Zwischenfälle bis auf einen einzelnen Timeout, der sich beim Nachprüfen als noch laufende,
letztlich erfolgreiche Query herausstellte.

## 7. Für Nexus / für Toby

- Kein automatisches Handelssignal, keine Änderung an der laufenden App — reine Forschung.
- Die zentrale Erkenntnis ist praktisch relevant für dein reales Trading: dein Broker/Exchange
  entscheidet, wie ein Stop-Market-Order in schnellen Bewegungen tatsächlich gefüllt wird.
  Wenn du beobachtest, dass deine eigenen Stops regelmäßig spürbar schlechter als der
  eingestellte Preis füllen, ist das nicht ungewöhnlich — es ist strukturell zu erwarten,
  besonders bei 0,5% engen Stops auf 15m-Bewegungen.
- Die offene Frage aus der ersten Fassung dieses Dokuments ("1m-Kerzen nachladen, um den
  tatsächlichen Kreuzungspreis zu berechnen") wurde umgesetzt — siehe Abschnitt 8.

## 8. Nachtrag: 1m-Verfeinerung der SL-Slippage-Frage

**Vorgehen:** BTCUSDT-1m-Kerzen für den vollen Zeitraum (2024-09-04 bis 2026-09-04,
1.051.201 Zeilen) nachgeladen (`backfill-history` Edge Function um `"1m"` erweitert,
bewusst ohne `market_features`-Berechnung für dieses Intervall — kein Indikator-Set dafür
angefragt). Für jede SL-Zeile ist `resolution_time` exakt die 15m-Kerze, die den Stop zuerst
berührt hat — bekannt, muss nicht neu gesucht werden. Neue Spalte `mfe_pct_1m`: für jede
SL-Zeile die ersten (chronologisch frühesten) der bis zu 15 zugehörigen 1m-Kerzen gesucht,
die die SL-Marke tatsächlich kreuzt, und deren Tief/Hoch statt des 15m-Kerzentiefs verwendet.

**Abdeckung:** 107.457 von 107.475 SL-Zeilen (99,98%) erfolgreich verfeinert. Die 18 fehlenden
Zeilen (alle LONG, alle mit `resolution_time` am 2026-09-04 zwischen 01:15 und 08:00 Uhr) liegen
außerhalb des 1m-Datenfensters, das exakt bis 2026-09-04 00:00 Uhr reicht — ein Randeffekt der
gewählten 1m-Backfill-Grenze, kein Fehler in der Berechnung.

**Ergebnis — Verteilung schrumpft deutlich:**

| Richtung | Kennzahl | 15m-Auflösung | 1m-Auflösung |
|---|---|---|---|
| LONG | Ø | -0,69% | -0,57% |
| LONG | Median | -0,61% | -0,54% |
| LONG | p01 | -1,75% | -0,98% |
| LONG | Schlechtester Wert | -9,47% | -2,35% |
| LONG | Anteil <-2% | 0,60% | 0,03% |
| SHORT | Ø | -0,70% | -0,58% |
| SHORT | Median | -0,62% | -0,54% |
| SHORT | p01 | -1,68% | -1,05% |
| SHORT | Schlechtester Wert | -5,75% | -2,79% |
| SHORT | Anteil <-2% | 0,50% | 0,04% |

Der Median liegt jetzt nur noch ~0,04 Prozentpunkte über dem theoretischen -0,5%-Stop (vorher
~0,11 Pp bei 15m) — der Großteil des in Abschnitt 4 beschriebenen "gewöhnlichen Überschusses"
war tatsächlich ein Auflösungsartefakt der 15m-Simulation. Ein Rest-Tail bleibt aber auch bei
1m-Auflösung bestehen (schlechtester Fall weiterhin -2,35%/-2,79%, statt -0,5% wie ein exakter
Stop) — das ist jetzt näherungsweise echtes Slippage-Risiko, keine Simulationsungenauigkeit mehr.

**Der entscheidende Vergleich — Erwartungswert:**

| Richtung | Theoretisch (-0,5% fix) | 15m-Auflösung | 1m-Auflösung |
|---|---|---|---|
| LONG | +0,058% | -0,089% | **+0,002%** |
| SHORT | +0,059% | -0,094% | **-0,004%** |

Die 1m-verfeinerte Antwort liegt fast exakt zwischen den beiden Polen aus Abschnitt 5 —
praktisch bei null, weder klar positiv noch klar negativ. Das bestätigt die dort formulierte
Vermutung direkt: der 15m-Wert war zu pessimistisch (Auflösungsartefakt), der theoretische Wert
zu optimistisch (ignoriert jede Ausführungsrealität) — die ehrliche Antwort ist ein Setup ohne
nachweisbaren Erwartungswert-Vorteil, weder klar profitabel noch klar unprofitabel, sobald
realistische Ausführung berücksichtigt wird.

**Einordnung:** Das ist weiterhin keine Tick-genaue Ausführungssimulation (1m ist immer noch
1440x gröber als eine reale Order-Ausführung), aber eine 15-fach feinere Annäherung als zuvor.
Die verbleibende Differenz zum theoretischen Wert (~0,06 Pp) lässt sich plausibel als reales,
nicht weiter reduzierbares Slippage-Risiko interpretieren, nicht als Backtest-Artefakt.

**Neue DB-Objekte:** `research_swing_setup_events()` (Funktion), `research_swing_setup_results`
(Tabelle, 140.160 Zeilen: LONG 70.080 + SHORT 70.080, plus Spalte `mfe_pct_1m` aus Abschnitt 8),
BTCUSDT-1m-Kerzen in `candles` (1.051.201 Zeilen, 2024-09-04 bis 2026-09-04).
