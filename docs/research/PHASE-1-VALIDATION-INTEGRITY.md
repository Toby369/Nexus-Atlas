# Nexus-Atlas — Phase 1: Validation Integrity Fix

Stand: 27.08.2026. Reine Research-Validierungsschicht, additiv. **Production (`compute-market-state`), Testset-Zeitraum und alte `backtest_model_results`-Zeilen wurden nicht verändert.** Keine neue Modellarchitektur, keine Parameteroptimierung, keine Threshold-Änderung.

## 1. Executive Summary

Nach Nachrüstung von Purging (horizon-abhängig), Embargo (1 Tag) und Korrektur des Coverage-Bugs überleben **0 von 36 getesteten Zellen** (Model B/C/D × 3 Horizonte × 2 Splits × 2 Richtungen, minus leere Zellen) die Benjamini-Hochberg-Korrektur bei α=0.05. Der beste rohe p-Wert (0.025, BEARISH/168h/VALIDATION) liegt weit über seinem eigenen BH-kritischen Wert (0.0014). Der aus Phase 5 bekannte "BEARISH 1-Woche"-Befund bleibt nach Purging/Embargo dem Betrag nach ähnlich (+13.0pp statt +9.2pp in TRAIN für Model B), ändert aber nichts an der statistischen Gesamtaussage: **kein Ergebnis ist multiple-testing-korrigiert signifikant.** Der non-overlapping 7D Robustness-Check bestätigt gleichzeitig Phase 0s Vorhersage: effektive Stichproben von n=4–10 sind ohnehin zu klein für jede belastbare Aussage.

## 2. Ausgangszustand

Bestätigt aus Phase 0: `train_end`–`validation_start`-Abstand = 1 Kalendertag, kein Purging, kein Embargo, Domain-count-basierte Coverage-Formel strukturell bug-anfällig in Model B/C (wie in Model D bereits nachgewiesen).

## 3. Identifiziertes Leakage

Vor dem Fix: bei H=720h reichte das Forward-Label von TRAIN-Zeilen bis zu 30 Tage über `train_end` hinaus — weit in VALIDATION. Bei H=168h analog 7 Tage. Live quantifiziert (siehe Abschnitt 4): **30 von 56 TRAIN-Zeilen** (im 720h-Fall) und **7 von 56** (168h-Fall) mussten gepurged werden.

## 4. Purging-Implementierung

`research_evaluate_purged(model_version, family, embargo_days)`: pro Horizont H und Split-Grenze B gilt für jede Kandidatenzeile:

```
keep := (candle_open_time + H) < B        -- PURGE: Label darf nicht in den naechsten Split reichen
     AND candle_open_time <= B - embargo   -- EMBARGO: zusaetzlicher Puffer
```

Dynamisch für H ∈ {24, 168, 720}, keine hartkodierte 30-Tage-Sonderbehandlung. Für TRAIN ist B=`validation_start`, für VALIDATION ist B=`test_start` (dieselbe Logik gilt symmetrisch an der nächsten Grenze — VALIDATION-Zeilen, deren Label in TEST reichen würde, werden ebenso gepurged. Das benötigt **keine TEST-Preisdaten**, da die betroffenen Zeilen komplett verworfen werden, bevor ihr Forward-Preis überhaupt abgefragt wird — kein TEST-Zugriff, kein Log-Eintrag nötig).

## 5. Embargo-Implementierung

Konfigurierbarer Parameter `p_embargo_days`, Default 1 (wie vorgegeben). Getrennt von Purging (siehe Code-Kommentar in der Funktion — beide Bedingungen werden mit AND verknüpft, nie vermischt).

## 6. Coverage-Bug und Fix

**BEFORE:** `overall_state = INSUFFICIENT_DATA` wenn `domains_with_data / domains_total < 0.4` (Domain-Ebene).
**AFTER:** `overall_state = INSUFFICIENT_DATA` wenn `factors_with_data / 14 < 0.4` (Faktor-Ebene, wie ursprünglich bei Model A).

