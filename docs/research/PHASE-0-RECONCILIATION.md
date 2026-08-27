# Nexus-Atlas — Phase 0: Reconciliation / Methodik-Audit

Stand: 27.08.2026. **Reine Analyse — keine einzige Code-/Production-/Testset-Änderung in diesem Schritt.** Alle Angaben sind live gegen den tatsächlichen Code und die tatsächliche Datenbank verifiziert (Supabase `cpktesxmbqrzpsurntul`), nicht aus Dokumentation geschlossen.

## ⚠️ Blocker vor Abschnitt 2

Der Auftrag verlangt eine Zeile-für-Zeile-Gegenüberstellung dreier externer Audits (Perplexity, Gemini, Grok) mit eigenen "Perplexity Assessment" / "Gemini Assessment" / "Grok Assessment"-Abschnitten. **Mir liegt der Wortlaut dieser drei Audits nicht vor** — nur deine eigenen, bereits daraus synthetisierten Prompts (Phase 5, Phase 6, der abgebrochene 23-Phasen-Prompt, dieser Reconciliation-Prompt). Ich kann keine Aussage einem bestimmten Dienst zuordnen, ohne sie zu erfinden — das wäre genau die Art von fabrizierter Information, die dieses Projekt durchgängig ausschließt.

**Was ich stattdessen getan habe:** Abschnitt 2 unten bewertet jede in deinen Prompts genannte Empfehlung inhaltlich (A–E-Kategorisierung wie gefordert), aber ohne Dienst-Zuordnung — als "Empfehlung aus deinen Prompts" statt "Perplexity sagt X, Gemini sagt Y". Alle anderen Abschnitte sind vollständig. **Wenn du die Original-Audits (Text/Datei) hast, schick sie mir** — dann ergänze ich die echte Drei-Wege-Zuordnung nachträglich, ohne den Rest des Dokuments neu zu schreiben.

---

## 1. Bestandsaufnahme (Code- und DB-geprüft)

