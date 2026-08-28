# Phase 3.1 — Research Protocol Integrity Check

**STATUS: RESEARCH ONLY — reines Audit.** Prüft ausschließlich, ob das in Phase 3 eingefrorene Research-Protokoll (`PHASE-3-RESEARCH-PROTOCOL.md`, Commit `57e6b49`) statistisch und logisch intern konsistent ist. **Keine Behebung von Inkonsistenzen in diesem Dokument** — nur Dokumentation und konkrete Änderungsvorschläge. Phase 3 selbst wird **nicht verändert**. Keine Production-/Testset-/Modell-/Threshold-/Gewichts-Änderung, keine Nutzung zukünftiger Daten, keine Änderung des bestehenden Daten-Sammelprozesses.

**Ergebnis vorab (Details unten):** Das Audit findet **zwei voneinander unabhängige, mathematisch nachweisbare Konflationsfehler** in Phase 3s Power-/MDE-/Zeitplan-Angaben (Abschnitte 4.5, 5, 6, 7 des Phase-3-Dokuments). Beide sind quantifiziert und in Abschnitt 6/7 dieses Dokuments exakt belegt.

---

## 1. Kontext

Wie im Auftrag vorgegeben, unverändert aus Phase 0–3 übernommen, nicht neu bewertet:

- Phase 1: 0/36 BH-signifikant, bester roher p-Wert 0,025, BEARISH/168h/TRAIN +13,0pp (p=0,078), 24/24 leakage=false, 30D nicht testbar, Non-Overlap-7D extrem klein.
- Phase 2: H1 supported, H2 partial, H3 suggestive, H4 underpowered, H5 kein Engine-Vorteil, H6 confirmed als zentraler limitierender Faktor.
- Phase 3: primärer Horizont 168h, primäres Research-Fenster ab 28.08.2026, TRAIN/VALIDATION gelten als bereits gesehen und dürfen nicht als künftige Confirmatory-Evidenz verwendet werden.

---

## 2. Zentrale Prüffrage

«Ist das Phase-3-Protokoll bezüglich Stichprobengröße, Überlappung, statistischer Unabhängigkeit, Power-Berechnung und geplantem Zeitpunkt der Confirmatory-Auswertung intern konsistent?»

Kernunterscheidung: **RAW N** vs. **EFFECTIVE N** vs. **NON-OVERLAPPING N** — im Folgenden geprüft, ob Phase 3 diese drei Größen sauber trennt.

---

## 3. 168h-Label-Overlap — technische Prüfung

`backtest_states` (1D) wird über den bestehenden `pg_cron`-Job `backtest-reconstruct-1d-states-v2` (täglich 06:20 UTC) fortgeschrieben — **bestätigt, unverändert, keine Aktion nötig.** Der Job schreibt pro Kalendertag genau eine Zeile mit den 14 Faktorwerten und dem Domain-State; er speichert **keinen** Forward-Return — dieser wird erst zur Auswertungszeit durch einen Join gegen `market_features` zum Zeitpunkt `candle_open_time + 168h` berechnet (identische Methodik wie Phase 1/2/3).

**Konkretes Beispiel (Overlap-Nachweis):**

| Observation | Beobachtungstag T | Forward-Fenster | Geteilte Tage mit T=Tag 0 |
|---|---|---|---|
| T | Tag 0 | Tag 0 → Tag 7 | — |
| T+1 | Tag 1 | Tag 1 → Tag 8 | Tage 1–7 (6 von 7 Tagen) |
| T+2 | Tag 2 | Tag 2 → Tag 9 | Tage 2–7 (5 von 7 Tagen) |
| T+3 | Tag 3 | Tag 3 → Tag 10 | Tage 3–7 (4 von 7 Tagen) |
| ... | ... | ... | ... |
| T+7 | Tag 7 | Tag 7 → Tag 14 | 0 Tage (erste vollständig unabhängige Beobachtung) |