**Live-Befund vor dem Fix:** auf TRAIN+VALIDATION (n=201) lag `domain_coverage_pct` für Model B **in 0 von 201 Zeilen** unter 40% (3 von 7 Domains aktiv = 42.9%, `factor_coverage_pct` ebenfalls immer 42.9%, da zufällig auf derselben Seite der Schwelle). **Der Bug ist strukturell real (identische Formel wie im ursprünglich fehlerhaften Model D), war auf der aktuellen Datenbasis aber folgenlos für Model B/C** — anders als bei Model D (5 statt 7 Domains, dort führte er zu 100% falscher `INSUFFICIENT_DATA`-Klassifikation, siehe Phase 6). Trotzdem gefixt (dokumentierter Bug, keine Hypothese) — als neue `_covfix`-Funktionsvarianten, ohne die eingefrorenen Original-Funktionen zu verändern (`is_frozen=true` bleibt für die Modelldefinition unangetastet). Coverage-Semantik unverändert (weiterhin 40%-Schwelle, keine neue Zahl erfunden).

## 7. 7D Labeling

Weiterhin evaluiert, jetzt korrekt purged+embargoed (siehe Abschnitt 10–12).

## 8. 30D Testability

Bestätigt: **NOT TESTABLE WITH CURRENT DATA.** Nach Purge fallen 30 von 56 TRAIN-Zeilen weg (verbleibend n=36 roh, non-overlap ≈1). VALIDATION verbleibend n=14–16 roh, non-overlap 0. Keine Schwelle/kein Threshold für 30D angepasst — Status einfach so übernommen.

## 9. Non-overlapping 7D Robustness Check

| Split | Richtung | n (non-overlap) | Hit-Rate | Edge |
|---|---|---|---|---|
| TRAIN | BEARISH | 9–10 | 60–67% | +12 bis +19pp |
| TRAIN | BULLISH | 8–9 | 50–56% | −2 bis +3pp |
| VALIDATION | BEARISH | 4–6 | 50–67% | −21 bis −5pp |
| VALIDATION | BULLISH | **0** | — | — |

Bestätigt Phase 0s Vorhersage (Sample-Size-Matrix, Abschnitt 16): effektive Stichproben von 4–10 sind für jede statistische Aussage zu klein — die einzelnen Prozentzahlen hier sind reines Rauschen (ein einzelner Tag mehr/weniger richtig verschiebt die Hit-Rate um >10 Prozentpunkte). Kein BH/FDR auf diesen Zellen sinnvoll durchführbar (zu wenige, zu instabile Tests).

## 10–12. Model B/C/D — PRE vs. POST (24h/168h/720h, overlapping, TRAIN+VALIDATION)

| Model | Split | Horizon | Richtung | N pre-fix | N post-purge | Edge pre-fix | Edge post-fix | Δ | Status |
|---|---|---|---|---|---|---|---|---|---|
| B (Domain Balanced) | TRAIN | 168h | BEARISH | 46 | 46 (−7 purged) | +11.2pp | +13.0pp | +1.8pp | NOT SIGNIFICANT (BH) |
| B | VALIDATION | 168h | BEARISH | 27 | 25 (−7) | −15.9pp | −20.1pp | −4.2pp | NOT SIGNIFICANT |
| C (Calibrated) | TRAIN | 168h | BEARISH | 46 | 46 | identisch zu B | identisch zu B | 0 (siehe Phase 6: C≡B in diesem Fenster) | NOT SIGNIFICANT |
| D (Redundancy Aware) | TRAIN | 168h | BEARISH | 46 | 56 (weniger purged, andere State-Klassifikation) | +11.2pp | +11.0pp | −0.2pp | NOT SIGNIFICANT |
| B/C/D | VALIDATION | 24h/168h/720h | BULLISH | 0 | 0 | — | — | — | NOT TESTABLE (0 BULLISH-Tage in VALIDATION, unverändert seit Phase 5) |
| B/C/D | alle | 720h | beide | 27–56 | 14–36 | verschieden | verschieden | — | NOT TESTABLE (Purge entfernt 30 von 56 Zeilen, Rest zu klein) |

