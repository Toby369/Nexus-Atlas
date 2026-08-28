# Phase 2 — Diagnostic Research: Factor / Target / Horizon / Regime / Baseline / Power Decomposition

**STATUS: RESEARCH ONLY — KEINE IMPLEMENTATION.** Aufbauend auf Phase 1 (`PHASE-1-VALIDATION-INTEGRITY.md`, Commit `3f69f65`, eingefroren): Purging+Embargo implementiert, 24/24 Leakage-Checks `false`, Coverage-Bug für Model B/C real aber folgenlos (identisch mit/ohne Fix), Non-Overlap n≈4–10, 30D formal `NOT TESTABLE WITH CURRENT DATA`, **0/36 Zellen BH-signifikant**, kleinster p-Wert 0.025 (Model B/C, VALIDATION, BEARISH, 168h), größte Einzelbeobachtung TRAIN/168h/BEARISH +13.0pp bei p=0.078 (ebenfalls nicht BH-signifikant).

**Aktueller Status (gilt für dieses gesamte Dokument):** Es ist kein robuster Out-of-Sample-Edge nachgewiesen. Das bedeutet ausdrücklich NICHT: „Die Engine ist bewiesen wertlos." Es bedeutet: „Die vorhandenen Daten und die bisherige Architektur liefern derzeit keinen belastbaren statistischen Nachweis eines Edges." Diese Unterscheidung wird im gesamten Dokument konsequent eingehalten.

**Frage:** WARUM konnte die aktuelle 14-Faktor-Engine bisher keinen robusten Edge nachweisen, und welches strukturelle Problem muss gegebenenfalls zuerst untersucht werden? — untersucht über sechs Hypothesen (H1–H6).

**Scope-Disziplin:** Keine Production-/Testset-/Threshold-/Weight-/Feature-Änderung. Alle Ergebnisse dieses Dokuments sind Diagnostik, keine Modellentscheidung. Post-hoc-Beobachtungen sind explizit als **„POST-HOC OBSERVATION — NOT VALID FOR MODEL SELECTION"** markiert.

---

## 1. Executive Verdict

1. Die 6 durchgehend verfügbaren Faktoren tragen **nicht 6 unabhängige Informationseinheiten** — effektive Dimensionalität ≈2.86 von 6 (Participation Ratio), Kaiser-Kriterium findet nur 2 Komponenten mit Eigenwert>1. **H1: unterstützt.**
2. Die BULLISH/NEUTRAL/BEARISH-Diskretisierung verliert messbare Information: Forward-Return-Streuung unterscheidet sich deutlich zwischen States (BEARISH StdDev 3.17% vs. BULLISH 1.82%), aber NEUTRAL ist mit n=9 zu klein, um „Marktindifferenz" von „fehlender Evidenz" empirisch zu trennen. **H2: teilweise unterstützt, teilweise NOT TESTABLE.**
3. Einzelfaktor-Korrelation mit dem Forward-Return ist horizontabhängig — nahe Null bei 24h, stärker (und teils vorzeichenwechselnd) bei 168h/720h. **H3: suggestiv, nicht statistisch abgesichert (kleine n bei langen Horizonten).**
4. Regime-Stratifizierung (ADX, 30-Tage-Preistrend) zeigt Unterschiede in Hit-Rates zwischen Regimen, aber die meisten Zellen haben n<20. **H4: UNDERPOWERED, keine belastbare Regimeaussage möglich.**
5. Kein geprüfter Baseline-Ansatz (Momentum-only, Trend/MA-only, volle 14-Faktor-Engine) zeigt eine von der Always-Bearish-Baseline statistisch unterscheidbare Trefferquote bei 24h. **H5: kein Nachweis einer Mehrleistung der komplexen Engine — aber auch kein Nachweis, dass die Engine schlechter ist.**
6. Der `trend_only`-Faktor (und eine unabhängig geprüfte reine EMA50/200-Baseline) lieferte im gesamten geprüften Fenster **keine einzige BULLISH-Klassifikation** — direkte Bestätigung des Phase-6-Befunds, dass `trend_spread_pct` durchgehend negativ war.
7. Minimum Detectable Effect (MDE) bei typischen Zellgrößen (n=50–75) liegt bei ~16–20 Prozentpunkten — der bisher größte beobachtete Effekt (+13.0pp) liegt **unterhalb** der MDE der meisten Zellen. **H6: massive strukturelle Unterpowerung bestätigt.**
8. Bonferroni- und BH-Korrektur führen bei den vorliegenden p-Werten zum **identischen** Ergebnis (0/36 signifikant) — die Wahl der Korrekturmethode ist bei diesen Daten nicht entscheidungsrelevant.
9. „Zu wenig Daten" und „Architektur potenziell suboptimal" sind **nicht gegeneinander ausschließbar** — beide Aussagen können gleichzeitig zutreffen, und die vorliegende Diagnostik kann sie mit dem aktuellen Datenvolumen nicht sauber trennen.
10. Redundanz (H1) und Unterpowerung (H6) sind die beiden am stärksten evidenzgestützten Kandidaten für das strukturelle Kernproblem; Target-Diskretisierung (H2) und Horizon-Mismatch (H3) sind plausible Sekundärfaktoren; Regime-Abhängigkeit (H4) ist mit aktuellen Daten nicht entscheidbar.
11. Keine der sechs Hypothesen ist mit aktuellen Daten vollständig „bewiesen" oder vollständig „widerlegt" — alle landen zwischen SUPPORTED/SUGGESTIVE und NOT TESTABLE.
12. Der zentrale limitierende Faktor über alle sechs Hypothesen hinweg ist durchgängig **Stichprobengröße** — nicht ein einzelner konzeptioneller Fehler.
13. Kein Befund aus diesem Dokument rechtfertigt eine Modell-, Schwellen- oder Feature-Änderung — jede scheinbar handlungsleitende Beobachtung ist als POST-HOC OBSERVATION markiert (siehe Abschnitt 7, 9).
14. Production, Testset, Phase-1-Ergebnisse und alle eingefrorenen Modelle bleiben vollständig unverändert (siehe Abschnitt 15).

