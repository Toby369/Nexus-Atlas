# Phase 3.2 — Research Protocol Correction & Power Re-Calculation

**STATUS: RESEARCH ONLY.** Korrigiert ausschließlich die Dokumentation/Mathematik des Phase-3-Research-Protokolls anhand der in Phase 3.1 nachgewiesenen Fehler. Keine Production-, Engine-, Feature-, Threshold-, Gewichts-, Modell-, Baseline- oder Testset-Änderung. Keine Änderung am `pg_cron`-Datensammler. Keine neue Hypothese, kein neues Modell, keine neue Trading-Regel.

---

## 1. Executive Summary

Phase 3.1 hat zwei unabhängige Konflationsfehler in den Phase-3-Power-/MDE-/Zeitplan-Tabellen nachgewiesen: (1) RAW N wurde wie unabhängige Beobachtungen behandelt, obwohl tägliche 168h-Forward-Returns eine nachgewiesene 7-Tage-Abhängigkeitsstruktur haben; (2) RAW N über alle States wurde verwendet, obwohl der deklarierte Primärtest auf BEARISH-klassifizierte Beobachtungen konditioniert ist. Diese Phase korrigiert beide Fehler, definiert die Beobachtungseinheit des Primärtests endgültig, legt eine methodisch begründete Abhängigkeitskorrektur (Moving Block Bootstrap) fest und berechnet alle Power-/MDE-/Zeitplan-Aussagen neu. **Zentrales Ergebnis:** Die tatsächlich für eine 80%-Power-Auswertung benötigte Datensammelzeit liegt, je nach künftiger BEARISH-Rate, zwischen ~3 und ~9 Jahren für die zuvor diskutierten Effektgrößen (+13pp/+10pp) — nicht Monate. Kleinere Effekte (+5pp, teils +8pp) sind auf einem realistischen Planungshorizont **nicht erreichbar** und werden als solche gekennzeichnet, nicht beschönigt. Es wird **keine** Empfehlung zur Architektur-, Feature- oder Modelländerung abgeleitet — diese Phase korrigiert ausschließlich das Research-Protokoll.

---

## 2. Ausgangsfehler aus Phase 3

Aus `PHASE-3-RESEARCH-PROTOCOL.md` (Abschnitt 4.5, 5, 6, 7): Power-/MDE-Tabellen und Szenario-Zeitpunkte (n=100/150/200/300) verwendeten den Standard-Ein-Stichproben-z-Test mit RAW N über alle States als Stichprobengröße — ohne die in Abschnitt 13 desselben Dokuments korrekt beschriebene serielle Abhängigkeit und ohne die in Abschnitt 7/14 deklarierte BEARISH-Konditionierung des Primärtests einzurechnen.

---

## 3. Ergebnisse von Phase 3.1

Aus `PHASE-3.1-INTEGRITY-CHECK.md`: mathematische Herleitung des Inflationsfaktors τ=7 (unter vereinfachender iid-Tagesrenditen-Annahme) bestätigt die Heuristik `EFFECTIVE N ≈ RAW N/7`. Nachweis, dass die Phase-3-Aussage „n≈200 → MDE unter 13pp" bei Anwendung dieser Korrektur (24,8pp) und/oder der BEARISH-Konditionierung (15,7pp) bzw. beider kombiniert (37,1pp) nicht haltbar ist. Klassifikation C (statistisch inkonsistent) und D (kritischer Blocker, u. a. fehlende finale Abhängigkeitskorrekturmethode). Empfehlung: Nenner auf BEARISH-konditioniertes N umstellen, finale Inferenzmethode festlegen, Tabellen neu berechnen — **exakt der Auftrag dieser Phase.**

---

## 4. Definition der vier N-Konzepte

| Konzept | Definition | Formel/Herkunft |
|---|---|---|
| **A. RAW N** | Alle gültigen, purged+embargoed 168h-Beobachtungen, unabhängig vom State | direkt aus `backtest_states` gezählt, +1/Kalendertag |
| **B. BEARISH RAW N** | Teilmenge von A, bei denen der zum Prognosezeitpunkt gültige Model-B-State BEARISH ist | `A × BEARISH-Rate` (empirisch ≈38,0%, siehe Abschnitt 7) |
| **C. NON-OVERLAPPING N** | Tatsächlich nicht überlappende Beobachtungen (Fenster ≥7 Kalendertage auseinander) — eine echte Subsampling-Regel, kein statistisches Konzept | ≈ A/7 (alle States) bzw. ≈ B/7 (BEARISH-only, unter der vereinfachenden Annahme räumlich gleichverteilter BEARISH-Tage — siehe Einschränkung unten) |
| **D. EFFECTIVE N** | Statistisch effektive, für Inferenz relevante Informationsmenge unter der nachgewiesenen Abhängigkeitsstruktur — ein Inferenzkonzept, keine tatsächlich existierende Beobachtungsmenge | ≈ B/7 (diagnostische Näherung, siehe Abschnitt 5 unten für Einschränkungen) |

