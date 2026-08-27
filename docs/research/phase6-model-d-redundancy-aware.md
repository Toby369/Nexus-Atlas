# Phase 6 — Model D: Redundanzbewusstes Scoring

Direkt aus dem Redundanzbefund (`phase6-factor-diagnostics.md`) abgeleitet: auf TRAIN (n=151) liegen 13 von 15 Faktorpaaren der 6 verfügbaren Faktoren bei Pearson r≥0.53, verbunden über `momentum` (r=0.619 zu `cvd`) zu einem einzigen Cluster (Single-Linkage, Schwelle 0.55, aus TRAIN abgeleitet — dokumentiert in `backtest_model_runs.weights` für `redundancy_aware_v1`).

**Architektur:** die bisherigen 3 Domänen `market_structure`/`momentum_trend`/`order_flow` werden zu einer Domäne `trend_composite` zusammengefasst (6 Faktoren, einfacher Mittelwert). Die 4 datenarmen Domänen bleiben unverändert. Implementiert in `redundancy_aware_v1_signal_state()`.

## Zwei Bugs gefunden und vor jeder Ergebnismeldung behoben

1. **Coverage-Gate falsch skaliert:** die ursprüngliche domain-COUNT-basierte Formel (`domains_with_data/domains_total < 0.4`) ergab bei nur 1 von 5 aktiven Domains 20% "Coverage" — obwohl 6 von 14 Rohfaktoren (43%) tatsächlich vorlagen. Jede TRAIN/VALIDATION-Zeile wurde fälschlich `INSUFFICIENT_DATA`. Fix: Coverage-Gate auf Faktor-Ebene (`factors_with_data/14`), wie ursprünglich bei Model A.
2. **Schwellenwert unerreichbar:** der erste Fix (`1.5 × 5/7 = 1.07`) überstieg den maximal möglichen Score (1.0 bei nur einer aktiven Domain). Jede Zeile wurde `NEUTRAL`/`MIXED` statt `BULLISH`/`BEARISH`. Fix: fester, aus ersten Prinzipien gewählter Schwellenwert `0.5` (nicht aus Validation-Ergebnissen zurückgerechnet).

Beide Bugs wären ohne die pgTAP-Tests (`run_model_d_tests()`) unentdeckt in die Ergebnisse eingeflossen — Beleg für den Wert der Test-first-Disziplin in diesem Projekt.

## Ergebnis (formal verifiziert, TRAIN+VALIDATION, n=201)

- **BULLISH/BEARISH-Klassifikation ist in 100% der Fälle identisch zu Model A.** Kein einziger Unterschied.
- **MIXED→NEUTRAL in 48/201 Zeilen (23.9%)**, nie eine andere Kombination. Mathematisch erwartbar: Model A kann `MIXED` liefern, wenn einzelne Faktoren gegenläufig sind; Model D hat in diesem Fenster strukturell nur eine einzige Domäne, die nie gleichzeitig positiv und negativ sein kann — "gegenläufige Einzelfaktoren" werden korrekt zu "diese eine Domäne liegt nahe Null" (NEUTRAL statt MIXED).

**Einordnung:** Model D liefert auf der aktuellen Datenbasis **keine neue Information** gegenüber Model A für die eigentliche Handelsrichtung (BULLISH/BEARISH) — nur eine philosophisch sauberere Behandlung des MIXED-Falls. Das ist kein negatives Ergebnis, sondern die korrekte Konsequenz davon, dass in TRAIN+VALIDATION strukturell nur eine einzige Domäne je Daten hat (siehe Coverage-Audit) — die eigentliche Testkraft der Redundanzkorrektur (mehrere Domains gleichzeitig aktiv, echte Gewichtsverschiebung zwischen ihnen) lässt sich mit der aktuellen Datenbasis noch nicht prüfen. Sobald funding/positioning/orderbook/etc. genug TRAIN-Historie haben, ist eine Wiederholung dieses exakten Modells sinnvoll — die Architektur ist bereits vorhanden und reproduzierbar (`redundancy_aware_v1`, `is_frozen=true`).

**3 neue pgTAP-Tests** (`run_model_d_tests`), alle grün, inkl. Regressionsschutz für exakt diese MIXED→NEUTRAL-Grenze.
