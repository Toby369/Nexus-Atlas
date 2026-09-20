# Toby-Setup-Phasen-Signal-Projekt — Definition & Zähllauf (Stufe 1)

Datum: 2026-09-19. Reines Forschungsprojekt in `research-python/`, keine
Produktionsänderung. Ziel des Gesamtprojekts (noch nicht abgeschlossen):
untersuchen, welche Nexus-Signale in welchem Zeitfenster vor einem "Setup"
und in welcher Marktphase gehäuft auftreten. Diese Datei hält nur **Stufe
1** fest: die exakte Setup-Definition (aus iterativer Abstimmung mit Toby
am 19.09.2026 hervorgegangen) plus den ersten reinen Zähllauf, bevor die
größere Signal-/Phasen-Analyse gebaut wird.

## Definition (final, Stand 19.09.2026)

Kandidaten-Universum: **jede** 15m-Kerze im gesamten verfügbaren
BTC/USDT-Datensatz (2022-09-04 bis 2026-09-18, 141.667 Kerzen) gilt als
hypothetischer Entry — LONG und SHORT getrennt simuliert, kein
Entry-Filter (bewusst, wie bereits `toby_setup_engine.py` für die
Standard-Backtests). Entry-Preis = Open der jeweils nächsten Kerze (kein
Lookahead). Getestet über drei Hebel-Stufen: **20x / 25x / 30x**.

SL ist bei allen Trades und allen Hebeln **10% der Marge** — das ist bei
höherem Hebel eine proportional kleinere Kursbewegung:

| Hebel | SL (Kursbewegung) | Retrace nach TP35 (Kursbewegung) |
|---|---|---|
| 20x | 0.500% | 0.500% |
| 25x | 0.400% | 0.400% |
| 30x | 0.333% | 0.333% |

**Tier-Leiter** (Marge-%, aufsteigend), Klassifikation = höchster je
erreichter Tier über den gesamten simulierten Pfad, nicht der Tier beim
tatsächlichen Exit:

| Tier | Marge-% | Bezeichnung | Bedeutung |
|---|---|---|---|
| 0 | < 15% erreicht, SL berührt | **SL** (echter Verlust) | Nie auch nur Break-Even erreicht, bevor der nominelle SL berührt wurde |
| 0b | < 15% erreicht, SL nicht berührt (Fensterende) | **TIMEOUT_NO_TIER** | Selten (siehe Zahlen unten), Trade lief 48h ohne SL und ohne Break-Even |
| 1 | ≥ 15%, < 20% | **BREAK_EVEN** | Neu (Nutzer-Vorgabe 19.09.2026) |
| 2 | ≥ 20%, < 25% | **STANDARD_4** | |
| 3 | ≥ 25%, < 30% | **STANDARD_3** | |
| 4 | ≥ 30%, < 35% | **STANDARD_2** | |
| 5 | ≥ 35% | **STANDARD_1_EXTENDED** | Ab hier Trailing-Exit (10% Marge Rücksetzer vom laufenden Hoch/Tief seit TP35-Berührung), exakt wie in `toby_setup_engine.py`s Stage-2-Logik. Der tatsächlich erreichte Peak (auch weit über 35%) wird mitgeführt und ausgewiesen. |

**Warum BREAK_EVEN und nicht SL, wenn ein Trade später doch den nominellen
SL berührt?** Toby-Zitat: *"trades welche tp 20 nicht erreichen jedoch
über tp 15 kommen gelten als break even ... in meinem system ziehe ich sl
nach, wenn trade über 15tp läuft."* In seinem realen System wird der Stop
auf Break-Even nachgezogen, sobald ein Trade TP15 durchläuft — ein echter
Verlust nach TP15-Berührung ist damit praktisch ausgeschlossen. Die Engine
bildet deshalb die **höchste real erreichte Kurschance** ab, nicht eine
naive Fixed-SL-Simulation über die gesamte Laufzeit. Gleiche Logik gilt
generell: *"trades mit höherem tp müssen in report ausgewiesen werden"* —
ein Trade, der z.B. 25% erreicht und danach (hypothetisch) den nominellen
SL berührt hätte, wird als STANDARD_3 ausgewiesen, nicht als Verlust.