**Wichtige Klarstellung (wie vom Auftrag gefordert):** C und D sind konzeptionell verschieden — C ist eine konkrete Subsampling-Regel (auswählbare, tatsächlich existierende Teilmenge), D ist ein abstraktes Inferenzkonzept (wie viel *unabhängige Information* die *gesamte* abhängige Stichprobe trägt, ohne Daten wegzuwerfen). Unter der in Abschnitt 5 hergeleiteten vereinfachenden Annahme fallen ihre **Zahlenwerte** näherungsweise zusammen (beide ≈ B/7), das ist aber ein Artefakt der idealisierten Herleitung, keine notwendige Gleichheit. Für den tatsächlichen Primärtest wird **D (Effective N, via Block Bootstrap)** verwendet, nicht C — Subsampling auf C würde 6 von 7 vorhandenen Beobachtungen verwerfen, ohne dass dies statistisch notwendig ist (siehe Abschnitt 6).

---

## 5. Endgültige Beobachtungseinheit

**Primärer Analysefall (endgültig, eingefroren):**

| Feld | Festlegung |
|---|---|
| Horizon | 168h / 7 Tage |
| State | BEARISH (Model B, `domain_balanced_v1`, zum Prognosezeitpunkt gültiger, point-in-time-sicher rekonstruierter Domain-State) |
| Target | bestehende 168h-Forward-Return-/Direction-Definition: `direction = UP wenn close(t+168h) > close(t), sonst DOWN`, `close` = `market_features.close_price` (unverändert aus Phase 0–3 übernommen) |
| Population | **ausschließlich Beobachtungen mit State=BEARISH** — RAW N über alle States ist **nicht** die Stichprobengröße des Primärtests |
| Future-Research-Window | ausschließlich ab 28.08.2026 neu gesammelte Daten |
| TRAIN/VALIDATION | bleiben diagnostisch „gesehen" — werden **nicht** rückwirkend als unberührte Confirmatory-Daten umdeklariert |

**Sample-Size-Hierarchie für den Primärtest:** Nenner = **BEARISH RAW N** als Eingabe für die Block-Bootstrap-Inferenz (Abschnitt 6); **nicht** RAW N über alle States, **nicht** eine vorab auf Non-Overlap reduzierte Teilmenge (die würde verfügbare Information unnötig verwerfen).

---

## 6. 168h-Overlap — erneute, präzisere Herleitung

**Überlappungsstruktur (unverändert bestätigt):** `R_t = Σ_{i=1}^{7} r_{t+i}` (Summe von 7 Tagesrenditen). Für `k<7`: `Cov(R_t,R_{t+k}) = (7−k)·Var(r)`, `Corr(R_t,R_{t+k}) = (7−k)/7`. Inflationsfaktor `τ = 1+2·Σ_{k=1}^{6}(7−k)/7 = 7` — **exakt**, aber **nur unter der vereinfachenden Annahme näherungsweise unabhängiger Tagesrenditen**.

**Ausdrückliche Einschränkung (wie vom Auftrag verlangt):** Diese Herleitung ist eine **theoretische, diagnostische Näherung**, kein empirischer Beweis, dass in der Zukunft tatsächlich exakt `RAW N/7` unabhängige Beobachtungen existieren werden. Reale Tagesrenditen zeigen bekanntlich zusätzliche Autokorrelation (Volatility Clustering, Regime-Persistenz — in Phase 6 für `trend_regime`/`adx_14` mit AC-Lag-1 von 0,994–0,999 explizit dokumentiert), was `τ` in der Praxis über 7 hinaus treiben könnte. Die empirische Verifikation von `τ` ist erst mit einer ausreichend langen Future-Research-Reihe möglich (nicht in Phase 3.2 durchführbar — keine Nutzung von Future-Window-Daten zur Methodenwahl erlaubt) und bleibt eine **verbleibende Unsicherheit** (Abschnitt 15).

**Warum RAW N nicht direkt für einen iid-z-Test verwendet werden darf:** Der Ein-Stichproben-z-Test setzt `Var(p̂) = p(1−p)/n` voraus — das gilt nur für unabhängige Bernoulli-Versuche. Bei der nachgewiesenen Dreiecks-Autokorrelation ist die tatsächliche Varianz von `p̂` um den Faktor `τ≈7` größer, das heißt der naive z-Test unterschätzt Konfidenzintervalle systematisch und überschätzt Power systematisch — exakt der in Phase 3.1 nachgewiesene Fehler.

**Trennung der drei Konzepte (wie gefordert):**
- **Theoretische Nichtüberlappung** — eine geometrische/kalendarische Eigenschaft (ab wie viel Tagen Abstand teilen zwei Fenster keine Tage mehr) — exakt 7 Tage, unabhängig von jeder Verteilungsannahme.
- **Effektive Stichprobengröße** — ein Inferenzkonzept, abhängig von der (nur näherungsweise bekannten) Autokorrelationsstruktur der zugrundeliegenden Renditen — Näherung `τ≈7`, nicht empirisch verifiziert.
- **Statistische Abhängigkeitskorrektur** — die tatsächliche Methodik, mit der bei der künftigen Auswertung gültige Inferenz erzielt wird, unabhängig davon, ob die Näherung für `τ` exakt stimmt — siehe Abschnitt 6 (Methode).

---

## 6a. Finale Abhängigkeitskorrektur — Moving Block Bootstrap

**Geprüfte Alternativen:**