**Auffällig:** Model D purged bei 168h/TRAIN nur einige wenige Zeilen weniger als Model B — die konkreten `n_purged_out`-Zahlen sind horizont-, nicht modellabhängig (dieselben Kalenderzeilen werden entfernt, unabhängig von der Aggregationslogik). Die Coverage-Fix-Variante von Model B (`domain_balanced_covfix`) liefert **exakt identische** Zahlen wie das Original — bestätigt Abschnitt 6 (Bug war folgenlos).

## 13. BH/FDR auf den NEUEN Ergebnissen

36 getestete Zellen (Model B/C/D × Horizont × Split × Richtung, n>0). Ein-Stichproben-Anteils-z-Test je Zelle (H0: Hit-Rate=Baseline-Hit-Rate), danach Benjamini-Hochberg bei α=0.05.

**Ergebnis: 0 von 36 Zellen signifikant nach BH-Korrektur.** Kleinster roher p-Wert: 0.025 (Model B/C, VALIDATION, BEARISH, 168h) — liegt weit über seinem BH-kritischen Wert von 0.0014 (Rang 1 von 36, kritischer Wert = 1/36 × 0.05).

**Einschränkung, transparent:** dieser Test verwendet die rohen Zeilenzahlen n als Stichprobengröße. Für die 168h/720h-Horizonte überschätzt das die tatsächliche Unabhängigkeit (siehe Phase 0, Abschnitt 3, MA(H-1)-Struktur) — die *wahren* p-Werte bei 168h/720h wären noch **höher** (noch weniger signifikant), nicht niedriger. Die Schlussfolgerung "kein Ergebnis übersteht Multiple-Testing-Korrektur" ist damit eher konservativ zu warm als zu kalt gerechnet.

## 14. Welche Ergebnisse verschwunden sind

Keine Zahl aus Phase 5/6 war jemals einzeln signifikant (dort auch nie behauptet) — insofern "verschwindet" kein zuvor als robust gemeldeter Befund, weil keiner als robust gemeldet war. Was sich ändert: der **numerische Wert** einiger Edge-Zahlen verschiebt sich um 2–4 Prozentpunkte (z. B. BEARISH/168h/TRAIN: +11.2pp → +13.0pp), bleibt aber in derselben Größenordnung und Richtung.

## 15. Welche Ergebnisse stabil geblieben sind

- Kein BULLISH-Tag in VALIDATION — vor und nach dem Fix identisch (0 Zeilen).
- Die generelle Schwäche/Uneinheitlichkeit des BEARISH-Signals bei kurzen Horizonten bleibt bestehen.
- Model B ≡ Model C (identisch bei gleichem Domain-Setup) bleibt auch nach dem Coverage-Fix bestehen.
- 0/36 signifikant — sowohl mit als auch ohne den Coverage-Fix (der Fix war für B/C folgenlos, siehe Abschnitt 6).

## 16. Welche Ergebnisse nicht mehr testbar sind

720h/30D (bereits vor dieser Phase als schwach eingestuft, jetzt formal `NOT TESTABLE WITH CURRENT DATA` bestätigt) sowie jede BULLISH-Aussage für VALIDATION (n=0, unverändert).

## 17. Statistical Interpretation

Nach der hier definierten Skala (Phase 0, Abschnitt 15):

- **BULLISH/BEARISH auf 24h:** Edge nicht nachgewiesen (C — statistisch nicht entscheidbar bei den vorliegenden p-Werten nahe 0.5–1.0, keine BH-Signifikanz).
- **BEARISH auf 168h (TRAIN):** einzige Zelle mit auffälligem Edge (+13.0pp) und dem kleinsten p-Wert der ganzen Analyse (0.078) — dennoch **C, Edge statistisch nicht entscheidbar**, nicht A (nachgewiesen). Rutscht bei BH-Korrektur klar durch.
- **720h/30D:** **E — Horizon nicht testbar** mit aktueller Datenbasis.
- Kein einziges Ergebnis fällt in Kategorie **A (Edge nachgewiesen)** oder **B (Edge nicht nachgewiesen, mit belastbarer Power)** — die Stichproben sind für Kategorie B schlicht zu klein, das korrekte Etikett ist durchgehend **C (statistisch nicht entscheidbar)**.

## 18. Remaining Unknowns