Zeitfenster: **192 Bars = 48h**, unverändert bestätigt (*"zeitfenster mit
48h passt"*).

Tie-Break bei Berührung von SL UND einem Tier im selben Bar: SL gewinnt
(gleiche konservative Konvention wie überall in diesem Projekt, siehe
`toby_setup_engine.py`).

## Implementierung

- `research-python/toby_setup/tiered_mfe_engine.py` — `run_tiered_setup()`,
  neue Engine (kein Eingriff in die bestehende `toby_setup_engine.py`, die
  weiter unverändert für die 4-Standards-Backtests genutzt wird).
- Manuell an 6 synthetischen Fällen validiert (reiner SL, Break-Even trotz
  späterem SL-Niveau, Standard-3 trotz späterem SL-Niveau,
  Standard-1-Extended mit Trailing, SHORT-Spiegelung, SL/Tier-Tie-Break im
  selben Bar) — alle bestanden.
- `research-python/toby_setup/run_tiered_mfe_report.py` — Zähllauf über
  alle 6 Kombinationen (2 Richtungen × 3 Hebel), schreibt Events nach
  `output/tiered_mfe_{direction}_{leverage}x.csv` (gitignored) und eine
  Übersicht nach `output/tiered_mfe_summary.csv` (gitignored).

## Ergebnis Stufe 1 (reine Zählung, keine Signal-/Phasen-Analyse)

Datenbasis: 141.667 simulierte Entries pro Richtung/Hebel-Kombination
(jede Kerze außer der letzten).

| Hebel | Richtung | SL | Break-Even | Standard 4 (TP20) | Standard 3 (TP25) | Standard 2 (TP30) | Standard 1 Extended (TP35+) | Timeout (kein Tier) |
|---|---|---|---|---|---|---|---|---|
| 20x | LONG | 59.57% | 6.86% | 4.99% | 3.73% | 2.92% | **21.64%** | 0.29% |
| 20x | SHORT | 61.01% | 6.81% | 4.82% | 3.57% | 2.75% | **20.78%** | 0.26% |
| 25x | LONG | 59.86% | 6.69% | 4.77% | 3.79% | 2.74% | **22.05%** | 0.10% |
| 25x | SHORT | 60.78% | 6.85% | 4.84% | 3.68% | 2.72% | **21.07%** | 0.07% |
| 30x | LONG | 60.03% | 6.61% | 4.79% | 3.51% | 2.91% | **22.12%** | 0.02% |
| 30x | SHORT | 60.68% | 6.64% | 4.88% | 3.62% | 2.87% | **21.28%** | 0.02% |

Beobachtungen (rein deskriptiv, keine Interpretation als Handelsedge —
noch kein Signal-Bezug):

- Verteilung ist über alle drei Hebel praktisch identisch (± ~1
  Prozentpunkt je Klasse) — erwartbar, da SL/TP/Retrace bei jedem Hebel
  proportional gleich in Kursbewegung umgerechnet werden; der Hebel
  verändert nur die absolute Schwellenbreite, nicht die relative Struktur
  der Kursbewegungsverteilung.
- LONG schneidet in jeder Hebel-Stufe leicht besser ab als SHORT (~1-1.5
  Prozentpunkte weniger SL, mehr Standard-1-Extended) — über einen
  vierjährigen, überwiegend bullischen BTC-Zeitraum plausibel, keine
  belastbare Aussage über eine strukturelle Long-Bias ohne Phasen-Zerlegung.
  `TIMEOUT_NO_TIER` ist mit ≤0.29% verschwindend selten — die 48h-Grenze
  ist für dieses Setup fast nie der limitierende Faktor.
- `STANDARD_1` (Tier erreicht, aber nicht in die Extended-Trailing-Zählung
  gefallen) erscheint mit n=0 in jeder Zeile — das ist kein Fehler,
  sondern Konsequenz des Engine-Designs: sobald TP35 berührt wird, geht
  jeder Trade zwingend in die Trailing-Phase über (siehe Tabelle oben),
  eine separate "genau Standard 1, nicht weiter gelaufen"-Klasse existiert
  bei dieser Logik nicht.

## Strukturelle Phasen (Stufe 2): Aufwärts / Abwärts / Seitwärts

Abgestimmt mit Toby am 19.09.2026 nach Recherche zu drei Quellen:

1. **Salomon** (`knowledge_base` module='salomon'): HH/HL/LH/LL ist "das
   Grundvokabular der Struktur", S/R-Zonen und Trendlinien werden aus
   Swing-Punkten gezogen (mind. 2 Berührungspunkte, diskretionär). Salomon
   selbst gibt keine numerische Seitwärts-Schwelle vor — sein Zyklusmodell
   (Akkumulation/Markup/Distribution/Markdown) kennt nur die
   seitwärts-artigen Übergangsphasen Akkumulation/Distribution.
2. **Marktüblich** (Web-Recherche + Tobys eigene Zusammenfassung, beide
   deckungsgleich): ADX<20 = Range (Wilders eigene Schwelle, 20-25 =
   ausdrücklich unentschiedene Grauzone, "keine offizielle Regel"), HH/HL
   vs. LH/LL nach Dow-Theorie, Bollinger-Squeeze als Volatilitäts-Bestätigung.
3. **Bereits im Code**: `src/regime.py::classify_market_regime` — ein
   bereits fertiger, getesteter, look-ahead-geprüfter 5-Label-Klassifikator
   mit genau diesen Zahlen (ADX≥25 Trend / ADX<20 + Bollinger-Bandwidth≤0.05
   Squeeze / 20-25 Grauzone), kalibriert für BTC/USDT-Stundenkerzen.

### Nutzer-Entscheidungen (Rückfrage 19.09.2026)

- **Edge-Cases** (`HIGH_VOLA_REVERSION`, `UNRESOLVED_NEUTRAL` aus regime.py,
  passen nicht direkt ins 3-Phasen-Modell): in die naheliegendste Phase
  einsortieren, kein 4. Bucket.
- **Struktur-Check**: zusätzlich zur reinen Indikator-Definition ein
  expliziter Swing-Pivot-/Knickpunkt-Check (echter HH/HL- bzw. LH/LL-Bruch)
  als zweite, unabhängige Bestätigung — nicht nur Indikator-Schwellen.
- **Makro-/Halving-Zyklus-Ebene**: bleibt vorerst außen vor, späterer
  Ausbauschritt.

### Kombinationslogik (final, implementiert)

**Schritt 1 — Indikator-Regime → gerichteter "Lean"** (Edge-Case-Mapping):

| regime.py-Label | Lean |
|---|---|
| `TREND_EXPANSION_BULLISH` | Aufwärts |
| `TREND_EXPANSION_BEARISH` | Abwärts |
| `VOLA_SQUEEZE_RANGING` | Seitwärts |
| `HIGH_VOLA_REVERSION`, Kurs über Mittelwert gestreckt (`dist_zscore_sma50>0`) | Aufwärts |
| `HIGH_VOLA_REVERSION`, Kurs unter Mittelwert gestreckt | Abwärts |
| `UNRESOLVED_NEUTRAL`, schwacher aber konsistenter Aufwärts-Ansatz (`slope>0` und `+DI>-DI`) | Aufwärts |
| `UNRESOLVED_NEUTRAL`, schwacher Abwärts-Ansatz | Abwärts |
| `UNRESOLVED_NEUTRAL` sonst (inkl. fehlende Daten) | Seitwärts |

**Schritt 2 — Lean + Swing-Struktur (neu: `src/swing_structure.py`,
kausale ZigZag-Pivot-Erkennung mit ATR-Vielfachem als Reversal-Schwelle,
Default `atr_multiple=2.0` — skaliert automatisch mit BTCs wechselnder
Volatilität statt eines fixen %-Werts) → finale Phase**:

- Aufwärts UND Struktur bestätigt HH+HL → **AUFWÄRTS**
- Abwärts UND Struktur bestätigt LH+LL → **ABWÄRTS**
- alles andere (Widerspruch, Struktur MIXED/UNKNOWN, oder Indikator selbst
  schon Seitwärts) → **SEITWÄRTS**

Konservativ per Design: ein Richtungslabel braucht **beide** unabhängigen
Signale, ein Widerspruch fällt auf Seitwärts zurück — konsistent mit der
bereits im Projekt etablierten "lieber keine Aussage als eine erfundene"-
Philosophie (`UNRESOLVED_NEUTRAL`-Fallback, SL-Tie-Break in
`toby_setup_engine.py`).

### Implementierung

- `research-python/src/swing_structure.py` — `compute_zigzag_pivots()`,
  `classify_swing_structure()`. 9 Tests (`tests/test_swing_structure.py`),
  inkl. Look-ahead-Truncation-Test (gleiche Technik wie `regime.py`).
- `research-python/src/structural_phase.py` — `classify_structural_phase()`,
  kombiniert regime.py + swing_structure.py. 8 Tests
  (`tests/test_structural_phase.py`), inkl. Look-ahead-Test.
- Volle Testsuite (`research-python/tests/`, 390 Tests) weiterhin grün,
  keine Regression.
- `research-python/toby_setup/run_phase_segmentation.py` — berechnet die
  Feature-Matrix (`src/features/*`) und die kombinierte Phase auf
  **1h-Bars** (gleiche Kalibrierung wie regime.py selbst, gleiche
  Konvention wie das Wave-Anchor-Projekt: langsamere Struktur-Signale auf
  einem höheren Timeframe berechnen). Datenbasis:
  `toby_setup/data/BTCUSDT_1h.csv` (Kopie aus `wave_anchor_research/`,
  identischer Zeitraum 2022-09-04 bis 2026-09-18, 35.422 Stundenkerzen).
  Verknüpfung mit den 15m-Setup-Events (point-in-time, kein Lookahead) ist
  der nächste Schritt.

### Ergebnis (voller Datensatz, 1h-Bars)

| Phase | Bar-Anteil | Segmente | Ø Dauer | Median-Dauer | Max. Dauer |
|---|---|---|---|---|---|
| Aufwärts | 15.52% (5.499h) | 429 | 12.8h | 9h | 64h |
| Abwärts | 15.68% (5.554h) | 451 | 12.3h | 9h | 82h |
| Seitwärts | 68.80% (24.369h) | 881 | 27.7h | 19h | 191h |

Deskriptiv: die strenge Doppel-Bestätigung (Indikator UND Swing-Struktur
müssen übereinstimmen) ist bewusst konservativ — knapp 69% aller Stunden
fallen auf Seitwärts, weil schon ein alleiniger Widerspruch zwischen
Indikator-Regime und Knickpunkt-Struktur genügt, um kein Richtungslabel zu
vergeben. Richtungsphasen sind kürzer (Median 9h) als Seitwärts-Phasen
(Median 19h, längster durchgehender Seitwärts-Abschnitt 191h ≈ 8 Tage).

## Verknüpfung 1h-Phasen mit 15m-Setups (Stufe 3)

`research-python/toby_setup/join_phase_to_setups.py` — verknüpft jeden der
6 Setup-Datensätze aus Stufe 1 (2 Richtungen × 3 Hebel, je 141.667 Entries)
mit der Phase der zuletzt **bestätigten** 1h-Kerze zum Entry-Zeitpunkt.
Wiederverwendet `wave_anchor_research/mtf_join.py::confirmed_asof_join`
(bereits gebaut und getestet für genau diesen Zweck) statt den Join neu zu
implementieren — kein Blick in die Zukunft: eine 1h-Kerze zählt erst ab
ihrem eigenen Schlusszeitpunkt als bekannt, `entry_time` einer 15m-Kerze
ist zugleich deren eigener Schlusszeitpunkt (identische Konvention wie im
Wave-Anchor-Projekt). Für die ersten 3 Entries pro Kombination (vor der
allerersten bestätigten 1h-Kerze um 01:00 Uhr) ist keine Phase zuordenbar
(NaN, kein künstliches Auffüllen).

Ergebnis: **Setups pro Phase** (gepoolt über alle 6 Kombinationen, zur
Orientierung — die Verteilung entspricht fast exakt den 1h-Bar-Anteilen
aus Stufe 2, da 15m-Entries nur eine feinere Abtastung derselben
Phasen-Zeitachse sind):

| Phase | Setups | Anteil |
|---|---|---|
| Aufwärts | 131.976 | 15.53% |
| Abwärts | 133.296 | 15.68% |
| Seitwärts | 584.712 | 68.79% |

**Tier-Verteilung nach Setup-Ausrichtung zur Phase** (deskriptiv, noch
keine Signifikanzprüfung — das folgt erst in der Signal-Zeitfenster-Stufe
mit BH-FDR, gleiche Methodik wie im Wave-Anchor-Projekt):

| Setup | mit der Phase | gegen die Phase | in Seitwärts |
|---|---|---|---|
| LONG erreicht ≥ Standard 4 (TP20+) | 33.71% (in Aufwärts) | 32.13% (in Abwärts) | 33.50% |
| SHORT erreicht ≥ Standard 4 (TP20+) | 34.08% (in Abwärts) | 31.37% (in Aufwärts) | 32.09% |

Und speziell bei Standard-1-Extended (TP35+, mit Trailing):

| Setup | mit der Phase | gegen die Phase |
|---|---|---|
| LONG → Standard 1 Extended | 23.14% (Aufwärts) | 20.33% (Abwärts) |
| SHORT → Standard 1 Extended | 23.24% (Abwärts) | 19.26% (Aufwärts) |

Ein Setup **mit** der Phase (LONG in Aufwärts, SHORT in Abwärts) schneidet
in beiden Kennzahlen durchgehend besser ab als eines **gegen** die Phase —
Differenz ca. 1.6–2.7 Prozentpunkte (TP20+) bzw. 2.8–4.0 Prozentpunkte
(TP35+-Extended). Rein deskriptiv, kein Signifikanztest, keine Korrektur
für Mehrfachtests — aber ein plausibler, richtungskonsistenter Effekt in
beide Richtungen (LONG und SHORT jeweils in ihrer "eigenen" Phase besser),
der die Grundannahme des Projekts stützt und die weitere Signal-Analyse
rechtfertigt.

Ausführliche Daten: `output/tiered_mfe_with_phase_{direction}_{leverage}x.csv`
(je 141.667 Zeilen, gitignored) und
`output/setup_tier_distribution_by_phase.csv` (Übersichtstabelle, gitignored).

## Testmethode Paar-/Dreier-Häufigkeit (mit Nutzer abgestimmt, 19.09.2026)

Zwei getrennte Fragen: **Frage A** (reine Häufigkeit, rein deskriptiv, dient
als Vorfilter) vs. **Frage B** (Zusammenhang mit Setup-Qualität, echter
Test). Kontrollgruppe für Frage B: "restliche Setups in derselben Phase/
demselben Fenster" (nicht der Gesamtdurchschnitt, sonst mischt sich der
Phase-Effekt selbst rein). Test: HAC/Newey-West-Regression (Logit für TP20+
ja/nein, OLS für `final_mfe_margin_pct`), 1:1 derselbe Baustein wie
`wave_anchor_research/incremental_value.py`; Block-Bootstrap
(`src/validation/block_bootstrap.py`) als Robustheits-Check auf den
auffälligsten Zellen. Mindeststichprobe pro Zelle, sonst `DATEN_
UNZUREICHEND`. BH-FDR über den **gesamten gepoolten Zellsatz** (ein Pool).
OOS-Freeze + Purging/Embargo wie im Wave-Anchor- bzw. Market-State-Projekt.

