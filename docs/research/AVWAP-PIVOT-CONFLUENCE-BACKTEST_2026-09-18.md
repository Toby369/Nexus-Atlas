# AVWAP-Pivot-Konfluenz-Rejection: Backtest — 2026-09-18

> **Korrektur 19.09.2026:** Toby hat klargestellt, dass "Toby Setup" kein einzelnes Setup ist,
> sondern 4 benannte Standards mit fixem SL 10% und variabler TP-Distanz (Standard 1/Referenz:
> TP 35%, CRV 3,5:1 — Standard 2: TP 30%, CRV 3:1 — Standard 3: TP 25%, CRV 2,5:1 — Standard 4:
> TP 20%, CRV 2:1; siehe `knowledge_base` module='mein_system'). Dieser Bericht testet mit TP 30%
> tatsächlich **Standard 2**, nicht den Referenz-Standard (Standard 1). Die Zahlen unten sind
> unverändert korrekt — nur die ursprüngliche Bezeichnung "Tobys exaktes Setup" war irreführend.

## 1. Fragestellung

Toby verwirft explizit die "jede Kerze ist ein Signal"-Methodik der bisherigen Toby-Setup-Reports
(`TOBY-SETUP-TRAILING-BACKTEST_2026-09-18.md`) als Grundlage für eine Rentabilitätsaussage — er
sucht stattdessen einen konkreten, GEFILTERTEN Indikator/Signal, der in Kombination mit seinem
Setup (20x, 10 USDT Marge, SL 10%/TP 30%, Trailing-Rücksetzer 10% Marge) profitabel ist. Sein
eigener Vorschlag (wörtlich): ein Indikator, der **AVWAP-Linien von Pivots** eigenständig markiert;
diese werden angetestet ("retest"), und der Kurs läuft anschließend in die ENTGEGENGESETZTE
Richtung — sinngemäß eine Unterstützungs-/Widerstands-Ablehnung an solchen Pivot-AVWAP-Linien.
Gewünschte Zeitebenen: 15m/5m/1h, auf Basis von Schlusskursen ("close").

**Klärung der offenen Designfragen (per Nachfrage, 18.09.2026 — im Gegensatz zum Toby-Setup-
Baseline gibt es für dieses Konzept kein bereits etabliertes Vorbild im Code, daher drei echte
offene Entscheidungen):**
- **Pivot-Länge**: kurz (3 Bars links/rechts) — reagiert schneller auf lokale Hoch-/Tiefpunkte.
- **Rejection-Regel**: eine einzelne Docht-Kerze reicht (Hoch/Tief berührt die Linie, Schluss
  bleibt auf der Ursprungsseite) — keine zusätzliche Bestätigungskerze verlangt.
- **AVWAP-Persistenz**: **mehrere AVWAP-Linien gleichzeitig aktiv (Konfluenz)** — Toby wählte hier
  explizit die komplexere, NICHT empfohlene Option gegenüber "nur die letzte PH/PL-Linie aktiv"
  (das in LSOB/Old-Money-Stack übliche Muster). Mehrere historische Pivot-Linien bleiben also
  gleichzeitig als potenzielle Unterstützung/Widerstand im Rennen, bis sie durch einen
  Kerzenschluss auf der anderen Seite invalidiert werden.

## 2. Methodik

### 2.1 Signal-Engine (`research-python/avwap_pivot_setup/avwap_engine.py`)

Komplett neu gebaut — anders als beim Toby-Setup-Baseline gab es hierfür keine existierende
SQL-RPC zum Portieren. Ablauf pro Kerze:

1. Bereits aktive AVWAP-Linien (Widerstand-Liste, Unterstützung-Liste) werden mit der aktuellen
   Kerze fortgeschrieben (`cum(typical_price × volume) / cum(volume)` ab dem jeweiligen
   Anker-Pivot, `typical_price = (H+L+C)/3`).
2. **Rejection-Check**: berührt der Kerzen-Wick (High/Low) eine oder mehrere aktive Linien,
   während der Schlusskurs auf der Ursprungsseite bleibt → Signal in die Gegenrichtung. Bei
   mehreren gleichzeitig berührten Linien derselben Seite zählt die NÄCHSTGELEGENE als
   Referenz-Level, die Anzahl weiterer berührter Linien wird als `confluence_count` mitgeführt.