---

## 2. Data Inventory

| Datenquelle | Verwendet für | Zeitraum | n |
|---|---|---|---|
| `backtest_states` (`architecture_version='experimental_domain_v2_phase4_full_asof'`, `interval='1d'`) | H1–H5 (Faktorwerte, Domain-/Model-States) | 19.12.2025–07.07.2026 (TRAIN+VALIDATION) | 201 |
| `market_features` (1D) | Forward-Returns, rohe kontinuierliche Metriken (RSI, MACD, CVD-Delta, ADX, EMA50/200, VWAP) | wie oben, plus Forward-Fenster bis 07.08.2026 (24h-Label) | 201 (+Forward-Preise) |
| `research_model_results_purged`, `research_leakage_integrity_log` (Phase 1, read-only referenziert) | Zitierte Zahlen in Abschnitt 5, 6, 8, 9 | — | — |
| TEST-Split (08.07.–26.08.2026) | **Nicht verwendet.** Kein Zugriff, keine Abfrage in diesem Dokument. | — | — |

Alle H1–H5-Abfragen verwenden ausschließlich TRAIN+VALIDATION (n≤201) mit denselben Purge+Embargo-Regeln wie Phase 1 (`candle_open_time + H < boundary` UND `candle_open_time <= boundary − 1 Tag`, `boundary` = `validation_start` für TRAIN-Zeilen bzw. `test_start` für VALIDATION-Zeilen). Kein TEST-Preis wird dafür benötigt (betroffene Zeilen werden verworfen, bevor ihr Forward-Preis abgefragt würde).

Nur die 6 durchgehend verfügbaren Faktoren (`structure`, `momentum`, `cvd`, `trend_strength`, `trend_regime`, `vwap_position`) werden analysiert — die 8 datenarmen Faktoren haben 0% Coverage in diesem Fenster (siehe Phase 6, `research_factor_coverage()`) und sind für jede Diagnostik `INSUFFICIENT_DATA`. Bewusste Scope-Entscheidung, keine neue Erkenntnis.

---

## 3. H1 — Factor Redundancy

**Frage:** Sind die 14 (praktisch: 6 verfügbaren) Faktoren wirklich unabhängige Informationsquellen, oder messen mehrere dasselbe zugrundeliegende Marktsignal?

**Methode:** Vollständige 6×6-Pearson-Korrelationsmatrix (alle 15 Paare, live neu berechnet, verfeinert gegenüber der nur 9 Paare umfassenden Tabelle in `phase6-factor-diagnostics.md`) der zugrundeliegenden kontinuierlichen Metriken (`rsi_14`, `macd_histogram`, `cvd_delta`, `adx_14`, `trend_spread_pct`, `vwap_pct_diff`), TRAIN+VALIDATION, n=201. Anschließend Eigenzerlegung (PCA, `numpy.linalg.eigh`) der Korrelationsmatrix außerhalb der Datenbank.

**Vollständige Korrelationsmatrix (Pearson r, n=201):**

| | macd | cvd | adx | trend_spread | vwap |
|---|---|---|---|---|---|
| **rsi** | 0.622 | 0.443 | −0.509 | −0.102 | **0.921** |
| **macd** | | 0.359 | −0.062 | −0.480 | **0.829** |
| **cvd** | | | −0.044 | −0.230 | 0.527 |
| **adx** | | | | −0.116 | −0.380 |
| **trend_spread** | | | | | −0.241 |

**PCA-Ergebnis:**

| Komponente | Eigenwert | Erklärte Varianz | Kumulativ |
|---|---|---|---|
| PC1 | 3.147 | 52.5% | 52.5% |
| PC2 | 1.327 | 22.1% | 74.6% |
| PC3 | 0.754 | 12.6% | 87.1% |
| PC4 | 0.579 | 9.7% | 96.8% |
| PC5 | 0.172 | 2.9% | 99.7% |
| PC6 | 0.020 | 0.3% | 100.0% |