| Methode | Eignung für die vorliegende Struktur |
|---|---|
| Moving Block Bootstrap (MBB) | **Gewählt.** Passt direkt zu einer bekannten, deterministischen, endlichen Abhängigkeitslänge (H=7 Tage, aus der Label-Konstruktion selbst folgend, nicht geschätzt) |
| Circular Block Bootstrap (CBB) | Reduziert Randeffekte gegenüber MBB, aber löst kein zusätzliches Problem hier, da die Zeitreihe nicht als zyklisch zu behandeln ist (Kalenderzeit, kein periodisches Phänomen) — nicht gewählt, aber als valide Alternative dokumentiert |
| Stationary Bootstrap (SB) | Geeignet, wenn die Abhängigkeitslänge selbst unsicher/variabel ist (zufällige Blocklänge aus geometrischer Verteilung) — hier nicht die passende Wahl, da H=7 strukturell bekannt ist, nicht geschätzt werden muss |

**Blockstruktur, endgültig festgelegt:**

- **Blocklänge L=14 Kalendertage** (= 2×H). Begründung: gängige Praxis im Block-Bootstrap-Kontext ist eine Blocklänge deutlich über der bekannten Abhängigkeitslänge, um die vollständige Autokovarianzstruktur mit Sicherheitsmarge zu erfassen (insbesondere angesichts der in Abschnitt 6 dokumentierten Möglichkeit, dass das reale `τ` über 7 hinausgeht). L=14 ist **jetzt**, vor Existenz jeglicher Future-Window- oder Testset-Daten, ausschließlich aus der bereits in Phase 0/1 etablierten, strukturellen H=7-Tatsache abgeleitet — **keine** Optimierung anhand künftiger Ergebnisse.
- **Blockbildung auf der VOLLEN Kalenderreihe, nicht auf der BEARISH-gefilterten Teilreihe.** Dies ist eine in Phase 3/3.1 noch nicht erkannte, hier neu dokumentierte methodische Präzisierung: würde man Blöcke direkt auf der BEARISH-only-Teilsequenz bilden, ginge die tatsächliche Kalenderzeit-Distanz zwischen aufeinanderfolgenden BEARISH-Beobachtungen verloren (zwei in der gefilterten Reihe „benachbarte" BEARISH-Tage können in Wirklichkeit viele Kalendertage auseinanderliegen, wenn dazwischen Nicht-BEARISH-Tage lagen — oder unmittelbar benachbart sein, wenn eine BEARISH-Phase mehrere Tage andauert). **Korrektes Verfahren:** Resampling zieht zusammenhängende 14-Tage-Blöcke aus der vollständigen täglichen Beobachtungsreihe (alle States, chronologisch), fügt sie zu einer Pseudo-Reihe derselben Gesamtlänge zusammen und berechnet die Zielstatistik **innerhalb jeder Pseudo-Reihe nur über die darin enthaltenen BEARISH-klassifizierten Tage.**
- **Gebootstrappte Statistik:** Hit-Rate-Differenz = (BEARISH-konditionierte Trefferquote in der Pseudo-Reihe) − (fixe Baseline 53,5%, siehe Abschnitt 8 — die Baseline selbst wird **nicht** resampled, sie ist ein aus der historischen, bereits eingefrorenen Phase-1-Datenbasis fixierter Referenzwert).
- **CI:** 95%, Perzentil-Methode als Ausgangspunkt (Bias-Corrected-and-Accelerated als mögliche Verfeinerung zum Zeitpunkt der tatsächlichen Analyse, hier nicht final festgelegt).
- **p-Wert:** Anteil der Bootstrap-Replikate (nach Zentrierung auf H0), die mindestens so extrem sind wie die beobachtete Statistik — Standardverfahren, exakte Implementierungsdetails zum Analysezeitpunkt.
- **Keine Nutzung von Testset- oder Future-Window-Daten zur Methodenwahl:** bestätigt — L=14 und MBB wurden ausschließlich aus der bereits vor Phase 3 bekannten H=7-Struktur abgeleitet.

**Ausdrücklich dokumentiert (wie vom Auftrag verlangt):** *„Block Bootstrap korrigiert die Inferenz für Abhängigkeit; er erhöht nicht die tatsächlich vorhandene Informationsmenge."* Die mit MBB erzielte Power/CI-Breite wird asymptotisch der in Abschnitt 7 berechneten EFFECTIVE-N-Näherung entsprechen — MBB macht die Aussage **korrekt**, nicht **stärker**. Die in Abschnitt 7 berichteten Power-/MDE-Werte sind daher als **asymptotische Näherung an das erwartete MBB-Ergebnis** zu verstehen, nicht als exakte MBB-Simulation (diese ist erst mit realen Future-Window-Daten sinnvoll durchführbar).

---

## 7. Korrigierte Power-Berechnung

**BEARISH-Rate — keine frei erfundene Zahl, Sensitivitätsband um den empirischen Wert:**

| Szenario | BEARISH-Rate | Herkunft |
|---|---|---|
| konservativ niedrig | 25% | untere Plausibilitätsgrenze (Annahme: künftige Marktphasen weniger bearish-lastig als TRAIN+VALIDATION) |
| **empirisch (Referenz)** | **38,0%** (exakt 37,97%) | `PHASE-3.1-INTEGRITY-CHECK.md`, Abschnitt 6: 71 von 187 168h-Beobachtungen TRAIN+VALIDATION waren BEARISH-klassifiziert |
| konservativ hoch | 50% | obere Plausibilitätsgrenze |

**Power-/MDE-Tabelle, alle Kombinationen (Baseline 53,5%, α=0,05 zweiseitig, EFFECTIVE N = BEARISH RAW N/7 als asymptotische Näherung an das MBB-Ergebnis):**

### Rate 25% (konservativ niedrig)

| RAW N | BEARISH N | Eff./Non-Overlap N | MDE (80%) | Pow@5pp | Pow@8pp | Pow@10pp | Pow@13pp | Pow@15pp |
|---|---|---|---|---|---|---|---|---|
| 100 | 25,0 | 3,6 | 46,0pp | 3,7% | 4,5% | 5,1% | 6,0% | 6,8% |
| 150 | 37,5 | 5,4 | 45,6pp | 4,0% | 5,2% | 6,1% | 7,6% | 8,7% |
| 200 | 50,0 | 7,1 | 42,6pp | 4,3% | 5,8% | 7,0% | 9,1% | 10,7% |
| 300 | 75,0 | 10,7 | 37,3pp | 4,9% | 7,1% | 8,8% | 12,1% | 14,7% |
| 500 | 125,0 | 17,9 | 30,4pp | 6,0% | 9,4% | 12,4% | 18,2% | 23,0% |
| 750 | 187,5 | 26,8 | 25,5pp | 7,2% | 12,3% | 17,0% | 25,9% | 33,2% |
| 1000 | 250,0 | 35,7 | 22,4pp | 8,4% | 15,2% | 21,5% | 33,5% | 43,1% |

### Rate 38% (empirisch, Referenzszenario)

| RAW N | BEARISH N | Eff./Non-Overlap N | MDE (80%) | Pow@5pp | Pow@8pp | Pow@10pp | Pow@13pp | Pow@15pp |
|---|---|---|---|---|---|---|---|---|
| 100 | 38,0 | 5,4 | 45,5pp | 4,0% | 5,2% | 6,1% | 7,6% | 8,8% |
| 150 | 57,0 | 8,1 | 41,0pp | 4,5% | 6,2% | 7,5% | 9,9% | 11,8% |
| 200 | 75,9 | 10,9 | 37,1pp | 4,9% | 7,1% | 8,9% | 12,2% | 14,9% |
| 300 | 113,9 | 16,3 | 31,7pp | 5,8% | 8,9% | 11,7% | 16,8% | 21,1% |
| 500 | 189,8 | 27,1 | 25,4pp | 7,3% | 12,4% | 17,1% | 26,2% | 33,6% |
| 750 | 284,8 | 40,7 | 21,1pp | 9,1% | 16,8% | 24,0% | 37,7% | 48,2% |
| 1000 | 379,7 | 54,2 | 18,4pp | 10,8% | 21,2% | 30,8% | 48,3% | 60,8% |

### Rate 50% (konservativ hoch)

| RAW N | BEARISH N | Eff./Non-Overlap N | MDE (80%) | Pow@5pp | Pow@8pp | Pow@10pp | Pow@13pp | Pow@15pp |
|---|---|---|---|---|---|---|---|---|
| 100 | 50,0 | 7,1 | 42,6pp | 4,3% | 5,8% | 7,0% | 9,1% | 10,7% |
| 150 | 75,0 | 10,7 | 37,3pp | 4,9% | 7,1% | 8,8% | 12,1% | 14,7% |
| 200 | 100,0 | 14,3 | 33,4pp | 5,5% | 8,3% | 10,6% | 15,1% | 18,8% |
| 300 | 150,0 | 21,4 | 28,2pp | 6,5% | 10,6% | 14,3% | 21,3% | 27,1% |
| 500 | 250,0 | 35,7 | 22,4pp | 8,4% | 15,2% | 21,5% | 33,5% | 43,1% |
| 750 | 375,0 | 53,6 | 18,5pp | 10,7% | 21,0% | 30,5% | 47,8% | 60,2% |
| 1000 | 500,0 | 71,4 | 16,1pp | 13,0% | 26,8% | 39,2% | 60,1% | 73,4% |

**Klare Aussage pro Szenario, wie gefordert:** Selbst bei RAW N=1000 (alle States) bleibt die Power für +13pp im empirischen Rate-Szenario bei nur 48,3% — **unterhalb** der konventionellen 80%-Schwelle. Erst deutlich jenseits von RAW N=1000 wird eine konfirmatorische Auswertung für die bisher relevanten Effektgrößen (+13pp/+15pp) sinnvoll (siehe Abschnitt 9 für exakte Zeitpunkte). Für +5pp ist auch bei RAW N=1000 die Power einstellig (10,8%) — **eine konfirmatorische Auswertung für +5pp ist auf jedem realistischen Planungshorizont nicht sinnvoll** (siehe Abschnitt 9).

---

## 8. Korrigierte MDE-Berechnung

Bereits vollständig in der Tabelle oben enthalten (Spalte „MDE (80%)"). Zusätzlich, die vom Auftrag geforderte erforderliche EFFECTIVE-BEARISH-N für 80% Power je Effektgröße (unabhängig von der Rate, reine z-Test-Inversion):

| Effekt | benötigtes BEARISH-Effective-N (80% Power) |
|---|---|
| +5pp | 776 |
| +8pp | 301 |
| +10pp | 192 |
| +13pp | 112 |
| +15pp | 84 |

---

## 9. Korrigierte Kalender-/Datensammelzeitpunkte

**RAW N (alle States) — reine Datenmenge, +1/Kalendertag ab 28.08.2026, ~8 Tage Anfangsverzug:**

| RAW N | Datum | Zeit ab heute |
|---|---|---|
| 100 | 14.12.2026 | ~0,30 Jahre |
| 150 | 02.02.2027 | ~0,43 Jahre |
| 200 | 24.03.2027 | ~0,57 Jahre |
| 300 | 02.07.2027 | ~0,84 Jahre |
| 500 | 18.01.2028 | ~1,39 Jahre |
| 750 | 24.09.2028 | ~2,08 Jahre |
| 1000 | 01.06.2029 | ~2,76 Jahre |

**Wichtig, wie gefordert — Unterscheidung „genug Daten" vs. „genug unabhängige Information":** Die obige Tabelle sagt nur, wann eine bestimmte **Datenmenge** existiert. Sie sagt **nichts** darüber aus, ob diese Datenmenge für eine belastbare statistische Aussage ausreicht. Dafür maßgeblich ist die BEARISH-konditionierte effektive Stichprobe:

**Wann ist eine für 80%-Power ausreichende BEARISH-Effective-N erreicht (nach Effektgröße, nach Rate-Szenario):**

| Effekt | Rate 25% | Rate 38% (empirisch) | Rate 50% |
|---|---|---|---|
| +15pp | ~6,5 Jahre (Feb 2033) | **~4,3 Jahre (Dez 2030)** | ~3,2 Jahre (Nov 2029) |
| +13pp | ~8,6 Jahre (Apr 2035) | **~5,7 Jahre (Mai 2032)** | ~4,3 Jahre (Dez 2030) |
| +10pp | ~14,7 Jahre (Mai 2041) | **~9,7 Jahre (Mai 2036)** | ~7,4 Jahre (Jan 2034) |
| +8pp | ~23,1 Jahre (Okt 2049) | **~15,2 Jahre (Nov 2041)** | ~11,6 Jahre (Mär 2038) |
| +5pp | ~59,5 Jahre (2086) | **~39,2 Jahre (2065)** | ~29,8 Jahre (2056) |

**Explizite Aussage, wie gefordert:** Für **+5pp ist eine adäquat gepowerte konfirmatorische Auswertung auf keinem realistischen Planungshorizont erreichbar** — dies wird hier ausdrücklich so benannt, nicht relativiert. Für **+8pp** liegt der Zeithorizont je nach Rate-Szenario zwischen ~12 und ~23 Jahren — ebenfalls jenseits eines normalen Projektplanungshorizonts. Für **+10pp/+13pp/+15pp** liegen realistische Zeithorizonte zwischen ~3 und ~15 Jahren, abhängig stark von der künftigen BEARISH-Rate — die einzigen Effektgrößen, für die eine mittelfristige (Jahre statt Jahrzehnte) konfirmatorische Auswertung überhaupt plausibel erscheint.

---

## 10. Endgültige Definition des Primärtests

| Feld | Festlegung |
|---|---|
| Population | Ausschließlich BEARISH-klassifizierte 168h-Beobachtungen (Model B, `domain_balanced_v1`) im Future-Research-Window |
| Horizon | 168h |
| Primary Target | bestehende Forward-Return-/Direction-Definition (Abschnitt 5) |
| Primary Baseline | Always-Bearish, empirisch 53,5% (unconditioned, aus TRAIN+VALIDATION, Phase 1/3) |
| **Semantik-Check (wie gefordert)** | **Kein Konflikt gefunden.** „Always-Bearish" ist bewusst eine *unkonditionierte* Strategie (sagt für JEDEN Tag „Preis fällt" voraus, unabhängig vom Model-B-State) — ihre Hit-Rate (53,5%) wird über die volle historische Population berechnet, nicht über die BEARISH-konditionierte Teilmenge. Der Primärtest vergleicht die *konditionierte* Modell-Trefferquote (nur BEARISH-Tage) gegen diese *unkonditionierte* Referenzgröße — das ist die konventionelle „Modell vs. naive Regel"-Konstruktion, konsistent mit Phase 1s Methodik. **Dokumentierte Vereinfachung, kein Blocker:** die Baseline (53,5%) wird als aus der großen historischen Stichprobe (n=187) bereits präzise geschätzte, fixe Konstante behandelt — ihre eigene Schätzunsicherheit wird nicht in die Power-Rechnung des Primärtests propagiert (Standardvorgehen bei einer als „bekannt" behandelten Referenzrate, siehe auch Phase 1). |
| Significance | α=0,05, zweiseitig — weiterhin gerechtfertigt, keine Änderung |
| Multiple Testing | Primärtest bleibt EIN einzelner, vorab definierter Test (keine Korrektur nötig für ihn selbst). Sekundäre/explorative Analysen (Baselines 2–7, 24h/720h, Regime-Zellen) bleiben separat und unterliegen weiterhin Benjamini-Hochberg (Phase 3, Abschnitt 7) |
| Inferenzmethode | Moving Block Bootstrap, L=14 Tage, geblockt auf voller Kalenderreihe (Abschnitt 6a) |
| Ausschlussregeln | NEUTRAL/MIXED/BULLISH-Tage sind **nicht** Teil der Primärtest-Population (nur zur Vollständigkeit der Kalenderreihe für die Block-Konstruktion relevant, siehe Abschnitt 6a) |