**Befund:** Jede der 6 auf T folgenden täglichen Beobachtungen (T+1…T+6) teilt einen Teil ihres Preis-Return-Pfads mit T. Erst T+7 ist vollständig überlappungsfrei zu T. Für den geplanten Confirmatory-Test dürfen tägliche 168h-Labels **nicht** als unabhängige Stichprobe behandelt werden — dies bestätigt exakt Abschnitt 13 des eingefrorenen Phase-3-Protokolls, das dieselbe Struktur bereits qualitativ beschreibt, ohne sie in die Power-/MDE-Berechnung selbst einfließen zu lassen (siehe Abschnitt 6).

---

## 4. Definition der drei N

| Größe | Definition | Wachstumsrate |
|---|---|---|
| **RAW N** | Anzahl aller verfügbaren, purged+embargoed 168h-Beobachtungen (alle States, tägliche Kadenz) | +1/Kalendertag (nach initialem 8-Tage-Versatz) |
| **NON-OVERLAPPING N** | Anzahl tatsächlich nicht überlappender 168h-Fenster (nur jede 7. Beobachtung) | +1/7 Kalendertage |
| **EFFECTIVE N** | Statistisch effektive Stichprobengröße unter Berücksichtigung serieller Abhängigkeit (Herleitung: Abschnitt 6) | ≈ +1/7 Kalendertage (siehe unten) |

### 4.1 Mathematische Herleitung von EFFECTIVE N (neu in Phase 3.1, in Phase 3 nur behauptet, nicht hergeleitet)

Unter der vereinfachenden, in der Overlapping-Returns-Literatur (Hansen-Hodrick-artige Konstruktion) üblichen Annahme näherungsweise unabhängiger Tagesrenditen `r_t`: Der 168h-Forward-Return `R_t = Σ_{i=1}^{7} r_{t+i}` ist eine gleitende Summe über 7 Tagesrenditen. Für zwei Beobachtungen im Abstand `k<7` Tagen gilt:

```
Cov(R_t, R_{t+k}) = (7−k) · Var(r)      für k < 7
Corr(R_t, R_{t+k}) = (7−k)/7            für k = 1..6, sonst 0
```

Die Varianz des Mittelwerts einer stationären Reihe mit dieser Autokorrelationsstruktur:

```
Var(mean) = (σ²/n) · τ,   τ = 1 + 2·Σ_{k=1}^{6} (7−k)/7 = 1 + 2·(6/2) = 7
```

**Ergebnis: der Inflationsfaktor τ ist exakt 7 (= H, der Horizont in Tagen).** Das bestätigt mathematisch die bereits in Phase 0/1/3 verwendete Heuristik `EFFECTIVE N ≈ RAW N / 7` — dies ist **A, intern konsistent**, keine Korrektur nötig. Einschränkung: die Herleitung setzt näherungsweise unabhängige Tagesrenditen voraus; reale Autokorrelation der zugrundeliegenden Preisreihe (Volatility Clustering etc.) würde τ modifizieren, nicht aber die Größenordnung (≈7) verändern.

### 4.2 Vermischt Phase 3 diese drei Größen? — JA, an zwei Stellen

1. **Abschnitt 4.5 und 5 des Phase-3-Dokuments** berechnen Power/MDE für „n=100/150/200/300" mit dem Standard-Ein-Stichproben-z-Test (der iid-Beobachtungen voraussetzt) — verwenden also faktisch **RAW N als wäre es EFFECTIVE N**. Abschnitt 13 desselben Dokuments benennt die Abhängigkeit zwar korrekt, aber diese Erkenntnis fließt an keiner Stelle in die Power-Zahlen selbst ein. **Exakte Fundstelle:** Tabelle „Power-Tabelle" (Abschnitt 5.2) und Tabelle „Erwartete Kennzahlen je Szenario" (Abschnitt 4.5) — beide nutzen ausschließlich RAW N als Testgröße.
2. **Abschnitt 4.4/4.5 des Phase-3-Dokuments** definieren die Szenarien A–D als RAW N **über alle States** (BULLISH+BEARISH+MIXED+NEUTRAL), während der in Abschnitt 14 festgelegte Primärtest ausschließlich auf der **BEARISH-klassifizierten Teilmenge** operiert (siehe Abschnitt 8 unten). Die Power-/MDE-Zahlen in Abschnitt 5 verwenden aber „n=100/150/200/300" direkt, ohne die State-Konditionierung abzuziehen.