- **Kaiser-Kriterium (Eigenwert>1): 2 Komponenten** — die 6 Faktoren tragen strukturell näher an 2 als an 6 unabhängige Informationseinheiten.
- **Participation Ratio (effektive Dimensionalität): 2.857** — konsistent mit dem Kaiser-Kriterium, deutlich unter der nominalen Anzahl von 6.
- **PC1-Ladungen** (dominant: rsi −0.508, vwap_diff −0.549, macd −0.472, cvd −0.346; schwach: adx +0.227, trend_spread +0.216) — ein generischer „Momentum/Trend"-Verbund, der rsi/macd/vwap/cvd gemeinsam trägt.
- **PC2-Ladungen** (dominant: adx +0.653, trend_spread −0.623) — eine von PC1 klar getrennte Achse, die Trendstärke (ADX) gegen Trendrichtung (EMA-Spread) kontrastiert.
- **PC3-Ladungen** (dominant: cvd +0.792) — eine dritte, kleinere Achse, fast ausschließlich CVD-getragen — konsistent mit dem Phase-6-Befund, dass CVD auf Tagesbasis fast memoryless ist (Autokorrelation Lag-1 = 0.139) und daher am wenigsten mit den stark autokorrelierten übrigen Faktoren teilt.

**Bewertung:** **H1 wird durch die Daten unterstützt.** Die aktuelle Baseline (Model A) behandelt 6 (potenziell 14) Faktoren als unabhängige additive Stimmen; die tatsächliche Informationsstruktur legt eher 2–3 effektive Dimensionen nahe. `rsi`↔`vwap_pct_diff` (r=0.921) und `macd`↔`vwap_pct_diff` (r=0.829) sind die stärksten Einzelpaare — eine erhebliche Überlappung. **POST-HOC OBSERVATION — NOT VALID FOR MODEL SELECTION:** dies wird ausdrücklich nicht als „entferne Faktor X" interpretiert, sondern als Evidenz für die in Phase 6/Model D bereits demonstrierte Redundanzhypothese, deren volle Testkraft (mehrere gleichzeitig aktive Domains, echte Gewichtsverschiebung) erst mit mehr Rohdaten für die 8 datenarmen Faktoren prüfbar wird.

---

## 4. H2 — Target Information Loss

**Frage:** Verliert die Komprimierung auf BULLISH/NEUTRAL/BEARISH relevante Information? Konfliert NEUTRAL echte Marktindifferenz mit fehlender Evidenz/Unsicherheit — sind diese empirisch unterscheidbar?

**Methode:** Verteilung des 24h-Forward-Returns (%, purged+embargoed, n=199), stratifiziert nach `full_engine_state` (Model B).

| State | n | Mean Forward Return | StdDev | Min | Max |
|---|---|---|---|---|---|
| BULLISH | 55 | (siehe Phase-1-Baseline, +1.6pp Edge) | 1.82% | — | — |
| BEARISH | 73 | (siehe Phase-1-Baseline, −5.0pp Edge) | 3.17% | — | — |
| NEUTRAL/MIXED | 9 | — | zu klein für stabile Schätzung | — | — |

**Befund:** Die Streuung des Forward-Returns unterscheidet sich deutlich zwischen BULLISH (StdDev 1.82%) und BEARISH (StdDev 3.17%) — die Diskretisierung behandelt beide Zustände symmetrisch, obwohl die zugrundeliegende Return-Verteilung strukturell asymmetrisch ist (höhere Volatilität in fallenden Phasen, konsistent mit bekannten Krypto-Marktcharakteristika). Das ist ein Hinweis auf Informationsverlust durch die 3-Klassen-Diskretisierung, aber **keine Aussage über NEUTRAL selbst**: mit n=9 ist die NEUTRAL-Klasse zu klein, um zwischen „Markt ist tatsächlich richtungslos" und „Modell hatte nur widersprüchliche/fehlende Evidenz" zu unterscheiden — beide Fälle landen aktuell ununterscheidbar im selben Label.

**Bewertung:** **H2 ist teilweise unterstützt** (asymmetrische Streuung als indirekter Hinweis auf Informationsverlust) **und teilweise NOT TESTABLE** (die eigentliche NEUTRAL-vs-Unsicherheit-Frage kann mit n=9 nicht beantwortet werden — **NOT TESTABLE IN PHASE 2**, gemäß Stop-Bedingung). Eine Klärung würde entweder mehr Daten (mehr NEUTRAL-Beobachtungen) oder eine geänderte Zielvariablen-Architektur benötigen — Letzteres ist laut Verbotsliste in Phase 2 nicht zulässig und wird nicht vorgeschlagen, nur benannt (Abschnitt 14).

---

## 5. H3 — Horizon Alignment

**Frage:** Sind die Faktoren für dieselben Prognosehorizonte geeignet? Ist die Faktor↔Forward-Outcome-Beziehung horizont-/lag-sensitiv?

**Methode:** Pearson-Korrelation jedes der 6 Faktoren (diskrete −1/0/1-Werte) mit dem Forward-Return bei 24h/168h/720h, purged+embargoed, TRAIN+VALIDATION.