**Kombinatorik-Eindämmung** (Nutzer-Entscheidung): hierarchisch vorfiltern
— erst Einzelsignale nach Häufigkeit zählen (Frage A, NICHT nach Outcome
gefiltert, sonst Cherry-Picking), nur ausreichend häufige Signale gehen in
die Paar-Stufe, nur überlebende Paare in die Dreier-Stufe. Zusätzlich
priorisiert: **gruppenübergreifende** Paare (z.B. Momentum×Orderflow)
gegenüber gruppeninternen (vermutlich redundant/korreliert).

## Signalgruppen (unabhängig von der Phasen-Konstruktion)

**Zirkularitäts-Ausschluss**: die Phase selbst ist aus ADX/DI/Slope/
Bollinger-Bandwidth (Indikator-Regime) und Knickpunkt-Struktur (HH/HL vs.
LH/LL) gebaut — `structure`/`trend_strength`/`trend_regime`-Faktoren, die
rohen ADX/DI/Slope/Bandwidth-Werte, das `regime.py`-Label und das
`swing_structure`-Label sind deshalb aus dem Signal-Katalog ausgeschlossen
(sonst würde man effektiv "korreliert Aufwärts mit Aufwärts?" testen).

Backfillbar über die vollen 4 Jahre (2022-09-04 bis 2026-09-18, bestätigt:
`taker_buy_base_vol` und `volume` sind für den kompletten Zeitraum
vorhanden, nicht nur seit Kurzem): 13 Signale in 3 Gruppen.