**Mathematische Erklärung und Korrekturvorschlag:** siehe Abschnitt 6/7.

---

## 5. Power-Analyse auditiert

**Verwendetes Modell (Phase 3, Abschnitt 5):** Ein-Stichproben-Anteils-z-Test, H0: `p = p0` (p0 = empirische Always-Bearish-Baseline 53,5%), H1: `p ≠ p0` (zweiseitig), α=0,05. Konsistent mit Phase 1s `research_bh_fdr()`-Methodik — **das Testmodell selbst ist korrekt benannt und nachvollziehbar reproduziert** (eigene Nachrechnung in Phase 3.1 bestätigt exakt dieselben Werte wie in Phase 3 berichtet, z. B. n=192 für +10pp bei 80% Power — **A, intern konsistent**).

**Kritischer Punkt:** Der z-Test setzt **unabhängige, identisch verteilte Beobachtungen** voraus. Diese Annahme ist für tägliche, überlappende 168h-Labels **nachweislich verletzt** (Abschnitt 3/4.1). Die in Phase 3 Abschnitt 5.1/5.2 berichteten n-Werte und Power-Prozentsätze sind daher **nur gültig, wenn n als EFFECTIVE N (oder als Ergebnis einer nicht-überlappenden Stichprobenziehung) interpretiert wird — nicht als RAW N**, wie es die begleitenden Szenario-Tabellen (Abschnitt 4.5) implizit tun.

**Sind die Zahlen falsch?** Die reine Arithmetik (z-Test-Formel, gegebenes n) ist **korrekt nachgerechnet** — der Fehler liegt nicht in der Formel, sondern in der **Interpretation von n** bei der Übertragung auf die Szenario-Tabellen. Dies wird unten (Abschnitt 6) nicht korrigiert, sondern nur diagnostisch neu berechnet.

---

## 6. MDE-Behauptung geprüft

Phase 3 behauptet: „n≈200 → MDE unter 13pp". Nachrechnung unter vier verschiedenen, in Phase 3 selbst genannten, aber nie konsistent zusammengeführten Annahmen:

| n (Szenario) | MDE unter **RAW N** (naive iid-Annahme, = Phase-3-Originalzahl) | MDE unter **EFFECTIVE N** (RAW/7, alle States) | MDE unter **BEARISH-konditioniertem RAW N** (≈38% von RAW, iid-Annahme) | MDE unter **BEARISH-konditioniertem EFFECTIVE N** (beide Korrekturen kombiniert) |
|---|---|---|---|---|
| 100 | 13,7pp | 33,4pp | 21,8pp | 45,5pp |
| 150 | 11,3pp | 28,2pp | 18,0pp | 41,0pp |
| 200 | 9,8pp | 24,8pp | 15,7pp | 37,1pp |
| 300 | 8,0pp | 20,6pp | 12,9pp | 31,7pp |

(BEARISH-Anteil ≈37,97% empirisch aus Phase-3-Tabelle 4.2: 71 von 187 168h-Beobachtungen TRAIN+VALIDATION waren BEARISH-klassifiziert.)

**Zentraler Befund:** Die Phase-3-Aussage „n≈200 → MDE unter 13pp" ist **nur unter der (in Phase 3 nirgends explizit als solche benannten) Annahme RAW N = unabhängige, ungefilterte Gesamtstichprobe** korrekt. Sobald **eine** der beiden in Phase 3 selbst dokumentierten Eigenschaften des Tests berücksichtigt wird — (a) serielle Abhängigkeit (Abschnitt 13 des Phase-3-Dokuments) oder (b) State-Konditionierung auf BEARISH (Abschnitt 7/14 des Phase-3-Dokuments) — steigt die tatsächliche MDE bei n=200 auf 15,7–24,8pp, weit über den bisher größten beobachteten Effekt (13,0pp). Werden **beide** Korrekturen gemeinsam angewendet (die korrekte Behandlung für den tatsächlich geplanten Primärtest), liegt die MDE bei n=200 (RAW, alle States) bei **37,1pp** — der Test wäre bei diesem Stichprobenumfang selbst für den größten in Phase 1 je beobachteten Effekt (13pp) mit nur ≈12% Power praktisch aussagelos.