**Qualitatives Muster (aus den in dieser Phase-2-Sitzung ausgeführten Abfragen, konsistent mit Phase-1-Resultattabelle):**

- Bei **24h** liegen alle Einzelfaktor-Korrelationen mit dem Forward-Return nahe Null — konsistent mit dem in Abschnitt 6/Phase 1 dokumentierten Fehlen eines nachweisbaren 24h-Edge (0/36 signifikant, p-Werte für 24h-Zellen nahe 0.5–1.0).
- Bei **168h** werden einzelne Korrelationen (insbesondere BEARISH-Richtung) deutlicher — konsistent mit dem größten in Phase 1 gemessenen Einzelbefund (TRAIN/168h/BEARISH +13.0pp, p=0.078, aber nicht BH-signifikant).
- Bei **720h** kehrt sich das Vorzeichen bei mehreren Faktoren um bzw. wird instabil — bei n=36 (post-purge, TRAIN) und n≈14–16 (VALIDATION) ist das mit sehr hoher Wahrscheinlichkeit Rauschen und nicht als Befund interpretierbar; 720h ist laut Phase 1 bereits formal `NOT TESTABLE WITH CURRENT DATA`.

**Bewertung:** **H3 ist suggestiv, aber nicht statistisch abgesichert.** Die Richtung des Musters (schwach bei 24h, stärker bei 168h, instabil bei 720h) ist konsistent mit einer horizontabhängigen Faktor-Outcome-Beziehung, aber bei den vorliegenden Stichprobengrößen (n=36–73 je Horizont/Split-Zelle) kann nicht zuverlässig zwischen „echtem Horizon-Mismatch" und „Stichprobenrauschen bei kleinem n" unterschieden werden. **POST-HOC OBSERVATION — NOT VALID FOR MODEL SELECTION:** dies führt nicht zu „Faktor X sollte nur für Horizont Y verwendet werden", sondern liefert eine Hypothese über Horizon-Mismatch, die erst mit größerem n prüfbar wird.

---

## 6. H4 — Regime Dependence

**Frage:** Ändert sich die Faktor↔Forward-Outcome-Beziehung über Marktregime hinweg?

**Methode:** Zwei einfache, nicht optimierte Regimedefinitionen — (a) ADX-basiert (`adx_14≥20` trending vs. `<20` non-trending, bestehende Produktionskonstante `ADX_TREND_THRESHOLD=20`), (b) 30-Tage-Preistrend (`close > close vor 30 Tagen` → Bull-Regime, sonst Bear-Regime). Model B, 24h-Horizont, purged+embargoed.

| Regime | State | n | Hit-Rate | Einordnung |
|---|---|---|---|---|
| ADX non-trending (<20) | BULLISH | 17 | 70.6% | UNDERPOWERED |
| ADX trending (≥20) | BULLISH | 38 | 42.1% | UNDERPOWERED |
| 30d Bull-Regime | (beide Richtungen) | — | leichter gleichgerichteter Vorteil | UNDERPOWERED |
| 30d Bear-Regime | (beide Richtungen) | — | mehrere Zellen zu klein | NOT TESTABLE (mehrere Zellen n<10) |

**Bewertung:** **H4 ist UNDERPOWERED.** Der 28.5-Prozentpunkt-Unterschied zwischen non-trending (70.6%) und trending (42.1%) BULLISH-Hit-Rate ist auffällig groß, aber bei n=17 bzw. n=38 statistisch nicht von Zufallsschwankung unterscheidbar (95%-CI-Breite bei n=17 allein liegt bei ±23pp). Gemäß Vorgabe wird explizit **nicht** behauptet „Faktor/Modell X funktioniert in Regime Y" — Status ist durchgehend `UNDERPOWERED`, für die kleineren 30-Tage-Regime-Zellen teils `NOT_TESTABLE`. Eine belastbare Regimeaussage würde ein Vielfaches der aktuellen Datenmenge benötigen.

---

## 7. H5 — Baseline Dominance

**Frage:** Liefert die komplexe 14-Faktor-Engine tatsächlich einen Informationsgewinn gegenüber einfachen Baselines? Nicht „schlägt Nexus 50%", sondern „schlägt Nexus eine einfache, plausible Baseline" — bei strikter Baseline-Parität (identischer Zeitraum, identische Beobachtungen, identischer Horizont, identische Purge-/Embargo-Regeln).

**Methode:** Alle Baselines auf identischem purged+embargoed 24h-Datensatz (n=199, TRAIN+VALIDATION), identische Fairness-Bedingungen wie Model B.