3. **Invalidierung**: eine Widerstandslinie fällt aus der aktiven Liste, sobald eine Kerze darüber
   SCHLIESST (symmetrisch für Unterstützung) — das begrenzt die Listengröße zusätzlich zu einem
   harten Cap (`max_active_lines_per_side = 5`).
4. Neu bestätigte Pivots (3 Bars links/rechts auf Basis des Schlusskurses, `pivot_high`/
   `pivot_low`) werden NACH dem Signal-Check dieser Kerze der aktiven Liste hinzugefügt — ein
   Pivot, der auf Kerze `i` bestätigt (also bei `i+3` sichtbar) wird, kann frühestens ab Kerze
   `i+4` selbst ein Signal auslösen (kein Lookahead), auch wenn seine kumulierte Volumensumme
   rückwirkend bis zur Anker-Kerze reicht.

18 Unit-Tests (`tests/test_avwap_engine.py`, `tests/test_backtest.py`, `tests/test_pivots.py`,
`tests/test_metrics.py`) decken Pivot-Erkennungsverzögerung, Rejection-Signale (LONG/SHORT
symmetrisch), Konfluenz-Zählung, Invalidierung und Cap-Verdrängung anhand handverifizierter
OHLCV-Sequenzen ab.

### 2.2 Trade-Management (`backtest.py`)

Wiederverwendung der bereits validierten Toby-Setup-Exit-Logik (SL/TP-Barriere, danach
Trailing-Rücksetzer ab TP-Berührung, realistischer SL-Fill am tatsächlichen Kerzentief/-hoch statt
am nominellen SL-Preis), aber parametrisiert für die gefilterten AVWAP-Signale statt für jede
Kerze:

- 20x Hebel, FIX 10 USDT Marge/Trade (Notional 200 USDT) — Tobys wörtliche Beschreibung, NICHT
  wie bei LSOB/OMS ein %-Risiko vom laufenden Equity. Der $-Equity-Verlauf ist dadurch additiv,
  nicht compoundierend.
- TP 1,5% / SL 0,5% (CRV 3:1, aus 30%/10% Marge bei 20x)
- Trailing-Rücksetzer 0,5% vom Peak seit TP-Berührung (aus 10% Marge bei 20x)
- Max. Haltedauer 48h (192 Bars bei 15m, 576 bei 5m, 48 bei 1h)
- Fees: 0,06%/Seite, 0,12% Round-Trip auf die Notional (= 0,24 USDT/Trade), gleiche Annahme wie
  in allen bisherigen Backtests dieser Session
- Entry = Schlusskurs der Signal-Kerze, Scan beginnt an der Folgekerze

**Anders als beim "jede Kerze"-Baseline** ist hier eine echte SEQUENZIELLE $-Equity-Kurve
sinnvoll (Start 10.000 USDT) — die Signalmenge ist durch die Konfluenz-Filterung deutlich kleiner,
es liegen keine Tausende gleichzeitig offenen hypothetischen Positionen vor.

### 2.3 Daten

BTCUSDT, volle verfügbare Historie aus Nexus Atlas' Supabase-`candles`-Tabelle (inkl. Volumen,
Voraussetzung für AVWAP):

| TF | Kerzen | Zeitraum | Tage |
|---|---|---|---|
| 5m | 213.196 | 2024-09-04 bis 2026-09-14 | ~740 (5m-Historie reicht nicht so weit zurück) |
| 15m | 141.668 | 2022-09-04 bis 2026-09-18 | ~1.475 |
| 1h | 35.422 | 2022-09-04 bis 2026-09-18 | ~1.475 |

Alle drei Datensätze auf Lücken-/Duplikatfreiheit geprüft (0 Duplikate, 0 fehlende Bars bei
erwartetem Kerzenabstand).

## 3. Ergebnis

### 3.1 Signalhäufigkeit

| TF | Signale gesamt | LONG | SHORT | Signale/Tag |
|---|---|---|---|---|
| 5m | 41.490 | 20.606 | 20.884 | **56,1** |
| 15m | 32.452 | 16.496 | 15.956 | **22,0** |
| 1h | 9.573 | 4.935 | 4.638 | **6,5** |

