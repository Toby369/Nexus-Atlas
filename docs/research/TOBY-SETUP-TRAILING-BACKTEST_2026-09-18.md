# Toby Setup mit Trailing-Exit: Backtest — 2026-09-18

> **Korrektur 19.09.2026:** Toby hat klargestellt, dass "Toby Setup" kein einzelnes Setup ist,
> sondern 4 benannte Standards mit fixem SL 10% und variabler TP-Distanz (Standard 1/Referenz:
> TP 35%, CRV 3,5:1 — Standard 2: TP 30%, CRV 3:1 — Standard 3: TP 25%, CRV 2,5:1 — Standard 4:
> TP 20%, CRV 2:1; siehe `knowledge_base` module='mein_system'). Dieser Bericht testet mit TP 30%
> tatsächlich **Standard 2**, nicht den Referenz-Standard (Standard 1). Die Zahlen unten sind
> unverändert korrekt — nur die ursprüngliche Bezeichnung "Tobys exaktes Setup" war irreführend.

## 1. Fragestellung

Anlass: Toby bittet konkret darum, sein reales Setup (20x Hebel, ~10 USDT Einsatz, SL 10%,
TP 30% der Marge) im Backtesting herauszufiltern und unter "Toby Setup" zu speichern — diesmal
mit einer Erweiterung gegenüber dem ursprünglichen Triple-Barrier-Test
(`TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md`): Setups, die über TP hinaus weiterlaufen, bleiben
gültig, bis vom Höhepunkt in Traderichtung ein Rücksetzer erfolgt — Wiedereinstieg jederzeit
möglich.

**Klärung der Parameter (per Nachfrage, 18.09.2026):**
- Signalquelle: alle Kerzen ungefiltert (wie Phase 1 des Triple-Barrier-Tests) — kein
  Entry-Filter, LONG und SHORT an jeder Kerze getestet.
- Rücksetzer-Bezug: 10% Marge/ROI bei 20x Hebel (analog zu SL 10%/TP 30%), NICHT 5% reine
  Kursbewegung wie ursprünglich geschrieben — Toby hat das in der Rückfrage präzisiert.