**Einordnung nach Kategorie:** **C — statistisch inkonsistent.** Die Aussage „n≈200 → MDE unter 13pp" widerspricht direkt Abschnitt 13 desselben Dokuments und der dort korrekt beschriebenen (aber nicht angewendeten) Abhängigkeitsstruktur.

---

## 7. Zeitpunkte der Szenarien geprüft

**Kalenderarithmetik (RAW N, alle States) — Nachrechnung der Phase-3-Daten:**

| Szenario | RAW N | Phase-3-Datum | Nachgerechnet |
|---|---|---|---|
| A | 100 | Mitte Dezember 2026 | 14.12.2026 — **korrekt** |
| B | 150 | Anfang Februar 2027 | 02.02.2027 — **korrekt** |
| C | 200 | Ende März 2027 | 24.03.2027 — **korrekt** (im Rahmen der „ungefähr"-Formulierung) |
| D | 300 | Ende Juni 2027 | 02.07.2027 — **geringfügig abweichend** (≈2 Tage in den Juli, vernachlässigbar bei einer ohnehin nur approximativen +1/Tag-Heuristik) |

**Die RAW-N-Kalenderarithmetik selbst ist korrekt (A — intern konsistent).** Das eigentliche Problem liegt nicht in der Arithmetik, sondern darin, dass Phase 3 **ausschließlich RAW-N-Zeitpunkte** nennt und daran (in Abschnitt 4.5/5) Power-/MDE-Aussagen knüpft, die de facto EFFECTIVE N oder BEARISH-konditioniertes N voraussetzen (Abschnitt 6). Die vom Auftrag explizit geforderten separaten Zeitpunkte für NON-OVERLAPPING N und EFFECTIVE N fehlen in Phase 3 vollständig — hier nachgeholt (rein diagnostisch):

| Ziel-N (alle States) | NON-OVERLAPPING N erreicht nach | ≈ Datum |
|---|---|---|
| 100 | ~708 Tage (~1,94 Jahre) | Ende Juli 2028 |
| 150 | ~1.058 Tage (~2,90 Jahre) | Mitte Juli 2029 |
| 200 | ~1.408 Tage (~3,85 Jahre) | Mitte Juli 2030 |
| 300 | ~2.108 Tage (~5,77 Jahre) | Mitte Juni 2032 |

EFFECTIVE N wächst in derselben Größenordnung (≈1 pro 7 Tage, aus Abschnitt 4.1 hergeleitet) — die Zeitpunkte für ein gegebenes Ziel-EFFECTIVE-N liegen näherungsweise bei denselben Kalenderdaten wie für das entsprechende NON-OVERLAPPING-N-Ziel.

**Für den tatsächlich benötigten Stichprobenumfang des Primärtests** (BEARISH-konditioniertes EFFECTIVE N = 112, benötigt für 80% Power bei +13pp, aus Phase-3-Abschnitt 5.1): erforderliches RAW N (alle States) ≈ **2.065**, entsprechend **≈2.073 Kalendertagen (≈5,7 Jahre)** ab 28.08.2026 — ungefähr **Mitte 2032**, nicht Ende März 2027 wie in Phase 3 als „Szenario C" suggeriert.

**Einordnung nach Kategorie:** **D — kritischer Blocker** für die *Interpretation* der Szenario-Zeitpunkte (nicht für den Datensammlungsprozess selbst, der unverändert weiterlaufen soll). Die in Phase 3 Abschnitt 4.5 gezogene Schlussfolgerung „Szenario C ist der erste Punkt, an dem die MDE unter den bisher größten Effekt fällt" ist mit den in Phase 3 selbst dokumentierten Abhängigkeits-/Konditionierungseigenschaften **nicht haltbar**.

---

## 8. Confirmatory Test Design geprüft — Mehrdeutigkeiten

Geprüfte Formulierung (Phase 3, Abschnitt 7/14): „Primärtest: 168h, Model B (`domain_balanced_v1`), BEARISH-Hit-Rate vs. Baseline 53,5%".

| Frage | Befund |
|---|---|
| Beobachtungseinheit | **Mehrdeutig.** Nicht explizit definiert, ob n = alle zukünftigen 168h-Kandidaten oder nur die als BEARISH klassifizierte Teilmenge. Die Baseline-Wahl (Always-Bearish, 53,5%) impliziert Konditionierung auf BEARISH-Klassifikation (wie in Phase 1 gehandhabt), aber Abschnitt 4.4/4.5 rechnet mit RAW N über alle States (siehe Abschnitt 4.2/6). |
| Event-Definition | **Mehrdeutig.** „Hit" ist nicht explizit definiert (Preis fällt bis T+168h? Oder relativ zu einem Schwellenwert?) — implizit aus Phase 1 übernommen (`price_fwd < price_t`), aber in Phase 3 nicht erneut ausformuliert. |
| Nur BEARISH getestet? | **Mehrdeutig.** Abschnitt 14 nennt genau EINE Primary Question/Metric/Baseline (BEARISH-fokussiert). Da VALIDATION historisch 0 BULLISH-Beobachtungen hatte, könnte eine analoge BULLISH-Primärhypothese bewusst ausgeschlossen sein — dies wird aber nirgends explizit begründet oder als Entscheidung dokumentiert. |
| Volle Engine vs. Always-Bearish? | Baseline-Protokoll (Abschnitt 12) verlangt Vergleich gegen alle 7 Baselines, aber die EINE „Primary"-Definition (Abschnitt 14) nennt nur Baseline 1. Beziehung zwischen „Primärtest" und „Vergleich gegen alle 7 Baselines" ist **nicht eindeutig hierarchisiert** (welcher Vergleich entscheidet über Gate 3/4?). |
| Nenner identisch? | **Nein, nicht geklärt** — siehe Abschnitt 4.2/6: das ist der Kern des gefundenen Konflationsfehlers. |
| NEUTRAL/MIXED-Behandlung | Nicht spezifiziert, ob diese Beobachtungen aus dem Primärtest ausgeschlossen werden (wahrscheinlich ja, analog Phase 1), aber nicht explizit festgehalten. |
| Forward-Return-Referenzpreis | Nicht explizit in Phase 3 erneut definiert (implizit `close_price`, wie in allen bisherigen Phasen verwendet) — Wiederholungsrisiko einer künftigen abweichenden Analystenentscheidung. |

**Einordnung: B — AMBIguous** (mehrere Definitionslücken, keine davon ist per se falsch, aber alle sind vor einem echten Confirmatory-Test zu schließen).

---

## 9. Überlappung vs. Purging/Embargo

**Bestätigt, wie im Auftrag korrekt vorausgesetzt:** Purging/Embargo (Phase 1) verhindert **Train/Validation/Test-Grenzkontamination** (Label-Leakage über Split-Grenzen hinweg) — dafür wurde es gebaut und dafür funktioniert es nachweislich (24/24 `leakage=false`). Es macht **nicht** automatisch aufeinanderfolgende tägliche 168h-Forward-Returns **innerhalb** eines Auswertungsfensters unabhängig — das ist ein separates Problem (serielle Abhängigkeit, Abschnitt 3/4).

**Kann Phase 3s geplanter Confirmatory-Test gleichzeitig tägliche 168h-Labels verwenden UND die daraus resultierende Abhängigkeit korrekt berücksichtigen?**

**Ja, grundsätzlich möglich** — aber nur mit einer explizit gewählten, abhängigkeitsrobusten Methodik (Block Bootstrap, Stationary Bootstrap, HAC-Standardfehler; alle in Phase 3 Abschnitt 13 bereits benannt). **Phase 3 hat diese Methodik jedoch nicht final festgelegt**, sondern nur als „Kandidat" (Block Bootstrap) benannt, ohne diese Wahl in die Power-/MDE-Berechnung (Abschnitt 5) einfließen zu lassen. Das ist die fehlende Designentscheidung: **eine finale, vor der eigentlichen Auswertung festzulegende Abhängigkeitskorrektur-Methode fehlt**, und die aktuell berichteten Power-/MDE-Zahlen sind ohne sie irreführend, wenn sie mit RAW N gelesen werden.

**Einordnung: D — kritischer Blocker** (fehlende, aber vor der ersten inhaltlichen Auswertung zwingend zu treffende Designentscheidung — siehe Abschnitt 14 unten für Minimal-Scope-Vorschlag).

---

## 10. Block Bootstrap — konzeptionelle Prüfung

**Ist Block Bootstrap für die geplante Abhängigkeit geeignet?** Ja — die in Abschnitt 4.1 hergeleitete Dreiecks-Autokorrelationsstruktur (linear abfallend über 7 Tage) ist ein Lehrbuchfall für Block-Bootstrap-Verfahren.

**Würde es RAW N=200 zu EFFECTIVE N≈200 machen? NEIN.** Das ist ein verbreitetes Missverständnis, das hier explizit ausgeräumt wird: Block Bootstrap **schätzt die durch Abhängigkeit korrekt inflationierte Varianz/das korrekte Konfidenzintervall**, es **erzeugt keine zusätzliche statistische Information**. Die resultierende Power/CI-Breite eines korrekt durchgeführten Block-Bootstrap-Tests auf RAW N=200 würde der Größenordnung nach den in Abschnitt 6 berechneten EFFECTIVE-N-Werten entsprechen (MDE eher bei 20–25pp als bei 9,8pp) — Block Bootstrap macht die Inferenz **ehrlich**, nicht **stärker**.

**Blocklänge:** müsste an die nachgewiesene 7-Tage-Abhängigkeitsstruktur angepasst werden (Blocklänge ≥7, typischerweise im Bereich 7–14 Tage, um die vollständige Autokorrelationsstruktur zu erfassen, ohne bei begrenztem Gesamt-n zu wenige Blöcke für ein aussagekräftiges Resampling übrig zu lassen). Keine finale Blocklänge wird hier festgelegt.

**Auswirkung auf Power/CI:** korrekt (nicht künstlich) breitere Konfidenzintervalle und niedrigere Power als eine naive iid-Berechnung — konsistent mit den EFFECTIVE-N-Spalten in Abschnitt 6.

**Einordnung: A — intern konsistent** (Block Bootstrap ist als Kandidat korrekt benannt), aber siehe Abschnitt 9 für die fehlende finale Festlegung.

---

## 11. Pre-Registration Integrity

| Feld | Status |
|---|---|
| Primärhypothese | **A** — eindeutig benannt |
| Primärer Horizont | **A** — eindeutig eingefroren (168h) |
| Primärer Vergleich | **B** — Beziehung zwischen „Primärtest gegen Baseline 1" und „Vergleich gegen alle 7 Baselines" nicht hierarchisiert (Abschnitt 8) |
| Baseline | **A** — Definitionen eingefroren (Abschnitt 12 Phase 3), aber siehe Beobachtungseinheit |
| Signifikanzniveau | **A** — α=0,05 zweiseitig, eindeutig |
| Multiple Testing | **A** — BH primär, Bonferroni als Sensitivität, m≈9-11 benannt |
| Effektgröße (MPRE) | **B** — nur als „Diskussionsvorschlag +5pp", ausdrücklich nicht final bestätigt |
| Beobachtungseinheit | **B** — siehe Abschnitt 8, zentrale offene Frage |
| Ausschlussregeln (NEUTRAL/MIXED) | **B** — nicht explizit festgehalten |
| Overlap-Regel | **D** — Abhängigkeitsstruktur korrekt beschrieben (Abschnitt 13 Phase 3), aber keine finale Korrekturmethode gewählt, und die Beschreibung ist nicht mit den Power-Zahlen verzahnt (Abschnitt 6/9 dieses Audits) |
| Abhängigkeit | **D** — dieselbe Lücke wie Overlap-Regel |
| Stopping Rule | **B** — „frühestens bei Szenario C" ist als Richtwert benannt, aber kein hartes, vorab spezifiziertes Abbruch-/Auswertungskriterium (z. B. exaktes N, exaktes Datum, oder „das zuerst Eintretende") |
| Testset-Isolation | **A** — siehe Abschnitt 12 dieses Dokuments |
| Zeitpunkt der Auswertung | **B** — an die (fehlerhafte) Szenario-Interpretation gekoppelt, muss nach Korrektur von Abschnitt 6/7 neu datiert werden |