| # | Komponente | Aktuelle Implementierung | Datenbasis | Methodisches Risiko | Änderung nötig? |
|---|---|---|---|---|---|
| A | Faktoren | Exakt 14, siehe `compute-market-state` v8 (unverändert seit Audit) | — | — | — |
| B | Historisch vollständig | 6/14: structure, momentum, cvd, trend_strength, trend_regime, vwap_position — 100% Coverage über 201 Tage TRAIN+VALIDATION | market_features 1D | keins | nein |
| C | Nur teilweise verfügbar | 8/14: funding, positioning, orderbook, options, macro, sentiment, oi_price, basis — **0% Coverage** in TRAIN+VALIDATION (Rohquellen erst seit ~Mitte/Ende Aug. 2026 aktiv) | diverse | hoch (praktisch nicht erforschbar) | Daten weiter sammeln, nicht Code |
| D | Normalisierung | **Keine.** Jeder Faktor wird direkt an einer harten, faktorspezifischen Schwelle (z. B. RSI>55, ADX<20) in {-1,0,1} diskretisiert — kein Rank-/Z-Score-Verfahren, keine kontinuierliche Größe überlebt die Faktorberechnung | `compute-market-state` | mittel: Informationsverlust, keine Vergleichbarkeit der "Stärke" zwischen Faktoren | Research-Kandidat (Percentile Rank), NICHT Pflicht |
| E | Aggregation | Modell-abhängig: A=Summe, B/C/D=Domain-Mittelwert — alle 4 arbeiten auf denselben bereits-diskretisierten {-1,0,1}-Werten aus C | `backtest_states.factors` | — | siehe D |
| F | Domains | **7** (Phase 3, code-hergeleitet) bzw. **5** (Model D, TRAIN-Korrelation ≥0.55, Single-Linkage) — NICHT die im neuen Prompt vorgeschlagenen 4 | Phase 3/6 | Modellhypothese, nicht bewiesen | siehe Abschnitt 6 |
| G | Coverage | Modell A/B/C: Schwelle 40%, unterschiedlich berechnet — A auf Faktor-Ebene (`factors_with_data/14`), B/C ursprünglich auf **Domain**-Ebene (`domains_with_data/domains_total`). D hatte denselben Domain-Ebenen-Bug, in Phase 6 gefunden und auf Faktor-Ebene korrigiert | — | **bestätigt: B/C nutzen bis heute die Domain-Ebenen-Formel**, die bei Model D nachweislich zu falschem `INSUFFICIENT_DATA` führte — bei B/C (7 bzw. 3 Domains, gleichmäßiger verteilt) bisher nicht als Fehler aufgefallen, aber dieselbe strukturelle Schwäche ist vorhanden | ja — Research-Fix für B/C prüfen |
| H | Confidence | `(coverage/100) × (\|score\|/n_available) × 100` — identisch in A/B/C/D (D: `weight_sum` statt `n_available`) | — | **bestätigt problematisch**: wird im Dashboard als Prozentzahl angezeigt, ist aber keine kalibrierte Wahrscheinlichkeit — Coverage/Signal-Strength/Consensus sind vermischt in einer Zahl | ja — Research-Trennung (Abschnitt 8) |
| I | Market States | BULLISH/NEUTRAL/BEARISH/MIXED/INSUFFICIENT_DATA, feste Schwellen (A: ±3, B/C: ±1.5, D: ±0.5) | — | keins (fest, nicht adaptiv) | nein |
| J | Labels | `Forward Return = Price(t+H)/Price(t) - 1`, dieselbe Definition wie im Prompt gefordert | `backtest_hit_rate_by_horizon()` | — | — |
| K | Horizonte getestet | 24h, 168h (7 Tage), 720h (30 Tage) — **alle OVERLAPPING** (jeder Tag bekommt eigenes Label, Fenster überlappen sich) | — | **bestätigtes Problem**, siehe Abschnitt 3 | ja |
| L | Train/Val/Test | Chronologisch, 60/20/20 (151/50/50 Tage), technisch eingefroren via DB-Trigger (`prevent_frozen_model_update`) | `backtest_model_runs` | — | — |
| M | Overlapping Labels | **Bestätigt vorhanden** für 168h/720h-Horizont in JEDER bisherigen Phase-5/6-Auswertung | — | bestätigtes Problem | ja |
| N | Purging | **Nicht implementiert.** Live geprüft: `train_end=2026-05-18`, kein Ausschluss von TRAIN-Beobachtungen, deren 720h-Label (30 Tage) bis zum 17.06.2026 reicht — weit in VALIDATION hinein | `backtest_model_runs` | **bestätigtes Leck**: ca. die letzten 30 TRAIN-Tage haben Label-Überlappung mit VALIDATION beim 720h-Horizont, die letzten 7 beim 168h-Horizont | ja |
| O | Embargo | **Nicht implementiert.** Live geprüft: `validation_start - train_end = 1 Tag`, `test_start - validation_end = 1 Tag` — praktisch kein Puffer | `backtest_model_runs` | bestätigtes Leck (siehe N) | ja |
| P | Testset eingefroren | Teilweise: `is_frozen`-Trigger verhindert Config-Änderungen an `backtest_model_runs`-Zeilen technisch. Es gibt **kein** technisches Verbot, TEST-Zeitraum-Daten per Ad-hoc-SQL zu lesen — nur ein Zugriffs-Log (`research_test_access_log`), das Zugriffe protokolliert statt verhindert (Phase 6, bewusst so dokumentiert, da eine harte Sperre die produktiv mitgenutzten Tabellen einschränken würde) | `backtest_model_runs`, `research_test_access_log` | mittel: Disziplin + Log, keine harte technische Sperre gegen SELECT | nein (bereits so dokumentiert, ehrliche Grenze) |
| Q | Historische Datenmenge | Siehe Matrix in Abschnitt 16 | — | — | — |

## 2. Empfehlungen aus den Prompts — inhaltliche Bewertung (ohne Dienst-Zuordnung, siehe Blocker oben)