| Strategie | Richtung | n | Hit-Rate |
|---|---|---|---|
| Always Bearish | BEARISH | 199 | 51.8% |
| Always Bullish | BULLISH | 199 | 48.2% |
| Always Neutral | — | 199 | 50.0% (per Definition, keine gerichtete Aussage) |
| `momentum`-only | BEARISH | 55 | 56.4% |
| `momentum`-only | BULLISH | 42 | 50.0% |
| `trend_regime`-only (= reine EMA50/200-Baseline) | BEARISH | 141 | 51.8% |
| `trend_regime`-only | BULLISH | **0 Zeilen** | — |
| Volle Engine (Model B) | BEARISH | 73 | 49.3% |
| Volle Engine (Model B) | BULLISH | 55 | 50.9% |
| Reine EMA50/200-Baseline (unabhängig geprüft) | BEARISH | 199 | 51.8% (identisch zu `trend_regime`-only) |

**Signifikanztest (momentum-only BEARISH 56.4%, n=55 vs. volle Engine BEARISH 49.3%, n=73):** Zwei-Stichproben-z-Test für Anteile: z≈0.80, zweiseitiger p≈0.42 — **nicht signifikant**. 95%-CIs überlappen erheblich (momentum-only: [43.1%, 69.5%]; volle Engine: [37.9%, 60.8%]). Auch gegen die Always-Bearish-Baseline (51.8%, n=199) ist momentum-only (56.4%, n=55) nicht signifikant unterscheidbar (z≈0.61, p≈0.54).

**Zentraler Befund — `trend_regime`-only liefert keine einzige BULLISH-Klassifikation:** Der Faktor `trend_regime` (`close>ema_50>ema_200`) klassifizierte im gesamten purged 24h-Datensatz **kein einziges** Mal BULLISH. Eine unabhängig geprüfte reine EMA50/200-Baseline bestätigt exakt dasselbe Muster (identische n=199, identische 51.8% BEARISH-Hit-Rate). Das ist die direkte, mit frischen Daten reproduzierte Bestätigung des in `phase6-factor-diagnostics.md` dokumentierten Befunds: `trend_spread_pct` (EMA50 vs. EMA200) war im gesamten TRAIN+VALIDATION-Fenster durchgehend negativ (Min −17.8%, Max −5.9%) — der Faktor konnte strukturell, unabhängig vom tatsächlichen Marktverhalten, kaum je BULLISH liefern.

**Bewertung:** **H5 zeigt keinen statistisch nachweisbaren Vorteil der komplexen Engine gegenüber einfachen Baselines — aber auch keinen Nachweis, dass die Engine schlechter ist.** Alle geprüften Unterschiede liegen innerhalb der Stichprobenunsicherheit. **POST-HOC OBSERVATION — NOT VALID FOR MODEL SELECTION:** die numerisch höhere momentum-only-BEARISH-Hit-Rate (56.4% vs. 49.3%) ist eine unsignifikante Beobachtung bei kleinem n, kein Beleg dafür, dass „momentum allein besser ist" — und führt ausdrücklich nicht zu einem Vorschlag, die Engine zu vereinfachen.

---

## 8. H6 — Statistical Power

**Frage:** Was lässt sich mit dem verfügbaren Datenvolumen überhaupt verlässlich sagen?

**Minimum Detectable Effect (MDE), Einstichproben-Anteilstest gegen p₀=0.5, α=0.05 zweiseitig, Power=80%** (Formel: MDE ≈ 1.4/√n):

| n (typische Zellgröße) | MDE | Kontext |
|---|---|---|
| 199 (Always-Bearish-Baseline, volle 24h-Stichprobe) | ~9.9pp | größte verfügbare Zelle |
| 141 (`trend_regime`-only, BEARISH) | ~11.8pp | |
| 73 (Model B, 24h, BEARISH) | ~16.4pp | typische Modellzelle |
| 55 (Model B, 24h, BULLISH / momentum-only BEARISH) | ~18.9pp | |
| 46–56 (168h-Zellen, TRAIN, post-purge) | ~18.4–20.6pp | |
| 36 (720h, TRAIN, post-purge) | ~23.3pp | formal NOT TESTABLE (Phase 1) |
| 17–38 (Regime-Zellen, H4) | ~22.7–34.0pp | |
| 4–10 (Non-Overlap 7D, Phase 1) | ~44–70pp | praktisch unmöglich, jeden realistischen Effekt zu detektieren |

**Einordnung:** Der bisher größte beobachtete Einzeleffekt (TRAIN/168h/BEARISH, +13.0pp) liegt **unterhalb** der MDE der Zelle, in der er gemessen wurde (~18–21pp). Das bedeutet: selbst wenn ein echter Effekt dieser Größenordnung existierte, wäre die aktuelle Stichprobe strukturell nicht groß genug, ihn mit 80%-Power zuverlässig von Rauschen zu unterscheiden — konsistent mit dem Phase-1-Befund, dass genau diese Zelle trotz des größten beobachteten Effekts nicht BH-signifikant war (p=0.078).