---

## 11. Baseline-Hierarchie

Die 7 in Phase 3 eingefrorenen Baselines bleiben **unverändert**. Klarstellung der Hierarchie:

| Baseline | Rolle |
|---|---|
| 1. Always-Bearish (53,5%) | **PRIMARY** — alleinige Baseline des Primärtests (Abschnitt 10) |
| 2. Always-Bullish (46,5%) | Sekundär/explorativ — eigener Vergleich, nicht Teil des Primärtests (VALIDATION historisch 0 BULLISH-Beobachtungen, siehe Phase 2/6) |
| 3. Always-Neutral | Sekundär/explorativ |
| 4. Random Classifier | Sekundär/explorativ |
| 5. Simple Momentum | Sekundär/explorativ |
| 6. Simple Trend/MA | Sekundär/explorativ |
| 7. Best Single-Factor (=Momentum) | Sekundär/explorativ (identisch zu 5) |

Baselines 2–7 sind **Confirmatory-Sekundärtests** (nicht rein exploratorisch im Sinne von „ungeplant") — sie sind vorab definiert (Phase 3, Abschnitt 12), unterliegen aber der Multiple-Testing-Korrektur (Benjamini-Hochberg, Phase 3 Abschnitt 7) als Teil der Sekundärtest-Familie, da sie nicht die eine, vorab als „primär" ausgezeichnete Hypothese sind. Keine neue Baseline hinzugefügt, keine entfernt.

---

## 12. Effect-Size-Definition

| Ebene | Definition | Status |
|---|---|---|
| Statistische Signifikanz | p<α (0,05) nach MBB-basierter Inferenz | Testergebnis, sagt nichts über Größe |
| Statistische Power | P(Ablehnung von H0 \| wahrer Effekt = δ), siehe Tabellen Abschnitt 7 | abhängig von N und δ |
| Beobachtete Effektgröße | tatsächlich gemessene Hit-Rate-Differenz im Future-Research-Window | erst nach Datenerhebung bekannt |
| Praktisch relevante Effektgröße (MPRE) | Diskussionsvorschlag **+5pp**, unverändert aus Phase 3 übernommen | **weiterhin nicht final bestätigt** |
| Ökonomische Relevanz | Kosten-/Gebühren-/Slippage-bereinigter Vorteil | **nicht quantifiziert**, außerhalb des Scopes |

**Ausdrücklich, wie gefordert:** *„Die +5pp-Diskussionsgröße ist keine implementierte Entscheidungsschwelle und kein nachträglich optimierter Erfolgs-Threshold."* Sie wurde vor jeder Sichtung von Future-Window-Daten benannt und bleibt ein offener Diskussionspunkt für Toby (Abschnitt 15), keine in irgendeinem Gate technisch wirksame Zahl.

---

## 13. Decision Gates (aktualisiert)

Gate 1 (Data Sufficiency) wird präzisiert — die übrigen 6 Gates aus Phase 3 bleiben inhaltlich unverändert, hier nicht wiederholt:

**Gate 1 — Data Sufficiency (korrigiert):**

Eine reine Zahl wie „RAW N≥200" ist **keine** automatische Freigabe. Gate 1 gilt erst als erfüllt, wenn **alle vier** Teilbedingungen erfüllt sind:

| Teilbedingung | Kriterium |
|---|---|
| (a) ausreichendes RAW N | RAW N ≥ Ziel-Datenmenge (informativ, aber allein nicht hinreichend) |
| (b) ausreichendes BEARISH N | BEARISH RAW N ≥ Ziel-konditionierte Datenmenge (Abschnitt 7) |
| (c) ausreichendes Effective N | BEARISH-Effective-N ≥ die für die gewählte Effektgröße benötigte Größe (Abschnitt 8) |
| (d) ausreichende Power | vorab-berechnete Power für die gewählte Effektgröße ≥ 80% unter der zum Zeitpunkt der Prüfung aktuellen empirischen BEARISH-Rate |

Erst wenn (a)–(d) gemeinsam erfüllt sind: Gate 1 = JA. Andernfalls: `CONTINUE DATA ACCUMULATION`, wie in Phase 3 vorgesehen — **keine** Modelländerung.

---

## 14. Was gegenüber Phase 3 jetzt als überholt gilt

- Abschnitt 4.5 (Phase 3): „Erwartete Kennzahlen je Szenario" — **überholt**, ersetzt durch Abschnitt 7/9 dieses Dokuments.
- Abschnitt 5.1/5.2 (Phase 3): Power-/MDE-Tabellen auf RAW-N-Basis — **überholt**, ersetzt durch Abschnitt 7/8.
- Abschnitt 5.3 (Phase 3): Bonferroni-Sensitivität bei n=200/300 (RAW N) — **überholt** in seiner konkreten Zahlenbasis, das zugrundeliegende Prinzip (BH bleibt primär, Bonferroni als Sensitivität) bleibt gültig.
- Abschnitt 7 (Phase 3): Szenario-Zeitpunkte als Auswertungsbereitschaft interpretiert — **überholt**, ersetzt durch Abschnitt 9.
- Die dortige Schlussfolgerung „Szenario C (~Ende März 2027) ist der erste sinnvolle Auswertungspunkt" — **explizit zurückgezogen**.

## Was unverändert gültig bleibt

- Primärer Horizont (168h), eingefroren in Phase 3 — unverändert.
- Die 7 Baselines (Definitionen) — unverändert, nur hierarchisiert (Abschnitt 11).
- α=0,05, zweiseitig — unverändert.
- BH als primäre Multiple-Testing-Korrektur für Sekundärtests — unverändert.
- Testset-Isolation und Gate-7-Logik — unverändert.
- Die `EFFECTIVE N ≈ RAW N/7`-Heuristik als *diagnostische* Näherung — bestätigt, jetzt mit expliziter Einschränkung (Abschnitt 6).
- Der passive `pg_cron`-Datensammelprozess — vollständig unverändert, nicht Gegenstand dieser Korrektur.

---

## 15. Verbleibende Unsicherheiten

- Das reale `τ` (Abhängigkeits-Inflationsfaktor) könnte über der idealisierten 7 liegen (Volatility Clustering, Regime-Persistenz) — nur mit realen Future-Window-Daten verifizierbar, nicht vorab.
- Die künftige BEARISH-Rate ist unbekannt; das Sensitivitätsband (25–50%) ist plausibel, aber nicht garantiert — falls sich Marktregime grundlegend ändern (z. B. lang anhaltender Bullenmarkt), könnte die tatsächliche Rate außerhalb dieses Bands liegen.
- Die MPRE (+5pp) ist weiterhin nicht von Toby bestätigt.
- CI-Methode (Perzentil vs. BCa) für den finalen Bootstrap-Test ist noch nicht endgültig gewählt (bewusst offengelassen bis zum tatsächlichen Analysezeitpunkt).
- Strategische Frage (keine statistische, hier nicht beantwortet): ob ein Zeithorizont von mehreren Jahren bis Jahrzehnten für eine adäquat gepowerte Auswertung akzeptabel ist, oder ob alternative Strategien (kürzere Horizonte mit mehr Rohdaten pro Kalendertag, sobald 4H/1H genug Historie haben — Phase 6 dokumentiert bereits 4H/43 Tage, 1H/12 Tage) in Betracht gezogen werden sollten. **Dies wird hier ausdrücklich nicht empfohlen oder entschieden** — reine Beobachtung zur Kenntnisnahme durch Toby.

---

## 16. Research-Integrity-Erklärung

Alle in diesem Dokument berichteten Zahlen sind live nachgerechnet (Python, Ein-Stichproben-z-Test-Formeln, Datumsarithmetik), nicht aus Phase 3 unbesehen übernommen. Kein Ergebnis wurde zugunsten einer optimistischeren Zeitplanung oder einer bequemeren Schlussfolgerung angepasst — im Gegenteil, die hier berichteten Zeithorizonte sind deutlich länger als in Phase 3 suggeriert, und das wird nicht relativiert. Aus der korrigierten Power-Analyse wird **keine** Empfehlung zur Architektur-, Feature- oder Modelländerung abgeleitet, auch wenn die Datenmenge langfristig nicht ausreichen sollte — das wäre eine unzulässige Vermischung von „das Protokoll korrigieren" und „die Engine bewerten". Research Integrity > Model Improvement.

---

## Vergleich Alt vs. Korrigiert

| Element | Phase 3 Original | Phase 3.1 Befund | Phase 3.2 Korrektur |
|---|---|---|---|
| Sample Size | RAW N (100/150/200/300, alle States) als Testgröße | Falsch — Primärtest ist BEARISH-konditioniert | Primärtest-N = BEARISH RAW N (RAW N × ~38%, Sensitivität 25–50%) |
| State Conditioning | Nicht explizit im Nenner umgesetzt | Konflation dokumentiert | Population explizit auf BEARISH beschränkt (Abschnitt 5/10) |
| 168h Overlap | Nur qualitativ beschrieben (Abschnitt 13), nicht in Power-Rechnung | τ=7 hergeleitet (unter iid-Annahme) | Als diagnostische Näherung übernommen, Einschränkung explizit dokumentiert; finale Inferenz via MBB statt naivem z-Test |
| Effective N | Nicht verwendet | RAW N/7 hergeleitet, nicht mit State-Konditionierung kombiniert | BEARISH-Effective-N = BEARISH RAW N/7 (beide Korrekturen kombiniert) |
| MDE bei RAW N=200 (alle States) | 9,8pp | 15,7–37,1pp (je nach Korrektur) | 37,1pp (empirische Rate, beide Korrekturen — Eff. N≈10,9) |
| Power bei RAW N=200, Effekt=13pp | 81,8% | stark reduziert (nicht final neu berechnet) | 12,2% (empirische Rate) |
| Zeitpunkt „ausreichend" bei n=200 | Ende März 2027 (als Auswertungsbereitschaft interpretiert) | zurückgewiesen, grobe Schätzung ~2032 für +13pp | RAW N=200 selbst: 24.03.2027 (nur Datenmenge). Adäquate Power für +13pp: ~Mai 2032 (empirische Rate); für +15pp: ~Dez 2030; für +10pp: ~Mai 2036; +8pp: ~Nov 2041; +5pp: nicht realistisch erreichbar |
| Primary Test | „168h, Model B, BEARISH-Hit-Rate vs. Baseline 53,5%" — Nenner unklar | Mehrdeutigkeit dokumentiert | Eindeutig: Population=BEARISH-only, Baseline=Always-Bearish 53,5% (kein Semantik-Konflikt gefunden), Statistik=Hit-Rate-Differenz, Inferenz=MBB |
| Bootstrap | Nur als „Kandidat" benannt | Block Bootstrap bestätigt geeignet, aber nicht final gewählt, „erzeugt keine Information" betont | Moving Block Bootstrap, L=14 Tage, geblockt auf VOLLER Kalenderreihe (neue methodische Präzisierung dieser Phase) |

---

## Evidence Classification

**A) FACT**
- Die Dreiecks-Autokorrelationsstruktur der 168h-Forward-Returns (τ=7 unter iid-Tagesrenditen-Annahme) ist mathematisch hergeleitet und korrekt.
- Die empirische BEARISH-Rate in TRAIN+VALIDATION beträgt 37,97% (71/187), live verifiziert.
- Bei RAW N=1000 (empirische Rate) bleibt die Power für +13pp bei 48,3% — unterhalb 80%.
- Für +5pp ist auch bei RAW N=1000 die Power einstellig (10,8%).
- Der passive `pg_cron`-Datensammelprozess läuft unverändert und ist von dieser Korrektur nicht betroffen.