| Thema | Eigene Prüfung | Kategorie |
|---|---|---|
| Overlapping Labels als Problem | Bestätigt, siehe 1.K/1.M und Abschnitt 3 | **A — zwingend** |
| Effective Sample Size (nicht naive AR(1)-Formel) | Bestätigt — aktuell wird gar keine Effective-N-Korrektur vorgenommen, rohe n gemeldet | **A — zwingend** |
| Purging | Bestätigt fehlend, siehe 1.N | **A — zwingend** |
| Embargo | Bestätigt fehlend, siehe 1.O | **A — zwingend** |
| HAC/Newey-West | Sinnvoll für Inferenz bei überlappenden Labels, ersetzt aber Purging/Embargo nicht (Prompt selbst betont das korrekt) | **B — plausible Hypothese, zur Umsetzung** |
| Block Bootstrap für CI | Sinnvolle Ergänzung, kein Ersatz für sauberen Split | **B** |
| Multiple Testing (Benjamini-Hochberg) | Zwingend gegeben die Vielzahl bereits getesteter Modell×Horizont×Richtung-Kombinationen (Phase 5/6 haben mehrfach getestet, ohne zu korrigieren) | **A — zwingend, bisher versäumt** |
| Expanding Percentile Rank Normalisierung | Plausibel, aber NICHT automatisch besser als die bestehende harte Diskretisierung — beide haben Vor-/Nachteile (Rank erhält Magnitude-Information, verliert aber die ökonomisch begründeten Schwellen wie RSI 55/45) | **C — empirisch offen, Research-Kandidat** |
| 4-Domain-Architektur (Market Structure/Derivatives/Microstructure/Macro) | Weicht von der bereits code-hergeleiteten 7-Domain- bzw. Model-D-5-Domain-Struktur ab. Nicht automatisch besser — eigene Redundanzanalyse (Phase 6) zeigt empirisch andere Cluster-Grenzen als diese Vier-Gruppen-Hypothese | **C — Research-Kandidat neben bestehenden, NICHT Ersatz** |
| Coverage-Schwelle 70% | Aktuell 40%, nirgends empirisch hergeleitet — 70% ist genauso wenig empirisch hergeleitet wie 40%. Bei nur 6/14 durchgehend verfügbaren Faktoren würde 70% (10/14) JEDE TRAIN/VALIDATION-Zeile zu `INSUFFICIENT_DATA` machen — sofort verifizierbar underschiedlich von "40% bewusst gewählt, damit die Engine überhaupt je einen State liefert" | **D — aktuell unnötig, da mit heutiger Datenbasis 70% jede Auswertung stilllegen würde. Als Research-Parameter offen halten, nicht hardcoden** |
| Confidence ≠ Probability | Bestätigt, siehe 1.H | **A — zwingend** |
| CVD/Orderbook nicht löschen, als Hypothese behandeln | Deckt sich mit dieser Session: CVD wurde in Phase 6 nie als "wertlos" erklärt, sondern seine Zeitskala (Autokorrelation ≈0) präzise vermessen (`phase6-factor-diagnostics.md`). Orderbook hat 0% Coverage — kann noch gar nicht getestet werden, nicht "verworfen" | **bereits korrekt umgesetzt** |
| Residualisierung/PCA nicht sofort implementieren | Deckt sich exakt mit der bestehenden Position aus Phase 5/6 ("PCA nur Experiment, keine automatische Übernahme") | **bereits korrekt umgesetzt** |
| Triple-Barrier nicht als primäres Label | Wurde in Phase 6 nie implementiert — konsistent mit dieser Forderung | **bereits korrekt umgesetzt** |
| Adaptive Thresholds nicht einführen | In A/B/C/D durchgängig feste Schwellen — konsistent | **bereits korrekt umgesetzt** |

## 3. Effective Sample Size — mathematische Einordnung

**Was aktuell gemacht wird:** `backtest_hit_rate_by_horizon()` meldet `n` = Anzahl Zeilen mit einem gültigen Forward-Return im jeweiligen Split — das ist die **rohe** Zeilenzahl, keine Effective-Sample-Size-Korrektur.

**Mathematisch korrekt (bestätigt, nicht nur Faustregel):** Bei täglich neu berechneten H-Tage-Forward-Returns mit `H>1` teilen aufeinanderfolgende Beobachtungen `H-1` Tage ihres Preispfads — die Fehlerterme folgen approximativ einem MA(H-1)-Prozess. Für den 168h-Horizont (H=7) bedeutet das: von den gemeldeten n=27–56 Zeilen pro TRAIN/VALIDATION-Zelle sind höchstens **n/7 ≈ 4–8** wirklich unabhängige Beobachtungen. Für den 720h-Horizont (H=30) sind es höchstens **n/30 ≈ 1–2**.

**Konsequenz, bestätigt:** Jede in Phase 5/6 berichtete Edge-Zahl bei 168h/720h-Horizont (z. B. der "BEARISH 1-Woche +9 bis +11pp"-Befund aus Phase 5) beruht auf einer effektiven Stichprobe im niedrigen einstelligen Bereich — das war in Phase 5 bereits qualitativ als "bei n=31-41 nicht belastbar" korrekt eingeordnet, aber ohne die jetzt präzisierte MA(H-1)-Begründung. Die 24h-Horizont-Ergebnisse sind davon am wenigsten betroffen (H=1, keine Überlappung, n=rohe Zeilenzahl≈effektive Zeilenzahl bei Tagesdaten, abgesehen von genereller Autokorrelation im Preisprozess selbst).