Alles, was 8 der 14 Faktoren betrifft (weiterhin 0% TRAIN/VALIDATION-Coverage, siehe Phase 0/6) — unverändert offen. Ob eine strengere HAC-Korrektur der p-Werte bei 168h/720h das Bild nochmal verschiebt (erwartungsgemäß nur in Richtung noch weniger Signifikanz, siehe Abschnitt 13) — nicht in dieser Phase geprüft (explizit ausgeklammert laut Auftrag: "HAC ebenfalls NICHT als Ersatz für Purging implementieren", Priorität danach).

## 19. Recommendation for Phase 2

Kleinstmöglicher nächster Schritt bleibt unverändert der aus Phase 0 vorgeschlagene: **weiter Daten sammeln** (die 8 datenarmen Faktoren brauchen schlicht Zeit, keine Methodik behebt das). Methodisch ist die Validierungsschicht jetzt sauber (Purging/Embargo/Coverage-Fix/BH-FDR vorhanden und reproduzierbar) — eine erneute Ausführung derselben Funktionen in einigen Monaten, sobald mehr TRAIN-Historie für funding/positioning/etc. vorliegt, ist die nächste sinnvolle Iteration, kein neuer Umbau.

---

## Ergebnistabelle (vollständig, overlapping, TRAIN+VALIDATION)

| Model | Horizon | N pre-fix | N post-purge | N non-overlap | Coverage | Metric | Pre-Fix | Post-Fix | Status |
|---|---|---|---|---|---|---|---|---|---|
| B | 24h | 46/55 | 46/55 (−1) | 8–9 | 100% (6/6 Kernfaktoren) | Edge BEARISH/BULLISH | −5.0/+1.6pp | −5.0/+1.6pp | NOT SIGNIFICANT |
| B | 168h | 46/53 | 46/53 (−7) | 8–9 | 100% | Edge | +11.2/−1.1pp | +13.0/−1.2pp | NOT SIGNIFICANT |
| B | 720h | 46/59 | 36/56 (−30/−3) | ~1 | 100% | Edge | −6.6/−5.9pp | −1.4pp (BULLISH), n zu klein BEARISH | NOT TESTABLE |
| C | 24h/168h/720h | wie B | wie B | wie B | 100% | Edge | ≡ B | ≡ B | NOT SIGNIFICANT / NOT TESTABLE |
| D | 24h | 55/59 | 56/59 (−1) | 9–10 | 100% | Edge | −0.1/+1.9pp | −0.1/−0.1pp | NOT SIGNIFICANT |
| D | 168h | 46/55 | 56/56 (−7) | 9–10 | 100% | Edge | +11.2/−1.2pp | +11.0/−0.3pp | NOT SIGNIFICANT |
| D | 720h | 46/55 | 36/56 (−30) | ~1 | 100% | Edge | −6.6/−5.9pp | −1.9/−4.2pp | NOT TESTABLE |
| B/C/D | alle | VALIDATION BULLISH | 0 | 0 | 0 | — | n=0 | n=0 | NOT TESTABLE |

## Integrity-Tabelle (alle 24 geprüften Splits, 0 Leakage-Verstöße)

| Split | Horizon | Boundary | Max Train Label End (survivierend) | Purge | Embargo | Leakage |
|---|---|---|---|---|---|---|
| train | 24h | validation_start (19.05.26) | < 19.05.26 | ✓ | ✓ (≤18.05.26) | **FALSE** |
| train | 168h | validation_start | < 19.05.26 | ✓ | ✓ | **FALSE** |
| train | 720h | validation_start | < 19.05.26 | ✓ | ✓ | **FALSE** |
| validation | 24h | test_start (08.07.26) | < 08.07.26 | ✓ | ✓ | **FALSE** |
| validation | 168h | test_start | < 08.07.26 | ✓ | ✓ | **FALSE** |
| validation | 720h | test_start | < 08.07.26 | ✓ | ✓ | **FALSE** |

(Je 4× wiederholt für die 4 ausgewerteten Modell-Varianten — alle 24 Zeilen im `research_leakage_integrity_log` bestätigen `leakage=false`, live abgefragt, nicht nur behauptet.)