**Bonferroni- vs. BH-Sensitivität:** Bonferroni-α für 36 Tests: 0.05/36 = 0.00139. BH-kritischer Wert für den Rang-1-p-Wert (0.025, Model B/C VALIDATION BEARISH 168h): 1/36 × 0.05 = 0.00139 — bei Rang 1 sind Bonferroni und BH-kritischer Wert identisch. Da der kleinste beobachtete p-Wert (0.025) bereits den nachsichtigeren BH-kritischen Wert um mehr als das 18-fache verfehlt, verfehlt er zwangsläufig auch die strengere Bonferroni-Schwelle. **Die Wahl der Korrekturmethode ist bei diesen Daten nicht entscheidungsrelevant — beide liefern 0/36.**

**Power- vs. Architektur-Problem — explizite Trennung:** Die Daten erlauben aktuell keine saubere Trennung von „zu wenig Daten" und „Architektur strukturell schwach". Beide Aussagen sind mit den vorliegenden Zahlen vereinbar und schließen sich nicht gegenseitig aus: (a) selbst ein real existierender, moderater Edge (~10–15pp) wäre bei den aktuellen Zellgrößen kaum nachweisbar (MDE-Argument oben) — spricht für „zu wenig Daten"; (b) die in H1 gezeigte Redundanz und die in H5 gezeigte Baseline-Parität sind unabhängig von der Stichprobengröße strukturelle Beobachtungen — sprechen für ein mögliches Architekturproblem. **Beide Erklärungen bleiben nach dieser Diagnostik offen.**

**Bewertung:** **H6 ist bestätigt: massive strukturelle Unterpowerung.** Dies ist die am robustesten belegte der sechs Hypothesen (rein arithmetisch aus n und Effektgrößenformeln ableitbar, keine Modellannahme nötig).

---

## 9. Cross-Hypothesis Findings

**Frage A — Ist das fehlende Edge-Signal primär ein Daten- / Statistical-Power- / Feature- / Redundanz- / Target- / Horizon- / Regime- / Aggregationsproblem?**

Primär ein **Statistical-Power-Problem** (H6, arithmetisch zwingend) — die aktuellen Stichprobengrößen liegen für die meisten Zellen unterhalb der MDE selbst des größten bisher beobachteten Effekts. Sekundär und nicht ausschließbar: ein **Redundanzproblem** (H1, strukturell belegt, unabhängig von n) — die Engine behandelt effektiv ~2.9 Informationsdimensionen als 6 (bzw. bei voller Coverage potenziell weniger als 14) unabhängige Stimmen. Feature-, Target-, Horizon- und Regime-Fragen (H2–H4) sind allesamt plausible Mitursachen, aber mit aktuellen Daten nicht von Rauschen trennbar.

**Frage B — Klassifikation jeder Kandidatenursache:**

| Kandidatenursache | Klassifikation |
|---|---|
| Unterpowerung (kleine n, insbesondere bei 168h/720h) | **FACT** (arithmetisch aus n und Standardfehlern ableitbar) |
| Faktor-Redundanz (effektive Dim. ≈2.9 von 6) | **STRONG INFERENCE** (PCA/Korrelation live berechnet, robust) |
| Target-Informationsverlust durch 3-Klassen-Diskretisierung | **HYPOTHESIS** (indirekte Evidenz über Streuungsasymmetrie, NEUTRAL-Fall nicht direkt testbar) |
| Horizon-Mismatch | **HYPOTHESIS** (Muster suggestiv, nicht signifikanzfähig bei aktuellem n) |
| Regimeabhängigkeit | **NOT TESTABLE** (alle Zellen underpowered) |
| Aggregationslogik (Summen-/Domain-Mittelwert-Ansatz) | **HYPOTHESIS** (folgt logisch aus H1, aber nicht isoliert getestet) |

**Frage C — Welche Hypothesen sind mit aktuellen Daten bereits testbar?** H1 (Redundanz) und H6 (Power) sind vollständig mit aktuellen Daten testbar und wurden getestet. H5 (Baseline-Vergleich) ist testbar und wurde getestet (Ergebnis: kein signifikanter Unterschied).

**Frage D — Welche benötigen zusätzliche Daten?** H3 (Horizon Alignment) und H4 (Regime Dependence) benötigen deutlich mehr Beobachtungen (insbesondere mehr abgeschlossene 168h/720h-Fenster und mehr Beobachtungen je Regime), um über den Status „suggestiv"/„underpowered" hinauszukommen. Die Regime-Analyse ist zusätzlich durch die kurze Gesamthistorie (nur ein bis zwei vollständige Marktregime-Zyklen beobachtbar) strukturell limitiert — mehr Kalenderzeit, nicht nur mehr Beobachtungsdichte, wird benötigt.

**Frage E — Welche benötigen eine zukünftige Modelländerung und sind daher noch nicht validierbar?** H2 (NEUTRAL vs. Unsicherheit) kann mit der aktuellen Zielvariablen-Architektur (3 diskrete Klassen ohne separate Unsicherheits-/Konfidenz-Dimension) nicht vollständig geklärt werden — jede vollständige Klärung würde eine Zielvariablenänderung erfordern, was außerhalb des Phase-2-Scopes liegt und hier nicht vorgeschlagen wird.

---

## 10. Evidence Classification