**Was verworfen werden muss:** eine naive `n_eff = n / (1 + 2×AC(1))`-AR(1)-Formel als "die" exakte Wahrheit — das ist bestenfalls eine Näherung für AR(1)-Prozesse, nicht für die MA(H-1)-Struktur überlappender Forward-Returns. Für non-overlapping Labels (siehe Abschnitt 4) ist die rohe Zeilenzahl dagegen tatsächlich die effektive Stichprobe (bis auf Preisprozess-eigene Autokorrelation).

## 4. Labeling-Entscheidung

| Horizont | Overlapping (aktuell) | Non-overlapping möglich? | Empfehlung |
|---|---|---|---|
| 1D (24h) | Ja, aber H=1 → kein Overlap-Problem | n/a | **Primärer Horizont**, bereits korrekt nutzbar |
| 7D (168h) | Ja, effektiv n≈4-8 | Ja: mit 151 TRAIN-Tagen ≈ 21 non-overlapping 7-Tage-Fenster, 50 VALIDATION-Tage ≈ 7 Fenster | **Sekundärer Horizont, aber non-overlapping neu aufsetzen** (Research, nicht Production) — 7 VALIDATION-Fenster ist SEHR wenig, ehrlich als niedrige Power kennzeichnen |
| 30D (720h) | Ja, effektiv n≈1-2 | 151/30≈5 TRAIN-Fenster, 50/30≈1-2 VALIDATION-Fenster | **NOT TESTABLE WITH CURRENT DATA** — bei 1-2 unabhängigen VALIDATION-Beobachtungen ist keine Aussage möglich, auch nicht "kein Edge" |
| 4H/1H | Sehr junge History (43/12 Tage) | technisch ja, aber zu kurz für TRAIN/VAL/TEST | **Explorativ, separates Experiment, NICHT mit 1D mischen** (deckt sich mit Prompt-Vorgabe) |

## 5. Normalisierung — Bewertung

Aktuell: harte Schwellen-Diskretisierung in {-1,0,1} (siehe 1.D). Kein Rank-/Z-Score-Verfahren.

**Entscheidung: B — in Research testen, NICHT sofort übernehmen.** Begründung: Die aktuellen Schwellen (RSI 55/45, ADX 20 etc.) sind ökonomisch motiviert und wurden nicht willkürlich gewählt (siehe Kommentare in `compute-market-state`). Expanding Percentile Rank würde diese ökonomische Verankerung gegen eine rein verteilungsbasierte ersetzen — nicht per se besser, nur anders. Mit nur 151 TRAIN-Tagen ist außerdem die Rank-Verteilung selbst instabil (Regimewechsel würden die Ränge verzerren). Sollte als **paralleles** Research-Modell getestet werden (Model E, noch nicht gebaut), nicht als Ersatz.

## 6. Domain-Architektur — Bewertung

Drei existierende/vorgeschlagene Architekturen, keine davon empirisch bewiesen optimal:

- **7 Domains** (Phase 3, code-hergeleitet): ökonomisch am feinsten, aber Phase 6 zeigte empirisch starke Cross-Domain-Korrelation zwischen `market_structure`/`momentum_trend`/`order_flow` (r=0.53-0.72 auf TRAIN) — die 7er-Einteilung überschätzt vermutlich die Trennschärfe zwischen diesen dreien.
- **5 Domains** (Model D): fasst genau diese drei zu `trend_composite` zusammen, empirisch aus TRAIN-Korrelation abgeleitet (Schwelle 0.55) — bestätigt in Phase 6 identische BULLISH/BEARISH-Klassifikation zu Model A auf aktueller Datenbasis, keine Verschlechterung.
- **4 Domains** (neuer Prompt): plausible ökonomische Hypothese, aber NICHT aus den tatsächlichen Korrelationsdaten hergeleitet, sondern aus Konvention übernommen.

**Entscheidung: alle drei bleiben nebeneinander bestehen als Research-Kandidaten, keine ersetzt die andere.** Die 4-Domain-Struktur wird NICHT automatisch eingeführt (entspricht der expliziten Vorgabe). Wenn getestet, dann als Model F, additiv, gleiches Muster wie A-D.