Trotz Filterung (3-Bar-Pivots + Wick-Rejection statt "jede Kerze") bleibt die Signalfrequenz sehr
hoch — selbst auf 1h wären das rechnerisch 6-7 potenzielle Einstiege pro Tag, auf 5m über 50. Das
ist für einen diskretionär ausgeführten Trader praktisch kaum handhabbar; die kurze Pivot-Länge
(3 Bars) erzeugt ein entsprechend dichtes Netz an Pivot-Linien.

### 3.2 Kennzahlen pro Zeitebene/Richtung

| TF | Richtung | Trades | Winrate | Profit Factor | Ø Gewinn | Ø Verlust | Total Return | Endkapital (Start 10.000) |
|---|---|---|---|---|---|---|---|---|
| 5m | LONG | 20.606 | 24,5% | 0,55 | +2,46 USDT | -1,46 USDT | **-103,6%** | -360 USDT |
| 5m | SHORT | 20.884 | 24,2% | 0,53 | +2,47 USDT | -1,50 USDT | **-112,8%** | -1.277 USDT |
| 15m | LONG | 16.496 | 25,3% | 0,52 | +2,55 USDT | -1,65 USDT | **-97,0%** | 305 USDT |
| 15m | SHORT | 15.956 | 22,7% | 0,46 | +2,58 USDT | -1,64 USDT | **-108,7%** | -865 USDT |
| 1h | LONG | 4.935 | 23,8% | 0,46 | +2,81 USDT | -1,92 USDT | **-39,2%** | 6.077 USDT |
| 1h | SHORT | 4.638 | 22,4% | 0,43 | +2,85 USDT | -1,91 USDT | **-39,0%** | 6.098 USDT |

Winrate = Anteil `trail_exit`-Ausgänge (jeder TP-Touch mündet unter diesen Parametern zwangsläufig
in einem Gewinn-Exit, siehe 2.2 und `backtest.py`-Kommentar: Rücksetzer 0,5% < TP 1,5% bedeutet der
Trail-Exit-Preis liegt immer über/unter dem Entry). Restliche Ausgänge sind SL (73-77% der Trades)
plus ein kleiner Rest `end_of_data`/`open_at_horizon` (<1,5%, an den Datensatzenden).

**Konfluenz-Effekt** (`confluence_count` > 1, d.h. mehrere Linien gleichzeitig berührt): mit 0,2-2%
der Signale zu selten (n=4 bis n=514 je Bucket) für eine belastbare Aussage — die beobachteten
Winrate-Unterschiede zu `confluence_count=1` sind uneinheitlich (mal höher, mal niedriger) und
liegen im Rauschen. Kein belastbarer Hinweis, dass Konfluenz-Zonen (Tobys explizit gewählte
komplexere Variante) einen Vorteil gegenüber einer einzelnen Linie bieten.

## 4. Kernbefund: Gleiches Muster wie beim ungefilterten Baseline — Winrate knapp unter der
   Gewinnschwelle, keine positive Kante

Die rechnerische Gewinnschwelle bei CRV 3:1 (TP 1,5%/SL 0,5%) liegt bei 1/(1+3) = **25,0%**. Alle
sechs Buckets liegen mit 22,4-25,3% knapp AN oder UNTER dieser Schwelle — **exakt dasselbe Muster**
wie beim ungefilterten Toby-Setup-Baseline (dort: 24,5%/23,5% TP-Touch-Rate) und beim
ursprünglichen Triple-Barrier-Test. Die AVWAP-Pivot-Konfluenz-Rejection-Filterung verändert die
grundlegende Erfolgsquote-vs-CRV-Balance NICHT spürbar — sie selektiert lediglich eine kleinere
Teilmenge von Signalen mit näherungsweise derselben Basisrate wie "jede Kerze".

Nach Fees (0,12% Round-Trip = 0,24 USDT/Trade = 2,4% der Marge) kippt der ohnehin knappe
Erwartungswert in allen sechs Buckets klar ins Negative — sichtbar an der durchweg negativen
`Total Return` über den vollen Datensatz. Bei 5m/15m SHORT (und 5m LONG) reicht der kumulierte
Verlust über die Laufzeit sogar aus, das simulierte 10.000-USDT-Startkapital komplett
aufzubrauchen und ins Negative zu drehen — ein realer Account wäre hier liquidiert oder hätte
längst vorher gestoppt, die Zahl dient nur zur Einordnung der Größenordnung, nicht als reale
Kontosimulation bis zum bitteren Ende.