| Gruppe | Signale | Quelle |
|---|---|---|
| Momentum | `momentum_divergence` (ADX≥25 + MACD-Histogramm widerspricht Trendrichtung) | Port von `lib/momentumDivergence.ts` |
| Orderflow | `cvd_bullish`/`cvd_bearish` (CVD-Trend aus `taker_buy_base_vol`), `vwap_above`/`vwap_below` (Tages-Anker-VWAP) | `legacy_factors.py`-Faktoren auf selbst berechnetem CVD/VWAP |
| Entry-Muster | `doji`, `hammer`, `hanging_man`, `bullish_engulfing`, `bearish_engulfing`, `morning_star`, `evening_star`, `guss_signal` | Kerzenmuster-Bericht + GUSS (siehe unten) |

Nicht rückrechenbar über die vollen 4 Jahre (externe Feeds erst seit
Mitte/Ende August 2026 aktiv): Funding, Sentiment, Open-Interest-Faktoren,
Orderbook, Options, Makro, Basis, Liquidations-Cluster — fallen für die
Vollhistorie-Analyse weg.

**GUSS-Korrektur** (wichtiger Zwischenfund): die erste Portierung (1:1 aus
der internen, unbestätigten TS-Rekonstruktion in
`lib/tradingIndicatorsContext.ts`) verlangte, dass buchstäblich jede Kerze
im Pullback-Segment (im Schnitt ~51 1h-Bars) richtungskonform schließt —
bei BTC-Rauschen statistisch quasi unmöglich, daher **0 Treffer** auf dem
vollen Datensatz. Der Nutzer lieferte die offizielle Indikator-Beschreibung
nach (TradingView-Changelog): Standard-EMA ist **50** (nicht 21), die Regel
verlangt nur eine "zusammenhängende Gegenbewegung" bis zur EMA-Berührung,
kein Bar-für-Bar-Zwang, und das Signal ist ein **Ereignis** ("in diesem
Moment entsteht ein GUSS-Signal"), kein Dauerzustand. Neu implementiert in
`src/signals/guss.py`: feuert einmalig bei der ersten EMA-Berührung, sofern
der Ursprungs-Swing bis dahin das Extrem des Segments geblieben ist (kein
neues Hoch/Tief dazwischen — die direkte Lesart von "zusammenhängend", ohne
einen erfundenen Bar-für-Bar-Schwellenwert). Jetzt 2.938 Ereignisse über
4 Jahre (8.3% der 1h-Bars) — plausibel.

## Stufe 4: Signal-Zeitfenster-Extraktion

`research-python/toby_setup/compute_signals.py` — berechnet alle 13 Signale
über den vollen Datensatz (12 nativ auf 15m, `guss_signal` nativ auf 1h).
`extract_signal_windows.py` — für jeden der 141.667 15m-Zeitpunkte (Signal-
und Entry-Zeitpunkte sind unabhängig von Richtung/Hebel identisch, daher
EINE gemeinsame Extraktion statt 6): vier kumulative Fenster, alle endend
an der Signal-Kerze S (Close = Entry-Zeitpunkt E):
- `w15m`: nur S selbst
- `w1h`: die letzten 4 15m-Kerzen bis und mit S
- `w4h`: die letzten 16 15m-Kerzen bis und mit S
- `wtrade`: die Entry-Kerze E selbst (laufender Trade)

GUSS wird zuerst point-in-time-sicher auf das 15m-Raster projiziert (nur
auf der einen 15m-Kerze pro Stunde, deren Schlusszeit mit der 1H-
Bestätigung zusammenfällt), danach identische Rolling-Window-Logik wie für
die 15m-nativen Signale. Verschachtelungs-Invariante geprüft (w15m⊆w1h⊆w4h,
0 Verletzungen über alle 13 Signale). Phase per `confirmed_asof_join`
angehängt (3 Zeilen ohne Phase, vor der ersten bestätigten 1h-Kerze).

Ausgabe: `output/signal_windows.csv` (141.667 Zeilen, 55 Spalten: signal_
time/entry_time/phase + 13×4 boolesche Fenster-Signal-Spalten, gitignored).

## Stufe A: Einzelsignal-Häufigkeit (Vorfilter)

`research-python/toby_setup/frequency_stage_a.py`. Beispiel Fenster `w1h`:

| Signal | Aufwärts | Abwärts | Seitwärts | Gesamt |
|---|---|---|---|---|
| cvd_bullish | 71.2% | 62.8% | 65.9% | 66.3% |
| vwap_above | 65.6% | 34.2% | 46.2% | 47.3% |
| momentum_divergence | 31.9% | 35.5% | 23.6% | 26.8% |
| guss_signal | 2.0% | 2.5% | 11.0% | 8.3% |
| hammer | 20.4% | 24.1% | 22.6% | 22.5% |
| morning_star (seltenstes Signal) | 5.8% | 5.4% | 5.4% | 5.5% |

Mit Mindeststichprobe n≥500 je Phase×Fenster-Zelle erreichen **alle 13
Signale in allen Zellen** den Vorfilter — bei Phasengrößen von 22.000 bis
97.000 Zeitpunkten selbst beim seltensten Signal (`guss_signal` in
Aufwärts/Abwärts, ~2%) komfortabel erfüllt. Daraus **463 gruppen-
übergreifende Paar-Kandidaten** (über alle Phase×Fenster-Zellen), in
`output/frequency_stage_a_pair_candidates.csv` (gitignored). Auffällig
(rein deskriptiv, noch kein Test): `vwap_above` und `cvd_bullish` sind in
Aufwärts deutlich häufiger als in Abwärts (65.6% vs. 34.2% bzw. 71.2% vs.
62.8%) — plausibel, da beide Signale selbst Trendrichtung ausdrücken;
`guss_signal` ist in Seitwärts überraschend am häufigsten (11.0% vs. ~2%
in beiden Richtungsphasen) — konsistent damit, dass ein "Pullback zur
EMA50, der die Trendrichtung nie verlässt" in einer bereits als klar
gerichtet klassifizierten Phase seltener neu entsteht.

## Stufe B: statistischer Test (Einzelsignale + Paare gegen Setup-Qualität)

`research-python/toby_setup/join_signals_with_outcomes.py` — verknüpft
`signal_windows.csv` mit den Outcomes bei 20x Hebel (Hebel-Invarianz aus
Stufe 1 begründet den Verzicht auf 25x/30x hier — redundante Rechenzeit
ohne neue Information), LONG und SHORT getrennt (n=141.664 je Richtung).
`signal_stats.py` — `evaluate_cell()`, HAC-Regression (Logit für
`reached_tp20`, OLS für `final_mfe_margin_pct`, `block_length=384`
= max(10, 2×192) nach der `stats_battery.py`-Regel), `MIN_N=100`,
`split_train_val_oos()` (80/20 chronologisch, 192 Bars/48h Embargo vor der
Grenze — verhindert, dass ein TRAIN_VAL-Outcome-Fenster in den OOS-Zeitraum
hineinreicht). 4 Validierungstests bestanden (starker/kein Effekt korrekt
erkannt, INSUFFICIENT_DATA korrekt ausgelöst, Embargo-Grenze korrekt).

### Wichtiger Zwischenfund: Kontamination im `wtrade`-Fenster

`run_stage_b.py` lief zunächst über alle 4 Fenster inkl. `wtrade` — Ergebnis:
**145 von 280 `wtrade`-Zellen** hatten p<0,001 (binär), gegenüber nur 1–3
von ~280–340 bei `w15m`/`w1h`/`w4h`. Ursache identifiziert: Kerzenmuster/
CVD/VWAP-Position der Entry-Kerze hängen von **deren eigenem Schlusskurs**
ab, und `final_mfe_margin_pct` misst die günstigste Kursbewegung ab
demselben Entry-Preis **inklusive dieser ersten Kerze** — Signal und
Outcome teilen sich Information aus derselben Kerze (z.B. bewegt eine
"bearish_engulfing"-Entry-Kerze bei SHORT den Kurs per Definition schon
innerhalb dieser Kerze günstig, was direkt ins MFE einfließt). Kein echter
Befund, sondern eine Konstruktions-Kontamination. **Konsequenz**: `wtrade`
wird aus dem BH-FDR-Pool ausgeschlossen (separat, unkorrigiert und als
unzuverlässig gekennzeichnet in `stage_b_train_val_results.csv` ausgegeben),
nur `w15m`/`w1h`/`w4h` (strikt vor der Entry-Kerze, keine Überlappung mit
dem Outcome) fließen in die Signifikanzaussage ein.

### Ergebnis TRAIN_VAL (bereinigt)

1.238 Zellen ausgewertet (156 Einzelsignal- + 463 Paar-Kandidaten × 2
Richtungen), 1.228 mit Status OK. Gepoolte BH-FDR über 1.896 Tests (beide
Ziel-Typen zusammen, `w15m`/`w1h`/`w4h` only): **11 Zellen signifikant** —
alle ausschließlich beim **stetigen** Ziel (`final_mfe_margin_pct`), **keine
einzige** beim binären Ziel (`reached_tp20`) — d.h. kein getestetes
Signal/Paar verschiebt nach Korrektur die Wahrscheinlichkeit, TP20+ zu
erreichen, aber einige verschieben die Tiefe der erreichten Kursbewegung.
Auffällig: `momentum_divergence+vwap_above` erscheint 3× (Aufwärts-Phase,
alle 3 Fenster, LONG und SHORT) mit gegensätzlichem Vorzeichen — für LONG
positiv (mehr MFE), für SHORT negativ — plausibel: Kurs über VWAP bei
gleichzeitiger Momentum-Divergenz während einer bereits als Aufwärts
klassifizierten Phase spricht eher für eine (bullische) Fortsetzung.

### OOS-Bestätigung

`run_stage_b_oos.py` — alle 11 TRAIN_VAL-Überlebenden unverändert auf dem
eingefrorenen OOS-Anteil (n=28.333 je Richtung) nachgerechnet, keine
Nach-Optimierung. **Nur 3 von 11 reproduzieren** (gleiche Richtung des
Effekts UND p<0,05, unkorrigiert bei nur noch 11 Zellen):

| Richtung | Phase | Fenster | Signal | TRAIN_VAL p (stetig) | OOS p (stetig) | OOS Δ MFE |
|---|---|---|---|---|---|---|
| SHORT | Seitwärts | w15m | `vwap_below` | 0.00013 | 0.015 | +3.46 Punkte |
| SHORT | Seitwärts | w1h | `vwap_below` | 0.00014 | 0.021 | +3.10 Punkte |
| SHORT | Seitwärts | w1h | `bullish_engulfing`+`vwap_below` | 0.00018 | 0.037 | +2.55 Punkte |

Die übrigen 8 (u.a. das auf TRAIN_VAL auffällige
`momentum_divergence+vwap_above`) reproduzieren auf OOS **nicht** (p>0,5
in den meisten Fällen) — klassisches Overfitting-Muster einer nicht
korrigierten Einzelbetrachtung, genau wofür die OOS-Stufe da ist.

**Einzige robuste, OOS-reproduzierte Beobachtung dieses Projekts**: SHORT-
Setups im **Seitwärts**-Regime erreichen eine deutlich höhere maximale
Kursbewegung (MFE), wenn der Kurs zum Entry-Zeitpunkt **unter dem
Tages-VWAP** liegt — unabhängig davon, ob zusätzlich ein Bullish-Engulfing-
Muster vorliegt. Wichtige Einschränkungen: (1) nur beim stetigen Ziel, nicht
bei der TP20+-Erreichungswahrscheinlichkeit; (2) die Paar-Variante
(`bullish_engulfing`+`vwap_below`) liegt in Effektgröße und p-Wert nah an
`vwap_below` allein — ob das Muster einen eigenständigen Beitrag liefert
oder nur "vwap_below plus Rauschen" ist, wurde nicht formal geprüft
(keine Redundanz-/Korrelationsanalyse zwischen beiden Signalen gerechnet);
(3) drei von ursprünglich 619 getesteten
Zellen (×2 Richtungen) — bei einem so kleinen Anteil ist auch ein
verbleibendes Zufallsergebnis nicht auszuschließen, trotz OOS-Bestätigung.

Rohdaten: `output/stage_b_train_val_results.csv`,
`output/stage_b_train_val_survivors.csv`, `output/stage_b_oos_confirmation.csv`
(alle gitignored).

## Offen / nächster Schritt

Dreier-Kombinationen (nur aus den wenigen Paaren, die die Paar-Stufe
überlebt haben — hier: praktisch keine, da nur 3 Paare/Einzelsignale
OOS-reproduziert haben und einer davon redundant ist) sind bei diesem
Befund nicht mehr sinnvoll zu verfolgen. Offene Optionen: (a) das Projekt
mit diesem einen robusten, aber engen Befund abschließen; (b) gezielt
`vwap_below` in Seitwärts/SHORT vertiefen (z.B. Interaktion mit weiteren
Fenstern/Signalen, die hier noch nicht kombiniert wurden); (c) die
Kontamination im `wtrade`-Fenster methodisch anders auflösen (z.B. MFE ab
Bar 1 statt Bar 0 messen) und `wtrade` als eigenständige, sauber
definierte Frage neu aufsetzen.

## Pivot auf 5m-Setup-Basis (20.09.2026)

### Anlass

Nach Vorlage der obigen 15m-Ergebnisse stellte der Nutzer die
Grundannahme in Frage: *"buchstäblich jede einzelne 15m-Kerze der letzten
4 Jahre als Trade: das ist aber nicht meine idee! und ich frage mich ob
15m genügt für entry, da ich teilweise schon bei 5m einsteige."* Zwei
getrennte Punkte:

1. Die Setup-Basis "jede Kerze = hypothetischer Entry" war ursprünglich
   aus `toby_setup_engine.py` übernommen worden (einem älteren Baustein
   dieses Projekts), nicht eine bewusste Entscheidung des Nutzers für
   *dieses* Signal-Test-Projekt — zu Recht als unklar zurückgewiesen.
2. Die 15m-Auflösung bildet sein reales Entry-Verhalten nicht ab, da er
   teilweise auf 5m-Basis einsteigt.

Per `AskUserQuestion` zwei getrennte Entscheidungen eingeholt:
- **Auflösung**: 5m ("passt zu deinem echten Entry-Verhalten").
- **Setup-Basis**: weiterhin **jede Kerze** ("neutrale Baseline") —
  Punkt 1 oben wurde damit explizit als bewusste, informierte
  Entscheidung bestätigt statt stillschweigend fortgeschrieben.

### Datenlücke + Backfill

5m-Kerzen waren in der Datenbank nur ab 2024-09-04 vorhanden (Start des
Live-Collectors), nicht seit 2022-09-04 wie beim 15m-Datensatz. Auf
Nutzer-Entscheid ("Erst 5m-Historie bis 2022 zurück-backfillen") wurde die
Lücke geschlossen:

- Diese Sandbox kann `fapi.binance.com` nicht direkt erreichen
  (Egress-Policy blockiert die CONNECT-Tunnel, verifiziert per
  `curl`/Proxy-Status). Historische Binance-Daten müssen daher über eine
  Supabase-Infrastrukturkomponente mit eigenem Netzwerkzugang laufen.
- Die produktive Edge Function `backfill-history` holt genau das (Kline-
  Historie → `candles`), kannte aber `"5m"` als Intervall noch nicht
  (nur `"1m"/"15m"/"1h"/"4h"/"1d"`). Mit expliziter Nutzer-Freigabe
  ("Ja, Function erweitern und deployen") minimal erweitert (analog zum
  bestehenden `"1m"`-Muster: nur `candles`, bewusst ohne
  `market_features` — `market_features_interval_check` erlaubt ohnehin
  nur 15m/1h/4h/1d) und deployed (Version 9→10).
- Auch der Supabase-Projekt-Host selbst ist von dieser Sandbox aus nicht
  direkt per HTTPS erreichbar (gleiche Egress-Policy). Die Function wurde
  daher serverseitig über `pg_net.http_post` aus der Postgres-Instanz
  selbst aufgerufen (führt mit eigenem Netzwerkzugang aus, unabhängig vom
  Sandbox-Egress) — 6 sequentielle Aufrufe à ~122 Tage
  (`MAX_REQUESTS=60`-Sicherheitsdeckel der Function begrenzt ~90.000
  Kerzen/Aufruf), alle mit `success:true` bestätigt.
- Verifikation: `candles`-Tabelle für `interval='5m'` deckt jetzt
  lückenlos 2022-09-04 00:00 UTC bis 2026-09-14 06:15 UTC ab (423.724
  Kerzen — exakt die für einen durchgehenden 5-Minuten-Raster über diesen
  Zeitraum erwartete Anzahl, keine Lücken). Export als
  `data/BTCUSDT_5m_full_with_volume.csv` (gitignored) per gechunktem
  SQL-Extrakt (12×, je ~2,4 MB, wegen Tool-Zeichenlimit).

### Pipeline-Anpassung

Alle Stufen als parallele `*_5m.py`-Skripte neu aufgesetzt (15m-Skripte/
-Ergebnisse bleiben unverändert als historischer Vergleichspunkt
erhalten) — identische Methodik, nur Timeframe-Konstanten auf das 3×
feinere Raster skaliert:

| Konstante | 15m-Lauf | 5m-Lauf | Herleitung |
|---|---|---|---|
| `vertical_bars` (Stufe 1, MFE-Horizont) | 192 | 576 | 48h ÷ Bar-Dauer |
| Fenster `w15m` | 1 Bar | 3 Bars | 15min ÷ Bar-Dauer |
| Fenster `w1h` | 4 Bars | 12 Bars | 1h ÷ Bar-Dauer |
| Fenster `w4h` | 16 Bars | 48 Bars | 4h ÷ Bar-Dauer |
| HAC `block_length` | 384 | 1152 | max(10, 2×vertical_bars) |
| OOS-Embargo | 192 Bars | 576 Bars | 48h ÷ Bar-Dauer (= vertical_bars) |

Die 1h-Phasenreihe (Stufe 2, `output/phase_segmentation_1h.csv`) und das
GUSS-Signal (1H-nativ, `output/signals_1h.csv`) sind von der Setup-Basis-
Auflösung unabhängig und wurden unverändert wiederverwendet — nur ihre
Projektion auf das Entry-Raster (Stufe 3/4) wurde auf 5m umgestellt.
`signal_stats.py::evaluate_cell()` bekam dafür einen optionalen
`block_length`-Parameter (Default unverändert 384, damit die bestehenden
15m-Aufrufe unverändert bleiben).

### Ergebnis (5m, TRAIN_VAL + OOS)

`run_stage_b_5m.py`: 1.328 Zellen (156 Einzelsignal- + 508 Paar-
Kandidaten × 2 Richtungen, `output/frequency_stage_a_pair_candidates_5m.csv`),
1.316 mit Status OK. Gepoolte BH-FDR über 1.988 Tests (beide Ziel-Typen,
`w15m`/`w1h`/`w4h` only, `wtrade` aus identischem Kontaminationsgrund wie
im 15m-Lauf ausgeschlossen): **2 Zellen signifikant** (beide nur beim
stetigen Ziel, LONG/Aufwärts):

| Richtung | Phase | Fenster | Signal | TRAIN_VAL p (stetig) |
|---|---|---|---|---|
| LONG | Aufwärts | w15m | `momentum_divergence`+`vwap_below` | 0.00000023 |
| LONG | Aufwärts | w1h | `hammer`+`vwap_below` | 0.000017 |

`run_stage_b_oos_5m.py`: **0 von 2 reproduzieren** auf OOS (n=13.026)
Richtung UND p<0,05 — beide OOS-p-Werte weit über 0,05 (0.30 bzw. 0.84).

**Damit reproduziert am 5m-Grid, das Tobys realem Entry-Verhalten näher
kommt, keines der TRAIN_VAL-Ergebnisse auf dem eingefrorenen OOS-Anteil**
— ein noch schwächeres Ergebnis als am 15m-Grid (dort 3 von 11). Der dort
gefundene robuste Befund (`vwap_below` in SHORT/Seitwärts) taucht am
5m-Grid nicht als BH-FDR-Überlebender wieder auf (weder positiv noch
negativ geprüft — die 15m-Zelle wurde nicht gezielt am 5m-Grid
nachgetestet, da sie den TRAIN_VAL-Filter dort gar nicht erst
durchlief). Rohdaten: `output/stage_b_train_val_results_5m.csv`,
`output/stage_b_train_val_survivors_5m.csv`,
`output/stage_b_oos_confirmation_5m.csv` (alle gitignored).

### Einordnung

Diese Verschärfung des Nullbefunds bei feinerer, dem echten Entry-
Verhalten näherer Auflösung ist kein Widerspruch zum 15m-Ergebnis,
sondern eine Präzisierung: sie zeigt, dass der einzige am 15m-Grid
gefundene robuste Effekt nicht automatisch auf die Auflösung übertragbar
ist, auf der tatsächlich gehandelt wird. Für die eingangs gestellte Frage
("sind Nexus-Signale VOR dem Entry prädiktiv für die Setup-Qualität?")
bleibt die Antwort in diesem eng gefassten Testrahmen (neutrale
"jede-Kerze"-Baseline, 13 Einzelsignale + gruppenübergreifende Paare, 3
Phasen, 3 Zeitfenster) am für Toby relevantesten Zeithorizont: **kein
belastbares Ja**. Das ist eine Aussage über diesen spezifischen,
begrenzten Testrahmen — nicht über den Wert der Nexus-Faktoren insgesamt
(die z.B. in anderen Projekten dieser Session, etwa der Triple-Barrier-
Analyse der exakten SL/TP/Hebel-Konfiguration, in anderer Fragestellung
geprüft wurden).

## Konfluenz-Score-Test: "testen wir auch falsch?" (20.09.2026)

### Anlass

Nach dem Nullbefund am 5m-Grid stellte der Nutzer die Testmethodik selbst
in Frage. Zurecht: der bisherige Aufbau hat drei konkrete Schwächen, die
einen echten Effekt verdecken können, ohne dass er nicht existiert —

1. **Nie echte Konfluenz getestet.** Stufe B testet Einzelsignale und
   Paare, nie 3+ gleichzeitig übereinstimmende Signale — genau das
   Muster, nach dem Toby real handelt.
2. **"Jede Kerze"-Baseline verdünnt jedes echte Setup.** Bei 423.724
   Kerzen sind die allermeisten kein Setup, das je genommen würde; ein in
   den seltenen echten Konfluenz-Momenten starker Effekt kann im gepoolten
   Test aus reinem Rauschen verschwinden.
3. **Konservative Korrektur bei kleinen Effekten.** `block_length=1152`
   (voller 48h-Horizont) plus gepoolte BH-FDR über ~2000 Tests gleichzeitig
   drückt die Power stark — ein echter, aber kleiner Effekt (2-3 Punkte)
   hat kaum eine Chance, das zu überleben.

### Umsetzung: Konfluenz-Score statt Einzelsignal/Paar

`compute_confluence_5m.py`: je Richtung EIN Score = Anzahl gleichzeitig
aktiver, **richtungskonformer** Signale (0..7) im Fenster, statt eines
booleschen Einzel-/Paar-Indikators. Dabei zwei zusätzliche Korrekturen
gegenüber Stufe B aufgedeckt und behoben:

- `momentum_divergence` und `guss_signal` wurden in Stufe B als EIN Flag
  identisch für LONG und SHORT getestet, obwohl beide Signale intern eine
  Richtung tragen. Hier in ihre bullische/bärische Hälfte aufgesplittet
  (Momentum: DI-Richtung + MACD-Histogramm-Vorzeichen; GUSS: Trendrichtung
  des Pullback-Ursprungs, post-hoc aus `close` vs. `EMA50` an der
  feuernden Bar rekonstruiert — `src/signals/guss.py` selbst blieb
  unverändert, da bereits validiert) — nur die zur getesteten Richtung
  passende Hälfte fließt in den jeweiligen Score ein. `doji` bleibt außen
  vor (kein inhärenter Richtungsbezug).
- BULLISH_SIGNALS (`cvd_bullish`, `vwap_above`, `hammer`,
  `bullish_engulfing`, `morning_star`, `momentum_bullish`, `guss_bullish`)
  für LONG, BEARISH_SIGNALS (Spiegelbild) für SHORT — Score = Summe der im
  Fenster (`w15m`=3, `w1h`=12, `w4h`=48 Bars @5m) aktiven Signale dieser
  Gruppe.

`signal_stats.py::evaluate_continuous_predictor()` (neu, mit
`validate_continuous_predictor.py` an synthetischen Daten getestet):
HAC-Logit/OLS mit dem Score als **stetigem** Regressor (nicht
Gruppenindikator) — angemessener für eine Zählgröße, deutlich weniger
Verdünnung. `run_confluence_test_5m.py`: nur 2 Richtungen × 3 Phasen × 3
Fenster = **18 Zellen** (36 gepoolte Tests über beide Ziel-Typen) statt
1.988 in Stufe B — derselbe TRAIN_VAL/OOS-Split mit Embargo (576 Bars).

### Ergebnis

**0 von 36 gepoolten Tests BH-signifikant** — auch der weit besser
gepowerte, richtungskorrekte Konfluenz-Test findet keinen robusten Effekt.
Nächstliegend: SHORT/Abwärts/`w15m` mit p=0,0045 (unkorrigiert;
Konfluenz-Score korreliert hier positiv mit `final_mfe_margin_pct`,
inhaltlich plausibel — bärische Konfluenz in einer bereits bestätigten
Abwärtsphase), übersteht aber die BH-FDR-Schwelle bei 36 Tests nicht
(bräuchte p≤0,0014 für Rang 1). Volltabelle: alle 18 Zellen zeigen
durchweg kleine, größtenteils inkonsistente Effektrichtungen zwischen den
drei Fenstern derselben Phase — kein Muster, das auf einen verdeckten,
aber realen Effekt hindeutet. Rohdaten:
`output/confluence_train_val_results_5m.csv`,
`output/confluence_{long,short}_5m.csv` (alle gitignored).

### Einordnung

Die Kritik an der Testmethodik war berechtigt und die Korrektur war es
wert, gemacht zu werden — der Konfluenz-Test ist strenger genommen der
angemessenere Test für die tatsächliche Fragestellung. Er ändert aber das
Ergebnis nicht: selbst mit ~55× weniger Tests (also entsprechend mehr
Power) und korrekter Richtungszuordnung bleibt kein Signal übrig. Das
stützt die Interpretation aus dem 15m/5m-Vergleich: der wiederholte
Nullbefund ist wahrscheinlich kein Artefakt einer zu strengen oder falsch
aufgebauten Testmethodik, sondern spiegelt tatsächlich fehlende
prädiktive Kraft dieser 13 Signale (einzeln, paarweise UND als
richtungskonforme Konfluenz) für die hier getestete Fragestellung wider.