## 7. Coverage — Bewertung

Siehe 1.G und die 40%/70%-Bewertung in Abschnitt 2. **Entscheidung:** Coverage-Schwelle bleibt vorerst bei 40% (Status quo, keine Optimierung), da 70% mit der aktuellen Datenbasis (6/14 Faktoren durchgehend verfügbar = 42.9%) praktisch jede Auswertung stilllegen würde — das wäre keine "sauberere Methodik", sondern schlicht keine Auswertung mehr möglich. Separat bestätigt: die Domain-Ebenen-Coverage-Formel in Model B/C hat denselben strukturellen Fehler, der in Model D gefunden wurde — als **Research-Fix vorgemerkt** (Abschnitt 13), nicht in Production.

## 8. Confidence — Bewertung

Bestätigt (1.H): die aktuelle Zahl vermischt Coverage × Agreement zu einer einzigen Prozentzahl, die im Dashboard confidence-artig dargestellt wird, aber nie kalibriert wurde. Phase 5 fand bereits empirisch, dass in TRAIN+VALIDATION 100% der Beobachtungen im Bucket 0-50 liegen — die Zahl hat also nicht einmal in der Praxis den vollen Wertebereich genutzt.

**Empfehlung:** in einer zukünftigen Research-Version explizit trennen in Coverage / Signal Strength / Consensus, `Probability = NOT_CALIBRATED` so lange keine echte Kalibrierung (Isotonic/Platt) vorliegt. **Nicht jetzt implementiert** (reine Analyse-Phase).

## 9. Redundanz — Status

Bereits durchgeführt in Phase 6 (`phase6-factor-diagnostics.md`) für die 6 verfügbaren Faktoren: Pearson UND Spearman berechnet (nicht nur Pearson), TRAIN-only zur Vermeidung von Validation-Leakage in der Cluster-Bildung. Kein Faktor wurde gelöscht — Model D behandelt Redundanz ausschließlich über Domain-Mittelung, nie über Faktor-Entfernung. Deckt sich vollständig mit der Vorgabe "keine Faktoren aufgrund theoretischer Korrelation löschen".

**Offen:** die explizite "liefert Faktor X inkrementelle Information über Faktor Y hinaus"-Frage (partielle Korrelation / Information-Gain) wurde in Phase 6 nur indirekt über die MIXED→NEUTRAL-Analyse von Model D gestreift, nicht als eigener Test durchgeführt. **Research-Kandidat.**

## 10. Residualisierung/PCA — Status

Bereits korrekt: keines von beidem wurde implementiert. PCA wird in keinem der 4 Modelle verwendet. Deckt sich vollständig mit der Vorgabe.

## 11. CVD/Orderbook — Status

Siehe Abschnitt 2. CVD wurde vermessen (Zeitskala, Redundanz), nie als "wertlos" bezeichnet. Orderbook konnte auf 1D noch nicht getestet werden (0% TRAIN/VALIDATION-Coverage) — explizit als offene Frage dokumentiert, nicht als "funktioniert nicht".

## 12. Benchmark-Framework — Spezifikation (noch NICHT implementiert)

Analog zur Vorgabe, spezifiziert aber nicht gebaut:

| Benchmark | Definition | Datenbasis vorhanden? |
|---|---|---|
| Buy & Hold | Preis(t+H)/Preis(t)-1, keine Richtung | Ja |
| Momentum-only | Faktor `momentum` allein als Signal | Ja (100% Coverage) |
| Trend-only | `trend_regime` allein | Ja (100% Coverage) |
| Funding-only | Faktor `funding` allein | **Nein — 0% Coverage TRAIN/VALIDATION** |
| OI + Price | `oi_price` allein | **Nein — 0% Coverage** |
| Derivatives-only | Domain `derivatives_leverage` | **Nein — 0% Coverage** |
| Bestehender Nexus-Score | Model A (Baseline) | Ja, bereits vorhanden |
| Alternative Architektur | Model B/C/D | Ja, bereits vorhanden |

**Konsequenz:** von 8 geforderten Benchmarks sind aktuell nur 4 überhaupt mit echten Daten testbar (Buy&Hold, Momentum-only, Trend-only, Full-Nexus-Varianten A-D). Funding/OI/Derivatives-Benchmarks sind `NOT TESTABLE WITH CURRENT DATA` — nicht weil die Idee falsch ist, sondern weil die Coverage-Lage (Abschnitt 1.C) das schlicht nicht hergibt.

