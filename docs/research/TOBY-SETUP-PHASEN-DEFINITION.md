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

## Offen / nächster Schritt

Noch nicht gebaut (folgt nach Rückmeldung dieser Zahlen an Toby): Phasen-
Segmentierung (Aufwärts/Abwärts/Seitwärts, via `src/regime.py`), danach
Signal-Zeitfenster-Extraktion (bis 4h / bis 1h / bis 15m vor Entry / im
laufenden 15m-Trade) und die Paar-/Dreier-Kombinatorik pro Phase/Zeitfenster.