**B) INFERENCE**
- Die tatsächliche BEARISH-Rate im Future-Research-Window wird plausibel im Bereich 25–50% liegen, ist aber nicht bekannt.
- Moving Block Bootstrap mit L=14 wird die Power/CI-Breite in der Größenordnung der EFFECTIVE-N-Näherung liefern — plausibel, aber nicht simuliert.
- Reale Autokorrelation der Tagesrenditen könnte τ über 7 hinaus treiben (Regime-Persistenz-Befunde aus Phase 6 als indirekte Stütze).

**C) HYPOTHESIS**
- Ob τ tatsächlich nahe 7 liegt oder deutlich höher — nur mit echten Future-Window-Daten überprüfbar.
- Ob die künftige BEARISH-Rate näher an 25%, 38% oder 50% liegt.
- Ob ein über Jahre laufendes Datensammelprogramm für +13pp/+15pp überhaupt praktisch verfolgt werden soll — eine strategische, keine statistische Frage.

---

## Final Decision

1. **Ist das korrigierte Research-Protokoll jetzt intern statistisch konsistent?** **JA.** Beide in Phase 3.1 nachgewiesenen Konflationsfehler sind behoben — Sample Size, Power und MDE basieren durchgehend auf derselben, korrekt definierten Größe (BEARISH-konditioniertes Effective N).
2. **Sind Power-/MDE-Berechnungen jetzt auf der richtigen Beobachtungseinheit aufgebaut?** **JA** — BEARISH RAW N als Grundlage, EFFECTIVE N als Inferenzbasis, explizit von RAW N (alle States) und NON-OVERLAPPING N unterschieden.
3. **Ist der Primärtest eindeutig definiert?** **JA** — Population, Horizon, Target, Baseline, Signifikanz, Multiple-Testing-Rahmen und Inferenzmethode sind vollständig spezifiziert (Abschnitt 10), keine verbleibende Mehrdeutigkeit in der Testdefinition selbst.
4. **Ist die Abhängigkeit der 168h-Labels angemessen berücksichtigt?** **JA, methodisch** — Moving Block Bootstrap mit begründeter Blockstruktur (L=14, auf voller Kalenderreihe) ist final festgelegt. **Empirisch offen** bleibt, ob τ≈7 die reale Abhängigkeit korrekt abbildet (Abschnitt 15) — dies ist keine Inkonsistenz, sondern eine dokumentierte, erst mit künftigen Daten auflösbare Unsicherheit.
5. **Gibt es noch einen statistischen BLOCKER vor einer zukünftigen konfirmatorischen Auswertung?** **NEIN, kein mathematischer/methodischer Blocker.** Das Protokoll ist jetzt korrekt spezifiziert und kann unverändert als Grundlage für weitere Datenakkumulation und eine spätere konfirmatorische Auswertung dienen. Es besteht jedoch eine **erhebliche, hier offen kommunizierte Diskrepanz zwischen den ursprünglich in Phase 3 suggerierten Zeithorizonten (Monate) und den tatsächlichen, in dieser Phase korrekt berechneten Zeithorizonten (Jahre bis Jahrzehnte)** — das ist kein Blocker im technischen Sinne, sondern eine strategische Information, die Toby zur Kenntnis vorgelegt wird, ohne dass hieraus eine Architektur-, Modell- oder Prioritäten-Entscheidung abgeleitet oder vorweggenommen wird.

**Es besteht KEIN „BLOCKER — REVIEW REQUIRED".**