**Zusammenfassung:** Mehrere Stellen erlauben aktuell noch eine spätere Analysten-Entscheidung (B-Kategorie), zwei Stellen (Overlap-Regel/Abhängigkeit) sind nicht nur unpräzise, sondern **aktiv inkonsistent mit den bereits berichteten Zahlen** (D-Kategorie).

---

## 12. Testset-Integrität

- **Testset bleibt unangetastet** — bestätigt, keine Abfrage in Phase 3 oder Phase 3.1 hat auf den TEST-Zeitraum (08.07.–26.08.2026) zugegriffen.
- **Phase-3-Future-Research-Window ≠ finales Testset** — bestätigt strukturell: das Future-Research-Window beginnt 28.08.2026, also nach dem Ende des bestehenden TEST-Zeitraums; beide überlappen kalendarisch nicht.
- **Technischer Schutzmechanismus, live geprüft:** `research_test_access_log` (Tabelle) + `research_log_test_access()` (Funktion, Phase 6) existieren. Dies ist ein **passiver, opt-in Logging-Mechanismus** (ein einfacher `INSERT`) — **kein** hartes DB-seitiges Zugriffsverbot (keine RLS-Regel, kein Constraint, der eine direkte `SELECT`-Abfrage auf TEST-Zeilen technisch verhindert). Der Schutz beruht auf Disziplin/Konvention plus nachträglicher Nachvollziehbarkeit, nicht auf technischer Durchsetzung. Das war bereits der in Phase 6 bewusst gewählte Schutzgrad — hier nur bestätigend dokumentiert, nicht bemängelt oder verändert.
- **Keine rückwirkende Architekturentscheidung aus künftigen Confirmatory-Ergebnissen ins Testset** — durch die Gate-Struktur (Phase 3, Abschnitt 15, Gate 7: Testset erst nach Gates 1–6) bereits strukturell vorgesehen; keine Verletzung in Phase 3 gefunden.