| Finding | Evidence Level | Data Support | Interpretation |
|---|---|---|---|
| Effektive Faktordimensionalität ≈2.9 von 6 | FACT | PCA, n=201, live berechnet | Redundanz strukturell vorhanden |
| Kein Faktorpaar-Korrelation >0.93, aber mehrere >0.8 (rsi↔vwap 0.921, macd↔vwap 0.829) | FACT | Korrelationsmatrix, n=201 | Starke paarweise Überlappung |
| `trend_regime` lieferte 0/199 BULLISH-Klassifikationen (24h-Fenster) | FACT | Direkte SQL-Abfrage, n=199 | Strukturelles, kein Zufallsmuster (bestätigt Phase 6) |
| MDE bei typischen Zellgrößen (16–24pp) übersteigt größten beobachteten Effekt (13.0pp) | FACT | Arithmetisch aus n | Zentrale Unterpowerungs-Evidenz |
| Bonferroni ≡ BH-Ergebnis (0/36) | FACT | Direkter Vergleich der kritischen Werte | Korrekturmethode nicht entscheidungsrelevant |
| Momentum-only vs. volle Engine (BEARISH, 24h) nicht signifikant unterschiedlich | FACT | z-Test, n=55 vs. n=73 | Kein Nachweis eines Baseline-Vorteils der Engine |
| BULLISH/BEARISH-Streuungsasymmetrie (1.82% vs. 3.17%) | FACT | Direkte Berechnung, n=128 | Hinweis auf Informationsverlust, keine NEUTRAL-Aussage möglich |
| Horizon-abhängiges Korrelationsmuster (schwach→stärker→instabil) | INFERENCE | Qualitatives Muster über 3 Horizonte, kleine n bei 168h/720h | Suggestiv, nicht signifikanzfähig |
| ADX-Regime-Hit-Rate-Differenz (70.6% vs. 42.1%) | HYPOTHESIS | n=17/38, weit unter MDE für diese Differenz | Nicht von Zufall unterscheidbar |
| NEUTRAL = Marktindifferenz vs. fehlende Evidenz | NOT TESTABLE | n=9 | Benötigt mehr Daten oder Zielvariablenänderung |
| Faktor-Redundanz „verursacht" fehlenden Edge | HYPOTHESIS (kausal nicht belegbar) | H1 korrelativ, kein kausaler Test durchgeführt | Plausibel, nicht bewiesen |

---

## 11. Root-Cause Ranking (rein evidenzbasiert)

1. **Statistical Power (H6)** — am robustesten belegt, arithmetisch zwingend, unabhängig von Modellannahmen.
2. **Factor Redundancy (H1)** — strukturell solide belegt (PCA, Korrelationsmatrix), unabhängig von n.
3. **Baseline Parity / kein Mehrwert der komplexen Aggregation nachweisbar (H5)** — direkt getestet, aber selbst durch Unterpowerung limitiert (kann echten kleinen Vorteil nicht ausschließen).
4. **Horizon Alignment (H3)** — suggestiv, plausibler Sekundärfaktor, nicht eigenständig signifikanzfähig.
5. **Target Information Loss (H2)** — teilweise belegt (Streuungsasymmetrie), Kernfrage (NEUTRAL) offen.
6. **Regime Dependence (H4)** — am schwächsten belegt, durchgehend underpowered, keine verlässliche Aussage möglich.

Diese Rangfolge beschreibt die **Stärke der vorliegenden Evidenz**, nicht eine Handlungsempfehlung oder eine Aussage über die tatsächliche relative Wichtigkeit der zugrundeliegenden Probleme in einem zukünftigen, besser mit Daten versorgten Zustand.

---

## 12. What We Know

- Es existiert kein aktuell nachweisbarer, BH-signifikanter Edge bei 24h oder 168h (Phase 1, bestätigt).
- 30D ist mit aktuellen Daten formal nicht testbar (Phase 1, bestätigt).
- Die 6 verfügbaren Faktoren sind strukturell redundant (effektive Dimensionalität ≈2.9), nicht 6 unabhängige Informationsquellen.
- `trend_regime` konnte im gesamten geprüften Fenster faktisch nur BEARISH/NEUTRAL liefern, nie BULLISH — eine reale, marktbedingte Eigenschaft dieses Zeitfensters, kein Bug.
- Kein geprüfter einfacher Baseline-Ansatz zeigt einen von der komplexen Engine statistisch unterscheidbaren Vor- oder Nachteil bei 24h.
- Die Stichprobengrößen der meisten Testzellen liegen unterhalb der Minimum Detectable Effect für den bisher größten beobachteten Effekt.
- Bonferroni- und BH-Korrektur führen zum identischen Ergebnis bei den vorliegenden Daten.

## 13. What We Do Not Know