- Trailing-Mechanik: TP 30% bleibt der fixe erste Meilenstein; danach läuft die Position weiter
  bis zum Rücksetzer (modelliert Tobys reale Praxis "80% TP + 20% mit nachgezogenem SL laufen
  lassen", ohne den literalen 80/20-Split selbst nachzubilden — siehe Abschnitt 2).
- Wiedereinstieg: jede Kerze ist ohnehin unabhängig ein neues Signal, kein Cooldown nötig.

**Umrechnung von Tobys Setup:** SL 10% / TP 30% / Rücksetzer 10% = % des Einsatzes/Margin bei
20x Hebel → **SL bei -0,5% Kursbewegung, TP bei +1,5%, Trailing-Rücksetzer bei 0,5% vom
bisherigen Hoch/Tief seit TP-Berührung.** CRV (TP:SL) = 3:1.

## 2. Methodik

Direkte Erweiterung der bereits etablierten `research_swing_setup_events()`-RPC (siehe
`SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md`) — **exakt derselbe Algorithmus**, nur mit Tobys
eigenen Zahlen statt der dortigen Annäherung (TP 1,75%/SL 0,5%, CRV 3,5:1). Da selbst ein
1-Monats-Fenster dieser RPC am 60-Sekunden-Tool-Timeout des SQL-Interfaces scheitert (der
Lateral-Join pro Signal ist teuer, unabhängig von der Fenstergröße), wurde die Logik 1:1 nach
Python portiert (`research-python/toby_setup/toby_setup_engine.py`) und gegen die **publizierten
Ergebnisse** des SWING-SETUP-TRAILING-Reports validiert: mit dessen Parametern (TP 1,75%/SL
0,5%/Rücksetzer 0,25%/192 Bars) auf demselben 2-Jahres-Fenster reproduziert der Python-Port die
dortigen Zahlen fast exakt (TRAIL_EXIT-Anzahl LONG exakt identisch: 15.340; SL/TIMEOUT-Anzahlen
weichen um < 0,15% ab, konsistent mit einer minimal unterschiedlichen Kerzen-Grundmenge, kein
Logikfehler).

**Setup-Parameter:**
- Intervall: 15m, BTCUSDT, voller verfügbarer Datensatz **2022-09-04 bis 2026-09-18** (~4 Jahre,
  141.668 Kerzen — deutlich mehr als die 2 Jahre der Vorgänger-Reports, da keine Abhängigkeit
  von 1m/5m-Datenverfügbarkeit besteht)
- Entry = Open der nächsten Kerze nach Signal (kein Lookahead), jede 15m-Kerze als Signal, LONG
  und SHORT getrennt
- TP 1,5% / SL 0,5% (CRV 3:1, Tobys exaktes Verhältnis)
- Max. Haltedauer 192 Bars = 48h (vertikale Barriere, gleiche Konvention wie beide
  Vorgänger-Reports)
- Trailing-Exit-Logik: sobald TP berührt wird, läuft ein Trailing-Fenster bis zum Ende der 48h;
  erste Kerze, die 0,5% vom bisherigen Peak seit TP-Berührung zurückfällt, schließt die Position
  (`TRAIL_EXIT`). Fällt kein solcher Rücksetzer innerhalb des Fensters, wird die letzte Kerze des
  Fensters als Fallback verwendet (`OPEN_AT_HORIZON`)
- Tie-Break bei SL+TP in derselben Kerze: SL gewinnt (konservativ, wie bei allen bisherigen
  Tests dieser Session)
- `mfe_pct` bei SL-Ausgängen = tatsächliches Kerzentief/-hoch der auslösenden Kerze (nicht der
  nominelle SL-Preis) — wie im SWING-SETUP-TRAILING-Report zentral herausgearbeitet

**Was NICHT modelliert wurde (Vereinfachung, wie in beiden Vorgänger-Reports):** Tobys realer
80/20-Teilexit (80% der Position bei TP realisieren, nur 20% mit Trailing-Stop weiterlaufen
lassen) wird hier als EIN durchgehender Trade behandelt, der komplett bis zum Trailing-Exit
läuft. Das überzeichnet tendenziell sowohl die Trailing-Gewinne als auch das Zeit-im-Markt-Risiko
gegenüber der realen 80/20-Praxis — in welche Richtung sich das per Saldo auf den Erwartungswert
auswirkt, ist nicht eindeutig und wird hier nicht quantifiziert.

## 3. Ergebnis: Outcome-Verteilung (voller ~4-Jahres-Datensatz)

| Richtung | Ausgang | n | Anteil | Ø MFE | Ø Dauer |
|---|---|---|---|---|---|
| LONG | SL | 104.943 | 74,08% | -0,72% | 5,6h |
| LONG | TRAIL_EXIT | 34.721 | 24,51% | +1,88% | 10,1h |
| LONG | TIMEOUT | 1.930 | 1,36% | — | — |
| LONG | OPEN_AT_HORIZON | 73 | 0,05% | +1,77% | 47,8h |
| SHORT | SL | 106.898 | 75,46% | -0,72% | 5,7h |
| SHORT | TRAIL_EXIT | 33.333 | 23,53% | +1,88% | 9,3h |
| SHORT | TIMEOUT | 1.431 | 1,01% | — | — |
| SHORT | OPEN_AT_HORIZON | 5 | 0,004% | +1,61% | 47,8h |

**TP-Touch-Rate** (TRAIL_EXIT + OPEN_AT_HORIZON) liegt bei 24,56% (LONG) bzw. 23,53% (SHORT) —
bei CRV 3:1 (TP 1,5% / SL 0,5%) liegt die rechnerische Gewinnschwelle bei 1/(1+3) = **25,00%**.
Beide Richtungen liegen damit knapp UNTER der Gewinnschwelle der reinen Barriere — anders als
beim ursprünglichen Triple-Barrier-Test (dort lag die Basisrate fast exakt AUF der Schwelle).

Realisierter Ø-Gewinn bei TRAIL_EXIT (+1,88% beide Richtungen) liegt spürbar über dem nominellen
TP (1,5%) — das Trailing fängt tatsächlich zusätzlichen MFE ein, wie im Vorgänger-Report
gefunden, nur mit dem hier verwendeten engeren 0,5%-Rücksetzer (statt 0,25%) etwas weniger
ausgeprägt relativ zum größeren TP-Abstand.

## 4. Kernbefund: Erwartungswert kippt je nach Ausführungs-Annahme (bestätigt sich erneut)

Gleicher Effekt wie im SWING-SETUP-TRAILING-Report, hier mit Tobys exakten Parametern neu
geprüft:

**Verteilung der SL-Ausgänge (statt nur Durchschnitt):**

| Richtung | Median | p05 | p01 | Schlechtester Wert |
|---|---|---|---|---|
| LONG | -0,62% | -1,26% | -1,93% | -11,14% |
| SHORT | -0,62% | -1,23% | -1,91% | -11,82% |

**Erwartungswert pro abgeschlossenem Trade** (SL + TRAIL_EXIT + OPEN_AT_HORIZON, ohne TIMEOUT),
unter zwei Annahmen:

| Richtung | Theoretisch (SL fix bei -0,5%) | Real (Kerzentief/-hoch) | Differenz |
|---|---|---|---|
| LONG | +0,093% | -0,072% | -0,165 Pp |
| SHORT | +0,066% | -0,099% | -0,165 Pp |

Unter der Annahme eines exakt gefüllten Stops ist der Erwartungswert leicht positiv. Unter der
realistischeren Annahme, dass der Stop erst am Kerzentief/-hoch der auslösenden 15m-Kerze
auslöst (aus OHLC-Daten nicht anders rekonstruierbar), ist er **negativ** — dieselbe
strukturelle Beobachtung wie im Vorgänger-Report: der überwiegende Teil ist kein Crash-Tail-
Effekt, sondern der gewöhnliche Fall, dass eine 15m-Kerze, die den Stop auslöst, im Schnitt schon
ein Stück über das nominelle Level hinausgelaufen ist, bevor die Kerze schließt.

## 5. Einordnung in Hebel-/Margin-Begriffen

Die obigen Zahlen sind reine Kursbewegungs-Prozent (wie in Abschnitt 2 hergeleitet: 20x Hebel
skaliert 1:1 auf Marge-ROI hoch). Der reale Erwartungswert pro Trade in **Marge-ROI-Prozent**
(bei 20x, ohne Fees):

| Richtung | EV real (Kursbewegung) | EV real × 20 (Marge-ROI) |
|---|---|---|
| LONG | -0,072% | **-1,45%** |
| SHORT | -0,099% | **-1,97%** |

Dazu kommen reale Taker-Fees: bei 20x Hebel und 10 USDT Marge entspricht die Notional 200 USDT;
0,06%/Seite (0,12% Round-Trip, gleiche Annahme wie in den Python-Backtests dieser Session) macht
0,24 USDT = **2,4% der Marge** pro Trade — unabhängig von Gewinn/Verlust. Damit wird die bereits
negative reale Kante zusätzlich verschlechtert, nicht besser.

## 6. Kritische Einordnung

- **Rein deskriptiv, kein Signalfilter**: wie Phase 1 des Triple-Barrier-Tests wird hier JEDE
  15m-Kerze als hypothetischer Einstieg behandelt — das ist eine Basisraten-Messung von Tobys
  SL/TP/Trailing-Mechanik selbst, keine Bewertung einer Handelsstrategie mit Entry-Timing. Der
  ursprüngliche Triple-Barrier-Report fand genau deshalb später einen Edge über einen
  MTF-Alignment-Filter (Phase 2) — ein äquivalenter Filter wurde hier NICHT angewendet.
- **Kein Train/Test-Split**: reine Basisraten-Messung über den vollen ~4-Jahres-Zeitraum, wie
  beide Vorgänger-Reports. Für eine Signifikanzaussage (z.B. "ist der negative EV real oder
  Zufall") wäre eine Split-Analyse wie in Phase 2 des Triple-Barrier-Tests nötig — hier nicht
  durchgeführt, da die Fragestellung explizit die reine Setup-Mechanik betraf.
- **80/20-Teilexit nicht modelliert** (siehe Abschnitt 2) — Tobys reale Praxis könnte hiervon in
  unbekannter Richtung abweichen.
- **Keine Fees/Funding in Abschnitt 3-4**, erst in Abschnitt 5 grob nachträglich eingeordnet —
  keine kombinierte Equity-Kurve mit compoundierendem Kapital, da bei "jede Kerze ein Signal"
  Tausende überlappende hypothetische Positionen gleichzeitig offen wären — ein reales Konto
  könnte das nicht in dieser Form gleichzeitig halten (gleiche Einschränkung wie in beiden
  Vorgänger-Reports, dort ebenfalls bewusst nicht mit Kapitalverwaltung simuliert).
- **Datenbasis 15m BTCUSDT** (Nexus Atlas' eigene Supabase-`candles`-Tabelle), keine Slippage
  über die reine Fee-Annahme hinaus, keine Order-Ablehnung/Teilausführung.

## 7. Kurzfazit

Unter Tobys exaktem Setup (20x/SL 10%/TP 30%/Trailing-Rücksetzer 10% Marge) liegt die
TP-Touch-Rate knapp unter der rechnerischen Gewinnschwelle (24,5-24,6% vs. 25,0%), und der
Erwartungswert kippt je nach SL-Fill-Annahme von leicht positiv (theoretisch) zu leicht negativ
(realistisch) — bei zusätzlichen Fees (~2,4% Marge/Trade) wird die reale Kante weiter
verschlechtert. Das deckt sich mit dem bereits im Triple-Barrier-Test gefundenen Muster: das
reine SL/TP/Trailing-Verhältnis allein ist annähernd ein Nullsummenspiel, kein eigenständiger
Edge — ein Edge müsste (wie in Phase 2 des Triple-Barrier-Tests gezeigt) aus einem zusätzlichen
Entry-Filter kommen, nicht aus der Positionsmechanik selbst.

## 8. Artefakte

- `research-python/toby_setup/toby_setup_engine.py` — Python-Port der Trailing-Backtest-Logik
- `research-python/toby_setup/run_toby_setup.py` — Orchestrierung mit Tobys exakten Parametern
- `research-python/toby_setup/validate_against_swing_setup.py` — Validierung gegen publizierte
  SWING-SETUP-TRAILING-Zahlen
- `research-python/toby_setup/output/toby_setup_events_{long,short}.csv` — vollständige
  Einzel-Trade-Rohdaten (nicht committed, siehe `.gitignore`)