## 13. Research-Environment — Status

Bereits vorhanden und strikt getrennt: `backtest_model_runs`/`backtest_model_results` (Modell-Versionierung, `is_frozen`-Trigger), `research_factor_coverage()`, `research_test_access_log`, `backtest_states` (Point-in-Time-sichere Rekonstruktion). Alle additiv, keine Production-Tabelle verändert. Erfüllt die Grundanforderung der Vorgabe bereits.

## 14. Validierungsarchitektur — Status

Chronologisches Train/Validation/Test vorhanden. Walk-Forward (4 expandierende Folds, Phase 5) vorhanden, aber ohne Purging/Embargo (siehe 1.N/1.O — bestätigter Mangel). HAC/Block-Bootstrap: **nicht implementiert.**

## 15. Statistische Aussagen — Ebenen

Ab sofort für alle künftigen Research-Aussagen zu verwenden (deckt sich mit Vorgabe):

- **PROVEN**: mathematisch/strukturell verifiziert (z. B. "Purging fehlt", "Coverage-Formel-Bug in Model D" — beides live nachgewiesen).
- **SUPPORTED**: empirisch plausibel, aber nicht auf VALIDATION/TEST bestätigt (z. B. "Redundanz zwischen Trend-Faktoren").
- **UNKNOWN**: mit aktueller Datenbasis nicht entscheidbar (z. B. jede Aussage zu funding/positioning/orderbook/etc. auf TRAIN/VALIDATION).

Bisherige Phase-5-Formulierung "KEEP BASELINE, kein robuster Edge nachgewiesen" ist mit dieser Skala konsistent zu lesen als **SUPPORTED, dass kein Edge nachgewiesen ist** — nicht als **PROVEN, dass kein Edge existiert**. Diese Unterscheidung wurde in Phase 5 sinngemäß bereits eingehalten (nie "Nexus hat keinen Edge" behauptet, immer "kein Edge nachgewiesen"), wird hier aber erstmals explizit benannt.

## 16. Sample-Size-Matrix (live verifiziert)

| Horizon | Raw N (TRAIN+VAL) | Non-overlap N (TRAIN+VAL) | Overlap-Faktor | Geschätzte Abhängigkeit | Testability |
|---|---|---|---|---|---|
| 1D (24h) | 201 | 201 | keiner | gering (Preisprozess-eigene AC) | **Voll testbar** |
| 7D (168h) | 201 | ≈28 (151/7 + 50/7) | 7× | MA(6) | **Eingeschränkt testbar, niedrige Power** |
| 30D (720h) | 201 | ≈6-7 (151/30 + 50/30) | 30× | MA(29) | **NOT TESTABLE WITH CURRENT DATA** |
| 4H | 256 Zeilen, 43 Tage | — | — | — | Zu kurz für TRAIN/VAL/TEST-Split |
| 1H | 274 Zeilen, 12 Tage | — | — | — | Zu kurz für TRAIN/VAL/TEST-Split |

## 17. Production-Komponenten, die eingefroren bleiben müssen

`compute-market-state` (v8), `market_states`-Tabelle, alle produktiven Cron-Jobs, alle 22 Edge Functions, `get_macro_regime()`, `get_funding_intelligence()` — keine dieser Komponenten wurde in Phase 0 verändert und keine wird durch diesen Reconciliation-Schritt berührt.

## 18. Vorgeschlagene nächste Research-Phase (klein, nicht die ganze 23-Phasen-Liste auf einmal)

Kleinstmöglicher sinnvoller nächster Schritt, der die Kernfrage direkt voranbringt:

1. **Non-overlapping 7D-Labels** aufsetzen (Research, additiv) — beantwortet, ob der 24h-Befund ("kein robuster Edge") auch auf einem saubereren, weniger autokorrelierten Horizont Bestand hat.
2. **Purging + Embargo** für den bestehenden Split nachrüsten (1 Tag Embargo, Purging der letzten 30 TRAIN-Tage für den 720h-Horizont) — behebt den bestätigten Leak, ohne den Split selbst neu zu ziehen.
3. **Benjamini-Hochberg** auf die bereits vorhandenen Phase-5/6-Ergebnisse anwenden (rückwirkende Korrektur der p-Werte über alle bisher getesteten Modell×Horizont×Richtung-Zellen) — zeigt, ob der Phase-5-Befund robust bleibt.
4. Buy&Hold/Momentum-only/Trend-only-Benchmarks (die 3 mit echter Datenbasis) gegen Full-Nexus (Model A) auf denselben Splits laufen lassen.