## 5. Kritische Einordnung

- **Kein Train/Test-Split**: wie bei allen bisherigen Backtests dieser Session eine reine
  In-Sample-Basisraten-Messung über den vollen verfügbaren Zeitraum, keine
  Signifikanz-/Robustheitsprüfung über einen Walk-Forward-Split.
- **Pivot-Länge 3 Bars ist die "kurze" (empfohlene) Option** — nicht die einzig mögliche. Ein
  längerer Pivot (z.B. 8-10 Bars) würde deutlich weniger, potenziell "bedeutsamere" AVWAP-Linien
  erzeugen und die Signalfrequenz drastisch senken — das wurde hier NICHT getestet, da Toby sich
  explizit für die kurze Variante entschieden hat. Ebenso wurde die Rejection-Regel als einzelne
  Docht-Kerze ohne Bestätigung gewählt — eine strengere Bestätigungsregel (z.B. zweite Kerze
  bestätigt die Ablehnung) könnte die Trefferquote der einzelnen Signale verändern, wurde hier
  aber nicht geprüft.
- **80/20-Teilexit nicht modelliert** (wie bei allen Toby-Setup-Reports): Tobys reale Praxis
  (80% bei TP realisieren, 20% mit Trailing-Stop weiterlaufen lassen) wird hier als ein
  durchgehender Trade bis zum Trailing-Exit behandelt.
- **Konfluenz-Stichprobe zu klein** für eine belastbare Aussage zur Kernfrage, ob mehrere aktive
  AVWAP-Linien gleichzeitig ein stärkeres Signal liefern (siehe 3.2) — bei der gewählten kurzen
  Pivot-Länge sind echte Mehrfach-Konfluenzen an derselben Kerze schlicht selten.
- **Keine Slippage über die reine Fee-Annahme hinaus**, keine Order-Ablehnung/Teilausführung,
  keine Funding-Kosten (Perpetual-Futures-Funding wurde in keinem Backtest dieser Session
  modelliert).
- **5m-Datensatz kürzer** (~2 Jahre statt ~4) als 15m/1h, da die 5m-Historie in der Datenbank
  nicht weiter zurückreicht — die 5m-Ergebnisse basieren auf einer kleineren Zeitspanne, auch wenn
  die absolute Trade-Anzahl durch die höhere Frequenz größer ist.

## 6. Kurzfazit

Der von Toby vorgeschlagene AVWAP-Pivot-Konfluenz-Rejection-Indikator liefert auf allen drei
getesteten Zeitebenen (5m/15m/1h) eine Trefferquote, die an oder knapp unter der rechnerischen
CRV-3:1-Gewinnschwelle (25%) liegt — nahezu identisch mit der Basisrate des ungefilterten
"jede Kerze"-Baselines. Nach Fees ist der Erwartungswert in allen sechs Zeitebene/Richtung-Buckets
negativ, in mehreren Fällen deutlich genug, um das simulierte Startkapital über die Backtest-Länge
komplett aufzuzehren. Die getestete AVWAP-Konfluenz-Rejection-Idee liefert damit — zumindest in
dieser konkreten Ausprägung (3-Bar-Pivots, einzelne Docht-Kerze, Mehrfach-Linien-Konfluenz) — KEINE
eigenständige positive Kante gegenüber Tobys reiner SL/TP/Trailing-Mechanik. Wie schon beim
Triple-Barrier-Test festgestellt: ein Edge müsste aus einer wirksameren Filterung kommen als der
hier getesteten — die hohe verbleibende Signalfrequenz (6-56/Tag) deutet darauf hin, dass die
Rejection-Regel allein noch zu unspezifisch ist, um echte, seltene, hochwertige Setups von
Rauschen zu trennen.

## 7. Artefakte

- `research-python/avwap_pivot_setup/avwap_engine.py` — Signal-Engine (Pivot-AVWAP-Konfluenz +
  Rejection-Erkennung)
- `research-python/avwap_pivot_setup/backtest.py` — Trade-Auflösung + $-P&L unter Tobys Setup
- `research-python/avwap_pivot_setup/run_backtest.py` — Orchestrierung über 5m/15m/1h
- `research-python/avwap_pivot_setup/tests/` — 19 Unit-Tests (Pivots, Signal-Engine, Backtest,
  Metriken)