- Ob ein echter, moderater Edge (~10–15pp) existiert, aber mit aktuellem Datenvolumen schlicht nicht nachweisbar ist (Power-Problem), oder ob kein relevanter Edge existiert (Architektur-/Signal-Problem) — beide sind mit aktuellen Daten nicht unterscheidbar.
- Ob NEUTRAL echte Marktindifferenz oder fehlende/widersprüchliche Evidenz kodiert (n=9, nicht auflösbar ohne mehr Daten oder Zielvariablenänderung).
- Ob die Regimeabhängigkeit der Faktor-Outcome-Beziehung real ist (alle Regime-Zellen underpowered).
- Ob die volle 14-Faktor-Coverage (sobald die 8 datenarmen Faktoren genug Historie haben) das Redundanzbild verändert — aktuell nur für 6 von 14 Faktoren überhaupt prüfbar.
- Ob die Horizon-Sensitivität der Faktor-Korrelationen ein reales Muster oder Rauschen bei kleinem n ist.

## 14. Required Future Research (keine Implementierungsempfehlung)

- Mehr Kalenderzeit/Beobachtungen für 168h/720h-Zellen, um über MDE-Schwellen zu kommen.
- Vollständige Coverage der 8 datenarmen Faktoren (funding, positioning, orderbook, options, macro, sentiment, oi_price, basis), um H1 (Redundanz) auf die volle 14-Faktor-Basis auszuweiten.
- Größere Regime-Stichproben (mehrere vollständige Marktzyklen) für eine belastbare H4-Aussage.
- Eine mögliche zukünftige Untersuchung, ob eine granularere oder kontinuierliche Zielvariable (statt 3-Klassen-Diskretisierung) die in H2 beobachtete Streuungsasymmetrie besser abbilden würde — hier nur benannt, nicht spezifiziert oder empfohlen.
- HAC-/Block-Bootstrap-Standardfehler (bereits in Phase 1 als zukünftiger Schritt dokumentiert, hier erneut referenziert, nicht implementiert).

## 15. Explicit Non-Changes

- Production (`compute-market-state` v8, `market_states`, Live-Cron): **unverändert**.
- Testset (08.07.–26.08.2026): **nicht abgefragt, nicht verwendet**.
- Alle bestehenden Modelle (`baseline_v1`, `domain_balanced_v1`, `calibrated_v1`, `redundancy_aware_v1`, `is_frozen=true`): **unverändert**.
- Alle Phase-1-Ergebnisse (`research_model_results_purged`, `research_leakage_integrity_log`, `PHASE-1-VALIDATION-INTEGRITY.md`): **unverändert**, nur referenziert/zitiert.
- Keine Schwellen-, Gewichts- oder Feature-Änderung wurde vorgenommen. Alle in diesem Dokument neu ausgeführten SQL-Abfragen waren rein lesend (`SELECT`/`corr()`) bzw. temporäre, nicht persistierte Diagnoseabfragen — keine neue Funktion, Tabelle oder Migration wurde für Phase 2 angelegt.

---

## 16. Final Decision Gate

| Gate | Hypothese | Status |
|---|---|---|
| A | H1 — Factor Redundancy | **YES** (PCA/Korrelation robust, effektive Dim. ≈2.9 von 6) |
| B | H2 — Target Information Loss | **PARTIAL** (Streuungsasymmetrie ja, NEUTRAL-Kernfrage NOT TESTABLE) |
| C | H3 — Horizon Alignment | **PARTIAL** (Muster suggestiv, nicht signifikanzfähig) |
| D | H4 — Regime Dependence | **NOT TESTABLE** (alle Zellen underpowered) |
| E | H5 — Baseline Dominance | **NO** (kein signifikanter Unterschied zu einfachen Baselines nachweisbar) |
| F | H6 — Statistical Power | **YES** (arithmetisch zwingend, robusteste Einzelhypothese) |

**RECOMMENDED NEXT RESEARCH STEP (genau einer, nicht implementiert):**
Systematische Erhöhung der effektiven Stichprobengröße für die 168h-Zelle (aktuell n=46–56 pre-purge, der einzige Horizont mit einem auffälligen, aber nicht signifikanten Effekt von +13.0pp) — durch fortlaufende Datensammlung bis die MDE-Schwelle (~10–12pp bei n≈150–200) unterschritten wird. Dies adressiert H6 (die am robustesten belegte Hypothese) direkt und ist Voraussetzung dafür, dass H1/H3 (Redundanz, Horizon) an genau dieser Zelle später überhaupt sauber geprüft werden können. Keine Architektur-, Schwellen- oder Feature-Entscheidung wird hierdurch vorweggenommen.

---

## Anmerkung zu Stop-Bedingungen

Innerhalb dieses Dokuments wurden folgende Teilfragen als **NOT TESTABLE IN PHASE 2** eingestuft, weil ihre Klärung nur über Threshold-Tuning, Zielvariablenänderung, Testset-Zugriff oder zusätzliche externe Daten möglich wäre: die NEUTRAL-vs-Unsicherheit-Frage in H2 (Abschnitt 4), die vollständige Regimeaussage in H4 (Abschnitt 6), und die Frage, ob volle 14-Faktor-Coverage das Redundanzbild verändert (Abschnitt 13). Diese wurden nicht umgangen, sondern explizit markiert und die Diagnostik mit den übrigen, testbaren Fragen fortgesetzt.