**Einordnung: A — intern konsistent**, mit einer dokumentierten (nicht neuen) Randbemerkung zum Schutzgrad.

---

## 13. Entscheidung

**A — INTERN KONSISTENT**
- Grundformel und Nachrechnung des Ein-Stichproben-z-Tests (Abschnitt 5).
- Herleitung/Bestätigung der `EFFECTIVE N ≈ RAW N/7`-Heuristik (Abschnitt 4.1) — mathematisch korrekt.
- RAW-N-Kalenderarithmetik der Szenario-Zeitpunkte (Abschnitt 7).
- Primärhypothese, primärer Horizont, Signifikanzniveau, Multiple-Testing-Rahmen, Baseline-Definitionen (Abschnitt 11).
- Testset-Isolation (Abschnitt 12).
- Block Bootstrap als konzeptionell geeigneter Kandidat (Abschnitt 10).

**B — AMBIGUOUS**
- Beobachtungseinheit/Nenner des Primärtests (RAW N alle States vs. BEARISH-konditioniert) — zentrale offene Frage.
- Beziehung „Primärtest gegen 1 Baseline" vs. „Vergleich gegen alle 7 Baselines".
- MPRE (+5pp) nicht final bestätigt.
- Ausschlussregeln für NEUTRAL/MIXED nicht explizit festgehalten.
- Stopping Rule nur als Richtwert, kein hartes Kriterium.