- `research-python/avwap_pivot_setup/output/signals_{5m,15m,1h}.csv`,
  `trades_{5m,15m,1h}.csv` — vollständige Einzel-Signal-/Trade-Rohdaten (nicht committed, siehe
  `.gitignore`)

## 8. Update 2026-09-19: Test von Salomons "je mehr Berührungen, desto stärker die Linie"

Anlass: Recherche zu Stefan Salomon (dessen Chartanalyse-Methodik bereits als `knowledge_base`
(module='salomon') in Nexus Atlas hinterlegt ist — siehe neu ergänzter Eintrag "Käufer-/
Verkäuferzonen (Unterstützung/Widerstand)") ergab sein zentrales Trendlinien-Prinzip: **je mehr
Berührungspunkte eine Linie bereits erfolgreich überstanden hat, desto relevanter/stärker gilt sie
als Unterstützung/Widerstand.** Toby bat darum, dieses Prinzip in die AVWAP-Engine einzubauen und
erneut zu backtesten.

**Umsetzung**: Da eine AVWAP-Linie per Konstruktion nur aktiv bleibt, solange sie noch nicht per
Schlusskurs durchbrochen wurde, ist JEDE Berührung, die kein Durchbruch war, bereits eine
erfolgreiche Ablehnung. `avwap_engine.py` zählt deshalb pro Linie (`ActiveLine.touch_count`), wie
oft sie bereits erfolgreich abgelehnt hat, und hält für jedes neue Signal fest, die wievielte
Berührung dieser konkreten Linie es ist (`Signal.line_touch_number`, 1 = allererste Berührung).
Reine Metadaten ohne Rückwirkung auf die Signalerzeugung selbst — ermöglicht aber, Trades nach
`line_touch_number` zu bucketen und Winrate/PnL zu vergleichen. 1 neuer Unit-Test
(`test_line_touch_number_increments_across_repeated_rejections_of_same_line`) verifiziert die
Zählung an einer Linie mit drei aufeinanderfolgenden Ablehnungen.

**Ergebnis** (Winrate nach `line_touch_number`-Bucket, alle drei Zeitebenen zusammengefasst,
n=4.561 bis 41.223 je Bucket):

| Bucket (Berührung Nr.) | n | Winrate | Ø PnL/Trade |
|---|---|---|---|
| 1 (erste Berührung) | 41.223 | 24,0% | -0,60 USDT |
| 2 | 21.612 | 23,9% | -0,61 USDT |
| 3 | 10.876 | 24,5% | -0,58 USDT |
| 4 | 5.243 | 24,5% | -0,59 USDT |
| 5+ | 4.561 | 24,1% | -0,61 USDT |

Gleiches Bild auf jeder einzelnen Zeitebene (5m/15m/1h) einzeln betrachtet. Die Winrate bewegt sich
in allen Buckets innerhalb von ±1 Prozentpunkt um denselben Wert (~24%), OHNE erkennbaren
Aufwärtstrend mit steigender Berührungszahl — Bucket 5+ performt nicht besser als Bucket 1, trotz
großer Stichproben (kein Rauschen-Artefakt). **Salomons Prinzip lässt sich für diese konkrete
AVWAP-Pivot-Konfluenz-Rejection-Definition NICHT bestätigen**: eine Linie, die bereits mehrfach
erfolgreich gehalten hat, ist in diesem Backtest kein zuverlässigeres Signal als eine Linie beim
allerersten Test.

**Einordnung**: das schließt Salomons Prinzip nicht grundsätzlich aus — sein Konzept bezieht sich
auf manuell gezogene Trendlinien (die über die Zeit im Preis-Winkel wandern und deren Berührungen
über Wochen/Monate verstreut sind), während die hier getestete AVWAP-Linie ein statischer,
horizontaler Wert ab einem festen Anker-Pivot ist — eine methodisch andere Definition von
"Linie". Möglich, dass das Prinzip bei einer klassischen (geneigten) Trendlinien-Implementierung
anders ausfällt; das wäre ein eigener, hier nicht durchgeführter Test.

## 9. Artefakte (aktualisiert)

- `research-python/avwap_pivot_setup/avwap_engine.py` — inkl. `touch_count`/`line_touch_number`
  (Abschnitt 8)
- `research-python/avwap_pivot_setup/tests/test_avwap_engine.py` — inkl. neuem Touch-Count-Test
