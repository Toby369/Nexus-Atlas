# Nexus-Atlas — Phase 1b: Validierungsschicht auf erweiterter 2-Jahres-Historie

Stand: 04.09.2026. Reine Research-Erweiterung, additiv. **Keine Production-Aenderung, keine gefrorenen Modelle (`baseline_v1`, `domain_balanced_v1`, `calibrated_v1`, `redundancy_aware_v1`) veraendert.** Fuehrt die in `PHASE-1-VALIDATION-INTEGRITY.md` aufgebaute Validierungsschicht (Purging, Embargo, Coverage-Fix, non-overlapping 7D, BH/FDR) auf der per Backfill erweiterten 2-Jahres-Historie (2024-09-04 bis heute) erneut aus — genau die von Phase 0/Phase 1 empfohlene naechste Iteration ("sobald mehr TRAIN-Historie vorliegt, ist eine erneute Ausfuehrung derselben Funktionen die naechste sinnvolle Iteration, kein neuer Umbau").

## 1. Was neu ist

- 4 neue, **nicht eingefrorene** Modellversionen: `baseline_v1_2y`, `domain_balanced_v1_2y`, `calibrated_v1_2y`, `redundancy_aware_v1_2y` — identische Formeln wie die 4 gefrorenen Originale, aber Split ueber 2024-09-04 bis 2026-09-03 (Train 2024-09-04/2026-01-14, Validation 2026-01-15/2026-05-14, Test 2026-05-15/2026-09-03).
- Vorbedingung: `backtest_states` fuer Interval `1d` musste fuer den Zeitraum 2025-12-19 bis 2026-08-26 neu rekonstruiert werden — die urspruenglich am 27.08. berechneten Zeilen (`ON CONFLICT DO NOTHING`, insert-only) hatten 0% Funding/Macro/Sentiment-Abdeckung, weil diese Daten erst durch den spaeteren Backfill verfuegbar wurden. Nach Refresh: 100% Abdeckung fuer die 9 durchgehend verfuegbaren Faktoren im gesamten 2-Jahres-Fenster. Betrifft **nur** `backtest_states` (Rohdaten), nicht `backtest_model_results` der gefrorenen Modelle — deren bereits gemeldete Zahlen bleiben unveraendert.
- `research_evaluate_purged` und `research_evaluate_nonoverlap_7d` um einen `baseline`-Zweig erweitert (bisher nur B/C/D unterstuetzt) — additiv, kein Verhalten fuer B/C/D geaendert.

## 2. Stichprobengroessen — vorher/nachher

| Horizont | Split | N vorher (8 Monate) | N jetzt (2 Jahre) |
|---|---|---|---|
| 24h | TRAIN | 46-59 | 118-165 |
| 24h | VALIDATION | 0-37 | 12-53 |
| 168h (7D) non-overlap | TRAIN | 8-10 | 14-21 |
| 168h (7D) non-overlap | VALIDATION | 0-6 | 1-10 |
| 720h (30D) | TRAIN | 36-56 | 108-165 |
| 720h (30D) | VALIDATION | ~1-16 | 12-49 |

## 3. Purging/Embargo/Leakage — Integritaet

Alle 12 gepruefen Split×Horizont-Kombinationen (4 Modelle × 3 Horizonte, 2 Splits) liefen ohne Leakage-Exception durch `research_leakage_integrity_log`. Embargo (1 Tag) und horizontabhaengiges Purging (Label darf nicht ueber die Splitgrenze reichen) greifen wie in Phase 1 spezifiziert.

## 4. BH/FDR — kumulativ ueber alte + neue Zellen

`research_bh_fdr()` wertet **alle** je in `research_model_results_purged` abgelegten Zellen gemeinsam aus (Phase-1-Zellen + die neuen 2-Jahres-Zellen) — konsistent mit dem in Phase 1 etablierten kumulativen Prinzip.

**Ergebnis: 3 von 84 getesteten Zellen ueberleben BH-Korrektur bei α=0.05** (vorher: 0 von 36).

| Modell | Split | Horizont | Richtung | n | Hit-Rate | Baseline | p (roh) | BH-kritisch |
|---|---|---|---|---|---|---|---|---|
| domain_balanced_v1_2y | TRAIN | 720h | BEARISH | 144 | 62.5% | 45.3% | 0.0000 | 0.0006 |
| calibrated_v1_2y | TRAIN | 720h | BEARISH | 133 | 60.2% | 45.3% | 0.0006 | 0.0012 |
| baseline_v1_2y | TRAIN | 720h | BEARISH | 131 | 59.5% | 45.3% | 0.0011 | 0.0018 |