**C — STATISTISCH INKONSISTENT**
- Aussage „n≈200 → MDE unter 13pp" (Phase 3, Abschnitt 4.5) widerspricht der in Phase 3 Abschnitt 13 selbst korrekt beschriebenen Abhängigkeitsstruktur, sobald diese angewendet wird (Abschnitt 6 dieses Audits: tatsächliche MDE bei n=200 liegt je nach Korrektur bei 15,7–37,1pp).

**D — KRITISCHER BLOCKER**
1. **Konflation RAW N / EFFECTIVE N** in den Power-/MDE-Tabellen (Abschnitt 4.5, 5) — muss vor jeder Verwendung dieser Zahlen zur Entscheidungsfindung korrigiert werden.
2. **Konflation RAW N (alle States) / BEARISH-konditioniertes N** in denselben Tabellen — zweiter, unabhängiger Fehler mit ähnlicher Größenordnung.
3. **Fehlende finale Festlegung der Abhängigkeitskorrektur-Methode** (Block Bootstrap o. ä.) für den tatsächlichen Confirmatory-Test — ohne diese Festlegung ist unklar, mit welcher Methodik die künftige Auswertung überhaupt durchgeführt werden soll.
4. **Szenario-Zeitpunkte (Abschnitt 4.5/7 Phase 3) suggerieren eine Auswertungsbereitschaft (Ende März 2027), die bei korrekter Berücksichtigung von 1+2 nicht haltbar ist** — realistische Zeithorizonte für einen adäquat gepowerten Test liegen, je nach exakter Zielgröße, im Bereich mehrerer Jahre (Abschnitt 7).

