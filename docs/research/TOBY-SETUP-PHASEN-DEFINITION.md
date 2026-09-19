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

## Offen / nächster Schritt

Signal-Zeitfenster-Extraktion (bis 4h / bis 1h / bis 15m vor Entry / im
laufenden 15m-Trade): für jeden Setup-Entry die zu diesem Zeitpunkt
tatsächlich aktiven Nexus-Signale festhalten (ebenfalls point-in-time,
konfirmierter Wert), dann Häufigkeit/Ko-Auftreten (Einzelsignale, Paare,
Dreier) pro Phase/Zeitfenster, mit gepoolter BH-FDR-Korrektur (Methodik-
Vorlage: Wave-Anchor-Projekt).