**Warum das trotzdem kein nachgewiesener Edge ist (zwei unabhaengige Gruende):**

1. **Alle drei Zellen sind TRAIN, keine einzige VALIDATION.** Die identische BEARISH/720h-Zelle auf VALIDATION liegt fuer dieselben Modelle bei p=0.0125–0.19 — weit ueber dem jeweils noetigen BH-kritischen Wert. Ein Befund, der nur in-sample signifikant ist und out-of-sample nicht reproduziert, ist der Lehrbuch-Fall von Overfitting/Zufall, nicht von echtem Signal.
2. **Effective Sample Size.** Wie in `PHASE-0-RECONCILIATION.md` Abschnitt 3 hergeleitet: bei H=720h (30 Tage) teilen aufeinanderfolgende taeglich berechnete Labels 29 von 30 Tagen ihres Preispfads — die effektive unabhaengige Stichprobe liegt bei n_eff ≈ n/30, hier also **~4-5**, nicht 131-144. Der z-Test in `research_bh_fdr()` nutzt die rohe Zeilenzahl als Stichprobengroesse (dokumentierte, bewusste Vereinfachung seit Phase 1) — bei korrekter MA(29)-Korrektur waeren diese p-Werte um Groessenordnungen hoeher, die Signifikanz verschwaende.

**Einordnung nach der Phase-0-Skala:** diese 3 Zellen bleiben **C — statistisch nicht entscheidbar**, nicht A. Die BH-Korrektur "besteht" nur, weil sie auf einer ueberoptimistischen Stichprobenannahme rechnet — genau die Falle, vor der Phase 0/1 bereits gewarnt hatten, jetzt am eigenen Ergebnis demonstriert statt nur theoretisch.

## 5. 30D/720h-Horizont — weiterhin nicht robust testbar

Mit 2 Jahren Historie ist VALIDATION-N fuer 720h jetzt 12-49 (vorher ~1-16) — eine reale Verbesserung. Non-overlapping waere das aber nur ≈ 4-5 unabhaengige Fenster in VALIDATION (120 Tage / 30) — zu wenig fuer eine belastbare Aussage. Kein neues non-overlapping-30D-Framework gebaut (analog zum kleinstmoeglichen-Schritt-Prinzip aus Phase 0/1 nicht Teil dieses Schritts). Status bleibt **E — Horizont nicht robust testbar**, auch mit doppelter Datenmenge.

## 6. Was sich bestaetigt/veraendert hat

- Non-overlapping 7D (168h) bleibt die informativste saubere Auswertung: VALIDATION-N jetzt 1-10 (vorher 0-6) — besser, aber immer noch niedrige Power. Keine Zelle darin signifikant nach BH.
- 24h bleibt durchgehend um 48-56% Hit-Rate — kein robuster Edge, Ergebnis stabil gegenueber der laengeren Historie.
- Modell-Ranking (B/C/D vs. A) bleibt qualitativ unveraendert: keines der vier zeigt einen out-of-sample (VALIDATION) BH-signifikanten Vorteil.

## 7. Fazit

Mehr Historie hat die Validierungsschicht robuster gemacht (mehr Zellen ueberhaupt testbar, bessere Power bei 7D/30D) — sie hat aber **keinen neuen Edge aufgedeckt, der VALIDATION uebersteht**. Die einzigen drei BH-signifikanten Zellen sind TRAIN-only und beruhen auf einer fuer den 30D-Horizont bekanntermassen zu optimistischen Stichprobenannahme. Bisherige Gesamtaussage ("kein robuster, multiple-testing-korrigierter Edge nachgewiesen") bleibt nach dieser Erweiterung **SUPPORTED**, nicht widerlegt.

## 8. Naechster sinnvoller Schritt (nicht Teil dieser Phase)

- HAC/Newey-West oder eine echte MA(H-1)-Korrektur fuer die 168h/720h-p-Werte statt der aktuellen Rohzahl-Vereinfachung.
- Funding-only-Benchmark (jetzt 100% 2-Jahres-Abdeckung, war in Phase 0 Abschnitt 12 als `NOT TESTABLE WITH CURRENT DATA` markiert) gegen Buy&Hold/Momentum-only/Trend-only.
- Positioning/Orderbook/Options/OI+Price/Basis bleiben weiterhin nur ~30 Tage tief (Boersen-Cap) — dafuer hilft keine weitere Backfill-Iteration, nur Zeit.