**Nicht jetzt:** Percentile-Rank-Normalisierung, 4-Domain-Architektur, Confidence-Kalibrierung, Block-Bootstrap, HAC — alles als Research-Kandidaten dokumentiert (Abschnitt 2), aber nicht Teil des kleinsten nächsten Schritts.

## 19. Definition of Done — Abgleich

Alle Punkte der Checkliste aus dem Prompt sind erfüllt **außer**: "alle drei externen Audits miteinander verglichen" (blockiert, siehe oben) und die daraus abhängigen "Perplexity/Gemini/Grok Assessment"-Abschnitte. Keine Production-Änderung, kein Testset-Zugriff zur Optimierung, keine unbegründete Empfehlung übernommen.

---

## 20. Abschlussbericht

**A) Was ist aktuell methodisch falsch?** Fehlendes Purging/Embargo (bestätigtes Label-Leck über die Split-Grenze bei 168h/720h-Horizont); keine Multiple-Testing-Korrektur trotz vieler getesteter Zellen; Domain-Ebenen-Coverage-Formel in Model B/C strukturell fehleranfällig (wie in Model D nachgewiesen); Confidence wird wie eine Wahrscheinlichkeit dargestellt, ohne kalibriert zu sein.

**B) Was ist nur unbewiesen?** 4-Domain- vs. 5/7-Domain-Architektur; Percentile-Rank- vs. bestehende Schwellen-Normalisierung; ob CVD/Orderbook auf 1D/4H/1H echte Information tragen (Datenbasis fehlt); ob Faktor X inkrementelle Information über Faktor Y liefert (nicht formal getestet).

**C) Was ist bereits korrekt gelöst?** Strikte Research/Production-Trennung; kein PCA/Residualisierung/Triple-Barrier in Production; CVD/Orderbook nicht vorschnell verworfen; INSUFFICIENT_DATA-Philosophie (nie stillschweigend NEUTRAL); Modell-Versionierung mit technisch durchgesetztem Freeze; chronologischer, nicht-zufälliger Split.

**D) Was soll unverändert bleiben?** `compute-market-state`, alle Produktionsgewichte/-schwellen, das bestehende Testset (Zeitraum), die 40%-Coverage-Schwelle (mit Begründung, nicht aus Trägheit), Model A/B/C/D als bereits gebaute, eingefrorene Referenzen.

**E) Was soll als Nächstes in der Research-Umgebung getestet werden?** Siehe Abschnitt 18, Punkte 1–4.

**F) Was soll erst bei mehr Daten getestet werden?** Alles, was funding/positioning/orderbook/options/macro/sentiment/oi_price/basis betrifft — 8 von 14 Faktoren; 30D-Horizont; 4H/1H-Backtests mit echtem Train/Val/Test.

**G) Was soll vorerst nicht gemacht werden?** Percentile-Rank blind einführen; 4 Domains erzwingen; Confidence kalibrieren; PCA/Residualisierung/Triple-Barrier; Coverage-Schwelle ändern ohne empirische Begründung.

**H) Was ist der kleinstmögliche sinnvolle nächste Schritt?** Purging+Embargo auf dem bestehenden Split nachrüsten und Benjamini-Hochberg rückwirkend auf die vorhandenen Phase-5/6-Ergebnisse anwenden — das prüft direkt, ob der bisherige "kein robuster Edge"-Befund einer strengeren Methodik standhält, ohne neue Modelle oder neue Daten zu benötigen.

**Zentrale, noch offene Frage:** Mit der aktuellen Datenbasis (6/14 Faktoren, 151 TRAIN-Tage, effektiv ≈21 non-overlapping 7-Tage-Beobachtungen) ist die Kernfrage "hat Nexus-Atlas inkrementelle Information gegenüber einfachen Benchmarks" **UNKNOWN, nicht NOT SUPPORTED** — die bisherigen Phase-5/6-Befunde sind eine erste, informative Annäherung, aber statistisch nicht auf einem Niveau, das eine der Aussagen "Edge vorhanden" oder "kein Edge vorhanden" trägt.