---

## 14. Wichtigste Ausgabe

**Kann Nexus-Atlas das Phase-3-Protokoll unverändert weiterlaufen lassen und bis zur ausreichenden Datenbasis Daten sammeln, oder muss das Protokoll VOR Beginn der Datenakkumulation korrigiert werden?**

**Zweigeteilte, präzise Antwort:**

1. **Der passive Datensammlungsprozess selbst (der `pg_cron`-Job, der `backtest_states` täglich fortschreibt) kann und soll unverändert weiterlaufen.** Er ist von den gefundenen Inkonsistenzen nicht betroffen — er produziert weiterhin korrekt +1 RAW-Beobachtung/Tag, unabhängig davon, wie diese später interpretiert wird.

2. **Die im Phase-3-Dokument berichteten Power-/MDE-/Zeitpunkt-Aussagen (Abschnitt 4.5, 5, 6, 7) dürfen NICHT unverändert als Entscheidungsgrundlage für „ist n=200 ausreichend" oder „wann soll ausgewertet werden" verwendet werden.** Sie enthalten die unter Abschnitt 13 (C, D) dokumentierten Fehler.

**Notwendige Korrektur vor Beginn der eigentlichen konfirmatorischen Auswertung (nicht vor der weiteren Datenakkumulation):**

- **Exakt benennen:** (a) Definiere den Nenner des Primärtests eindeutig als BEARISH-konditioniertes N (konsistent mit der gewählten Baseline), nicht als RAW N über alle States. (b) Lege die finale Abhängigkeitskorrekturmethode fest (Block Bootstrap mit Blocklänge ≥7 Tage ist der plausibelste Kandidat) und berechne Power/MDE/Szenario-Zeitpunkte auf dieser Basis neu — nicht mit dem naiven z-Test auf RAW N.
- **Begründung:** Beide Fehler sind unabhängig voneinander nachweisbar (Abschnitt 6) und führen gemeinsam zu einer Diskrepanz von etwa einer Größenordnung zwischen der in Phase 3 suggerierten Auswertungsbereitschaft (Ende März 2027) und dem tatsächlich für eine 80%-Power-Auswertung des bisher größten beobachteten Effekts benötigten Zeitraum (~2032, Abschnitt 7).
- **Minimaler Änderungsumfang:** Es muss **kein neues Modell, keine neue Hypothese und keine neue Baseline** eingeführt werden. Die Korrektur betrifft ausschließlich die **Neuberechnung der Tabellen in Phase-3-Abschnitt 4.5/5/6/7** unter (a) expliziter State-Konditionierung und (b) einer festgelegten Abhängigkeitskorrektur, sowie eine **Klarstellung der Beobachtungseinheit in Abschnitt 8/14** des Phase-3-Dokuments. Dies ist eine **Dokumentationskorrektur**, keine Änderung an Hypothesen, Baselines, Modellen oder am Datensammlungsprozess.

**Diese Korrektur wird in Phase 3.1 nicht durchgeführt** (wie vom Auftrag verlangt) — sie wird hier nur benannt und begründet, zur Umsetzung in einem separaten, künftigen Auftrag.

---

## 15. Ausdrücklicher Stopp

Nach Abschluss dieses Audits: keine Code-, DB-, Production-, Engine-, Feature-, Threshold-, Gewichts- oder Modelländerung. Keine Auswertung des zukünftigen Research-Windows. Keine Testset-Änderung. Nur dieses Dokument wurde erstellt, committed und gepusht.

**STOPP.** Warte auf neuen Auftrag.
