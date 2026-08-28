# Phase 3 — Power Build-Up & Pre-Registered Diagnostic Research Protocol

**STATUS: RESEARCH ONLY.** Keine Production-, Threshold-, Gewichts-, Feature- oder Testset-Änderung. Dieses Dokument ist eine **Pre-Registration** — es legt vor jeder zukünftigen Ergebnisanalyse fest, was, wie und wogegen getestet wird. Alle Zahlen in diesem Dokument sind live gegen die Datenbank verifiziert (Supabase Project `cpktesxmbqrzpsurntul`, Stand 28.08.2026), keine Schätzwerte aus dem Gedächtnis.

**Ausgangslage (Phase 0–2, eingefroren, hier nur referenziert):** Kein robuster Edge nachgewiesen (0/36 BH-signifikant). Größter Einzeleffekt TRAIN/168h/BEARISH +13,0pp, p=0,078 — nicht signifikant. H1 (Redundanz) SUPPORTED, H6 (Power) CONFIRMED als limitierender Faktor. Details: `PHASE-0-RECONCILIATION.md`, `PHASE-1-VALIDATION-INTEGRITY.md`, `PHASE-2-DIAGNOSTIC-RESEARCH.md`.

---

## 1. Ausgangslage

Siehe oben — vollständige Zusammenfassung von Phase 0–2 wie im Auftrag vorgegeben, unverändert übernommen, nicht neu bewertet. Keine der drei Phasen wird rückwirkend verändert.

---

## 2. Ziel von Phase 3

**Frage:** Welche statistische Evidenz könnten wir mit einer ausreichend großen, sauber definierten Research-Stichprobe tatsächlich über die bestehende Engine gewinnen, und welche Tests müssen dafür vorab festgelegt werden?

Phase 3 ist **Data Accumulation + Statistical Power Planning + Pre-Registration + Frozen Evaluation Protocol** — kein Implementierungs-, Kalibrierungs- oder Modellauswahlschritt.

---

## 3. Primäre Analyseeinheit

**Primärer Horizont: 168h / 7D.** Begründung (aus Phase 1/2, hier eingefroren): 24h zeigt keinen überzeugenden Engine-Vorteil (η² State→Forward-Return nur ≈0,08%, siehe Abschnitt 10), 720h/30D ist formal `NOT TESTABLE WITH CURRENT DATA` (Phase 1), 168h zeigt den einzigen auffälligen — wenn auch nicht signifikanten — Effekt und eine deutlich höhere State-Erklärkraft (η²≈4,3%, siehe Abschnitt 10).

**Diese Festlegung ist ab jetzt eingefroren** und darf nach Sichtung neuer Daten nicht mehr geändert werden. 24h und 720h bleiben sekundär/explorativ (siehe Abschnitt 7, 14).

---

## 4. Data Accumulation

### 4.1 Aktuelle Datenbasis (live verifiziert)

| Quelle | von | bis | n (Zeilen) |
|---|---|---|---|
| `market_features` (1D, BTCUSDT) | 19.12.2025 | 27.08.2026 | 252 |
| `backtest_states` (1D, `experimental_domain_v2_phase4_full_asof`) | 19.12.2025 | 26.08.2026 | 251 |

`backtest_states` wird automatisch über `pg_cron`-Job `backtest-reconstruct-1d-states-v2` (täglich 06:20 UTC) fortgeschrieben — **keine manuelle Aktion nötig, Wachstum ist bereits ein laufender, unbeaufsichtigter Prozess.** Wachstumsrate: **+1 Roh-Beobachtung/Tag** (1D-Intervall; 4H/1H wachsen schneller, sind aber laut Phase 6 für einen eigenen 3-Wege-Split zu kurz und bleiben außerhalb des primären Scopes).

### 4.2 168h-Beobachtungen, purged+embargoed (identische Methodik wie Phase 1), TRAIN+VALIDATION

| Split | State | n (raw) | n (post-purge) |
|---|---|---|---|
| TRAIN | BULLISH | 55 | 53 |
| TRAIN | BEARISH | 46 | 46 |
| TRAIN | MIXED | 40 | 39 |
| TRAIN | NEUTRAL | 10 | 6 |
| VALIDATION | BULLISH | 0 | 0 |
| VALIDATION | BEARISH | 27 | 25 |
| VALIDATION | MIXED | 23 | 18 |

**Direktionale Zellen (BULLISH+BEARISH, die für die primäre Hit-Rate-Auswertung relevant sind): n=124 gesamt** (TRAIN 99, VALIDATION 25 — VALIDATION hat strukturell keine BULLISH-Beobachtungen, siehe Phase 2/6). Empirische Baseline-Hit-Rate bei 168h (TRAIN+VALIDATION, n=187 aller States): 46,5% Aufwärtsbewegung, 53,5% Abwärtsbewegung.

### 4.3 Zentrale methodische Klarstellung — warum "Data Accumulation" nicht einfach Warten bedeutet

TRAIN (19.12.2025–18.05.2026) und VALIDATION (19.05.–07.07.2026) sind **historisch abgeschlossene, bereits vollständig vorliegende Kalenderfenster** — ihr n wächst nicht durch Zeitablauf. Zusätzlich wurden beide Splits bereits in Phase 0–2 explorativ verwendet (Diagnostik, keine Zielwert-Optimierung, aber dennoch "gesehen") — sie sind für einen sauberen, pre-registrierten **Confirmatory Test** nicht mehr "unberührt". TEST (08.07.–26.08.2026) bleibt gemäß Vorgabe vollständig gesperrt (Gate 7, Abschnitt 15).

**Die tatsächliche Data-Accumulation-Quelle für Phase 3 ist daher ausschließlich neu, fortlaufend ab heute (28.08.2026) gesammeltes Material** — ein noch nicht existierendes, noch nicht diagnostisch betrachtetes "Future Research Window", das mit derselben Purge/Embargo-Disziplin wie TRAIN/VALIDATION/TEST behandelt wird und nach Erreichen der Zielgröße selbst zu einem gesperrten Evaluationsdatensatz wird (siehe Gate 7).

### 4.4 Zielgrößen-Szenarien (Future Research Window, ab 28.08.2026)

Bei ~1 gültiger 168h-Beobachtung/Kalendertag (nach initialem 8-Tage-Versatz durch Horizont+Embargo):

| Szenario | Ziel-n (gesamt) | benötigte Kalendertage ab heute | ungefähres Datum |
|---|---|---|---|
| A | 100 | ~108 | Mitte Dezember 2026 |
| B | 150 | ~158 | Anfang Februar 2027 |
| C | 200 | ~208 | Ende März 2027 |
| D | 300 | ~308 | Ende Juni 2027 |

### 4.5 Erwartete Kennzahlen je Szenario (primärer Test: BEARISH-Hit-Rate vs. Baseline 53,5%, zweiseitig, α=0,05 — Herleitung siehe Abschnitt 5)

| Szenario | n | MDE (80% Power) | 95%-CI-Breite (±) bei p̂≈0,535 | Power bei beobachtetem Phase-1-Effekt (13pp) |
|---|---|---|---|---|
| Aktuell (n=187, bereits "gesehen") | 187 | ~10,3pp | ±7,1pp | 95,5% |
| A (n=100) | 100 | ~14,0pp | ±9,8pp | 75,3% |
| B (n=150) | 150 | ~11,4pp | ±8,0pp | 90,4% |
| C (n=200) | 200 | ~9,9pp | ±6,9pp | 96,6% |
| D (n=300) | 300 | ~8,1pp | ±5,6pp | 99,7% |

**Interpretation, explizit vorsichtig formuliert (wie vorgegeben):** Diese n-Werte garantieren NICHT automatisch ein signifikantes Ergebnis. Die tatsächliche Power hängt zusätzlich ab von: der tatsächlichen (unbekannten) Baseline zum Zeitpunkt der neuen Datenerhebung, der tatsächlichen Effektgröße (falls überhaupt vorhanden), der State-Häufigkeit (insbesondere ob BULLISH künftig überhaupt auftritt — im aktuellen Fenster strukturell nie, siehe Phase 2/6), der Abhängigkeitsstruktur (Abschnitt 13) und der finalen Multiple-Testing-Korrektur (Abschnitt 7). Szenario C (n=200, ~Ende März 2027) ist der erste Punkt, an dem die MDE (~9,9pp) unter den bisher größten beobachteten (nicht-signifikanten) Effekt (13,0pp) fällt — ein sinnvoller, aber nicht garantierter Richtwert.

---

## 5. Power Analysis

**Primäre Baseline (aus dem bestehenden Research-Protokoll, nicht frei erfunden):** empirische Always-Bearish-Hit-Rate bei 168h, TRAIN+VALIDATION, purged+embargoed, n=187: **53,5%**. Dies ist exakt dieselbe Baseline-Definition wie im Ein-Stichproben-Anteils-z-Test aus Phase 1 (`research_bh_fdr()`, H0: hit_rate=baseline_hit_rate). Zweiseitiger Test, α=0,05, konsistent mit Phase 1 (keine nachträgliche Umstellung auf einseitig, um künstlich Power zu gewinnen).

**Sekundäre Baseline:** Always-Bullish-Hit-Rate = 46,5% (für eine mögliche zukünftige BULLISH-Zelle, aktuell strukturell nicht besetzt).

### 5.1 Benötigtes n für 80% Power, nach Effektgröße

| Effekt | n benötigt (α=0,05, zweiseitig) |
|---|---|
| +3pp | 2.162 |
| +5pp | 776 |
| +8pp | 301 |
| +10pp | 192 |
| +13pp | 112 |
| +15pp | 84 |

### 5.2 Power-Tabelle (Zeilen = n, Spalten = Effektgröße), α=0,05 zweiseitig, unkorrigiert

| n | +3pp | +5pp | +8pp | +10pp | +13pp | +15pp |
|---|---|---|---|---|---|---|
| 46 (aktuell TRAIN/BEARISH) | 6,8% | 10,1% | 18,7% | 26,7% | 42,0% | 53,4% |
| 73 (aktuell 24h/BEARISH) | 7,9% | 13,4% | 27,3% | 39,9% | 61,1% | 74,4% |
| 100 (Szenario A) | 9,1% | 16,8% | 35,8% | 51,9% | 75,3% | 87,0% |
| 124 (aktuell, alle direktionalen 168h) | 10,1% | 19,7% | 42,9% | 61,1% | 84,0% | 93,2% |
| 150 (Szenario B) | 11,3% | 23,0% | 50,2% | 69,6% | 90,4% | 96,8% |
| 187 (aktuell, alle States 168h) | 12,9% | 27,6% | 59,5% | 79,1% | 95,5% | 99,0% |
| 200 (Szenario C) | 13,5% | 29,2% | 62,4% | 81,8% | 96,6% | 99,3% |
| 300 (Szenario D) | 17,9% | 41,1% | 79,9% | 94,1% | 99,7% | 100,0% |

**Einordnung:** Selbst bei n=300 bleibt Power für kleine Effekte (+3pp, +5pp) niedrig (18–41%) — solche kleinen Effekte sind mit realistisch erreichbaren Stichprobengrößen in diesem Projekt praktisch nicht zuverlässig nachweisbar. Für den bisher einzigen auffälligen Effekt (+13pp) wird 80%-Power bereits bei n≈112 erreicht — knapp über der aktuellen TRAIN-Zellgröße (n=46), aber weit unter den bereits vorliegenden 187 (allerdings "verbraucht").

### 5.3 Multiple-Testing-Sensitivität (Vorschau auf Abschnitt 7)

| Korrektur | effektives α | Power bei n=200, Effekt=13pp |
|---|---|---|
| unkorrigiert (m=1, nur Primärtest) | 0,0500 | 96,6% |
| Bonferroni, m=6 (Sekundärtests) | 0,0083 | 86,6% |
| Bonferroni, m=12 | 0,0042 | 80,7% |

Der Primärtest selbst (168h BEARISH vs. Baseline) ist als **einzelner, vorab benannter Test** nicht multiple-testing-pflichtig — Korrektur betrifft ausschließlich die Familie der Sekundär-/explorativen Tests (Abschnitt 7).

---

## 6. Effect Size vor Signifikanz

Klare Trennung von drei Ebenen:

1. **Statistische Signifikanz** — p<α nach Korrektur (Abschnitt 7). Sagt nichts über Größe oder Relevanz aus.
2. **Praktische Signifikanz** — Effektgröße groß genug, um nicht allein durch Messrauschen/Schätzunsicherheit erklärbar zu sein (CI schließt praktisch relevante Nullbereiche aus).
3. **Ökonomische Relevanz** — Effektgröße groß genug, um nach Abzug realistischer Handelskosten (Fees, Slippage, Funding) noch einen Vorteil zu bieten. **Ausdrücklich NICHT in Phase 3 quantifiziert** — keine Trading-, TP/SL-, Gebühren- oder Positionsgrößenoptimierung.

### 6.1 Metrik-Rahmen (definiert, nicht optimiert)

| Metrik | Definition | Zweck |
|---|---|---|
| Hit-Rate Difference | Modell-Hit-Rate − Baseline-Hit-Rate | Primäre Testgröße (konsistent mit Phase 1) |
| Conditional Forward Return | Mittlerer Forward Return bedingt auf State, siehe η²-Analyse Abschnitt 10 | Sekundär, Informationsgehalt-Diagnostik |
| Baseline-adjusted Return | Conditional Forward Return − Baseline-Return (Always-X) | Sekundär, ökonomische Grobeinordnung ohne Kostenmodell |
| Sharpe/risikoadjustiert | **Nur konzeptionell benannt, nicht berechnet** — würde Positionsgrößen-/Haltedauerannahmen erfordern, die außerhalb des Phase-3-Scopes liegen | Explizit als zukünftiger, nicht in Phase 3 durchgeführter Schritt dokumentiert |

### 6.2 Minimum Practically Relevant Effect (MPRE) — Platzhalter, NICHT final

Ein fixer MPRE-Schwellenwert wird hier **bewusst nicht endgültig festgelegt**, um keinen unbegründeten Magic-Number-Threshold einzuführen (Projektgrundsatz: keine Schwellenwerte ohne dokumentierte Rationale). Kandidat zur Diskussion mit dem Projekteigner vor Sperrung: **+5pp Hit-Rate-Vorteil** — Begründung: bei einer Baseline von 53,5% entspräche das einer relativen Verbesserung von >9% gegenüber der Baseline und >10% gegenüber reinem Zufall (50%), eine Größenordnung, die in der technischen-Analyse-Literatur typischerweise als unterste Grenze für ökonomische Relevanz vor Kostenabzug gilt. **Dieser Wert ist ausdrücklich ein Diskussionsvorschlag, kein gesperrter Wert** — er muss vor Beginn der eigentlichen konfirmatorischen Auswertung (nicht rückwirkend nach Sichtung neuer Daten) von Toby bestätigt oder korrigiert werden.

---

## 7. Multiple Testing Protocol

| Kategorie | Test |
|---|---|
| **Primär (1 Test)** | 168h, Model B (`domain_balanced_v1`), BEARISH-Hit-Rate vs. Baseline 53,5%, TRAIN+VALIDATION+neues Future-Research-Window kombiniert nach Erreichen der Zielgröße |
| **Sekundär/explorativ (geplant, Anzahl vorab benannt)** | 24h (1), 720h falls testbar (1), BULLISH-Richtung 168h falls Daten vorliegen (1), Model C (1), Model D (1), Regime-stratifizierte 168h-Zellen (Trend/Volatilität, siehe Abschnitt 11, geschätzt 4-6 Zellen) → **m≈9–11 Sekundärtests** |

**Primäres Signifikanzniveau:** α=0,05, zweiseitig, unkorrigiert für den Primärtest (keine Multiplizität bei genau einer vorab benannten Primärhypothese).

**Korrekturverfahren für Sekundärtests:** **Benjamini-Hochberg (FDR)** bleibt primäres Korrekturverfahren — Konsistenz mit Phase 1 (`research_bh_fdr()`), keine Methodenumstellung ohne Grund. Bonferroni/Holm werden **konzeptionell als konservativere Alternative dokumentiert** (siehe Abschnitt 5.3) und zur Sensitivitätsprüfung mitgeführt, wie bereits in Phase 1 etabliert — dort lieferten beide Verfahren identische Ergebnisse (0/36), da der kleinste p-Wert bereits den nachsichtigeren BH-kritischen Wert um mehr als das 18-Fache verfehlte. Permutations-/simulationsbasierte FWER/FDR-Verfahren werden als mögliche zukünftige Erweiterung benannt (relevant bei starker Abhängigkeit, siehe Abschnitt 13), aber nicht implementiert.

**Festlegung:** Die Wahl des Korrekturverfahrens erfolgt **jetzt, vor Sichtung neuer Ergebnisse**, nicht danach.

---

## 8. Factor Redundancy — H1 (Operationalisierung für zukünftige Tests)

Referenz: Phase 2 (`PHASE-2-DIAGNOSTIC-RESEARCH.md`, Abschnitt 3) — live neu berechnete vollständige 6×6-Korrelationsmatrix und PCA, TRAIN+VALIDATION, n=201.

| Kennzahl | Wert |
|---|---|
| Kaiser-Kriterium (Eigenwert>1) | 2 von 6 Komponenten |
| Participation Ratio (effektive Dimensionalität) | 2,857 |
| PC1 (erklärte Varianz) | 52,5% — generischer Momentum/Trend-Verbund (rsi, macd, vwap, cvd) |
| PC2 (erklärte Varianz) | 22,1% — ADX (Trendstärke) vs. EMA-Spread (Trendrichtung) |
| PC3 (erklärte Varianz) | 12,6% — CVD-dominiert |
| Stärkste Einzelpaare | rsi↔vwap_pct_diff r=0,921; macd↔vwap_pct_diff r=0,829 |

### 8.1 Drei-Ebenen-Redundanzrahmen (wie gefordert)

**A. Statistische Redundanz** — Faktoren korrelieren. **Vollständig geprüft** (Korrelationsmatrix + PCA oben). Ergebnis: hohe statistische Redundanz nachgewiesen.

**B. Funktionale Redundanz** — Faktoren erzeugen ähnliche Marktinformationen. **Qualitativ geprüft** über PC-Ladungsmuster: PC1 bündelt Preis-Momentum-artige Signale (rsi/macd/vwap/cvd), PC2 trennt Trendstärke von Trendrichtung. Konsistent mit der ökonomischen Erwartung, dass alle 6 Faktoren letztlich Transformationen derselben zugrundeliegenden Preisreihe sind (bereits in Phase 6 dokumentiert).

**C. Predictive Redundancy** — entfernt man gedanklich einen Faktor, entsteht kein zusätzlicher erklärter Informationsgehalt. **NOT TESTABLE IN PHASE 3.** Eine saubere Prüfung würde einen kontrollierten Leave-one-factor-out-Vergleich benötigen — das ist strukturell eine neue Modellvariante und damit durch das Verbot in Abschnitt 16 ausgeschlossen. C wird hier nur benannt, nicht durchgeführt; eine zukünftige Prüfung erfordert einen expliziten neuen Auftrag außerhalb von Phase 3.

**Klarstellung wie gefordert:** Der Redundanzbefund ist ein struktureller Befund, **kein Beweis**, dass Redundanz die Prognoseleistung tatsächlich verschlechtert. Keine Faktor-Entfernung, keine Gewichtsänderung wird hieraus abgeleitet.

---

## 9. Horizon Alignment — H3

| Faktor/-gruppe | natürlicher Informationshorizont | verwendeter Lookback | Ziel-Horizont(e) geprüft |
|---|---|---|---|
| `structure` (Swing-Struktur) | kurz- bis mittelfristig (Tage) | aktuelle Kerze | 24h/168h/720h |
| `momentum` (RSI+MACD) | kurzfristig (Stunden–Tage), RSI-14/MACD-Standardparameter | 14 Perioden (RSI), 12/26/9 (MACD) | 24h/168h/720h |
| `cvd` (Order-Flow) | sehr kurzfristig, praktisch memoryless (Phase 6: AC Lag-1=0,139) | aktuelle Kerze | 24h/168h/720h |
| `trend_strength` (ADX) | mittelfristig, stark persistent (Phase 6: AC Lag-1=0,994) | 14 Perioden | 24h/168h/720h |
| `trend_regime` (EMA50/200) | mittel- bis langfristig, extrem persistent (Phase 6: AC Lag-1=0,999) | 50/200 Perioden | 24h/168h/720h |
| `vwap_position` | kurzfristig (Intraday-Bias) | laufender VWAP | 24h/168h/720h |
| *(8 datenarme Faktoren)* | funding/positioning: sehr kurzfristig; macro/sentiment: mittel-/langfristig; options/basis: kurz-mittelfristig | — | 0% Coverage, `INSUFFICIENT_DATA` |

**Diagnostischer Befund (aus Abschnitt 10):** State→Forward-Return-Erklärkraft (η²) steigt von 24h (0,08%) auf 168h (4,3%) deutlich an — konsistent mit einem strukturellen Mismatch zwischen den überwiegend mittelfristig-persistenten Faktoren (ADX, EMA-Spread) und dem sehr kurzfristigen 24h-Zielhorizont. Dies ist **plausibel, nicht bewiesen** — keine Feature-, Lookback- oder Horizontänderung wird vorgenommen.

**Ziel erreicht wie gefordert:** nur Feststellung eines möglichen strukturellen Horizon-Mismatch, keine Korrektur.

---

## 10. Target Information Loss — H2

**Neue Kennzahl in Phase 3: Eta-Quadrat (η²) — Anteil der Forward-Return-Varianz, der durch die 4-State-Zugehörigkeit (BULLISH/BEARISH/MIXED/NEUTRAL) erklärt wird**, Model B, TRAIN+VALIDATION, purged+embargoed:

| Horizont | n | η² (State erklärt Varianz von Forward Return) |
|---|---|---|
| 24h | 199 | **≈0,08%** |
| 168h | 187 | **≈4,33%** |

**Einordnung:** Bei 24h trägt die diskrete State-Klassifikation praktisch keine erklärende Information über den kontinuierlichen Forward-Return — bei 168h ist der Anteil deutlich höher, aber immer noch klein (>95% der Varianz bleibt unerklärt). Das ist ein **quantifizierter Beleg für Informationsverlust durch die Diskretisierung**, zusätzlich zur bereits in Phase 2 dokumentierten Streuungsasymmetrie (BEARISH-StdDev 3,17% vs. BULLISH 1,82% bei 24h).

Die NEUTRAL-Kernfrage (Marktindifferenz vs. fehlende Evidenz) bleibt **NOT TESTABLE** — n=9 bei 24h, n=6 bei 168h (TRAIN), 0 bei VALIDATION/168h. Kein neues Target, keine neue Modellvariante wird vorgeschlagen.

---

## 11. Regime Dependence — H4

Verwendet ausschließlich die bereits in Phase 2 definierten, einfachen Research-Regime (keine neue Regime-Engine):

| Regime-Typ | Definition | Quelle |
|---|---|---|
| Trend | `adx_14≥20` (trending) vs. `<20` (non-trending) — bestehende Produktionskonstante `ADX_TREND_THRESHOLD=20` | Phase 2 |
| Preis-Trend | 30-Tage-Preisvergleich (Bull-/Bear-Regime) | Phase 2 |
| Volatilität | **noch nicht in Phase 2 geprüft** — für Phase 3 als dritte Kategorie vorgemerkt, Definitionsvorschlag: Median-Split der 30-Tage-realisierten Volatilität (Rolling-StdDev der Tagesrenditen), analog einfach und nicht-optimiert | neu benannt, nicht berechnet (siehe unten) |

**Mindest-n-Gate (neu, verbindlich für alle zukünftigen Regime-Auswertungen):** eine Regime-Zelle gilt erst ab **n≥30** je Zelle als potenziell interpretierbar (Faustregel für halbwegs stabile Anteilsschätzung), ab **n≥50** als für eine reguläre Signifikanzprüfung geeignet. Unterhalb von n=30: **automatisch `NOT TESTABLE`**, keine Um-Etikettierung von "suggestive" zu "confirmed" unabhängig vom beobachteten p-Wert.

Angewandt auf die aus Phase 2 bekannten Zellen: ADX non-trending (n=17) und trending (n=38) BULLISH-Zellen liegen **beide unter n=50**, die non-trending-Zelle sogar unter n=30 → **NOT TESTABLE** nach diesem Gate (strenger als die bisherige Einstufung "UNDERPOWERED" in Phase 2 — Phase 3 verschärft die Kennzeichnung bewusst für die Pre-Registration). Eine Volatilitäts-Regime-Auswertung wird in Phase 3 nicht durchgeführt (keine ausreichenden Zellen zu erwarten bei aktuellem n) und bleibt für das Future-Research-Window vorgemerkt.

---

## 12. Baseline Protocol — H5 (eingefroren)

| # | Baseline | Definition | Input | Horizont | Signalregel | Metrik |
|---|---|---|---|---|---|---|
| 1 | Always Bullish | konstant BULLISH | — | alle | immer BULLISH | Hit-Rate vs. tatsächliche Richtung |
| 2 | Always Bearish | konstant BEARISH | — | alle | immer BEARISH | Hit-Rate |
| 3 | Always Neutral | konstant NEUTRAL | — | alle | immer NEUTRAL | keine gerichtete Hit-Rate (Referenzpunkt 50%) |
| 4 | Random classifier | Bernoulli(p=0,5), fixer Seed vorab dokumentiert bei Ausführung | Zufallszahl | alle | 50/50 BULLISH/BEARISH | Hit-Rate, Vergleichsverteilung |
| 5 | Simple Momentum | `momentum`-Faktor allein (RSI-14>55 UND MACD-Hist>0 → BULLISH; RSI-14<45 UND MACD-Hist<0 → BEARISH; sonst NEUTRAL) | `market_features.rsi_14`, `.macd_histogram` | alle | wie Produktions-Faktor-Definition | Hit-Rate |
| 6 | Simple Trend/MA-Regime | `trend_regime`-Faktor allein (`close>ema_50>ema_200`→BULLISH; `close<ema_50<ema_200`→BEARISH; sonst NEUTRAL) | `market_features.ema_50`, `.ema_200`, `.close_price` | alle | wie Produktions-Faktor-Definition | Hit-Rate |
| 7 | Best Single-Factor Baseline | **eingefroren auf `momentum` (Baseline 5)** | — | alle | identisch zu 5 | Hit-Rate |

**Begründung Baseline 7 (vorab, nicht ergebnisgetrieben):** Momentum (RSI+MACD-Kombination) ist der in der technischen Analyse am häufigsten verwendete generische Einzelindikator-Baseline-Typ — unabhängig davon, dass er in der explorativen Phase-2-Auswertung numerisch (nicht signifikant) am besten abschnitt. Diese Übereinstimmung ist **Zufall/Vorwissen, nicht Bestätigung** — die Festlegung erfolgt hier, vor jeder neuen Datenerhebung, und wird nicht mehr geändert, auch falls ein anderer Einzelfaktor in zukünftigen Daten numerisch besser abschneidet.

**Verbindliche Regel:** Kein Baseline-Wert wird nach Sichtung neuer Ergebnisse angepasst oder neu ausgewählt. Die 14-Faktor-Engine (Model B `domain_balanced_v1`, sowie zur Vollständigkeit Model A/C/D) tritt im primären Test gegen **alle 7 Baselines** an, nicht nur gegen 50%-Zufall.

---

## 13. Dependence / Effective Sample Size

168h-Labels sind bei täglicher Sampling-Frequenz strukturell überlappend — jede Beobachtung teilt 6 von 7 Tagen ihres Forward-Fensters mit der vorherigen (MA(6)-artige Abhängigkeitsstruktur), bereits in Phase 0 mathematisch hergeleitet und in Phase 1 empirisch bestätigt.

| Kennzahl | Wert | Quelle |
|---|---|---|
| Raw n (168h, TRAIN+VALIDATION, direktional) | 124 | Abschnitt 4.2 |
| Naive Effective-n-Heuristik (n/7) | ≈18 | Phase 0, Effective-Sample-Size-Korrektur |
| Empirisch bestätigtes Non-Overlap-n (jede 7. Zeile) | 4–10 | Phase 1, `research_evaluate_nonoverlap_7d()` |

**Klarstellung wie gefordert:** raw n ≠ effective n. Beide Werte werden durchgehend gemeinsam berichtet, nie nur raw n.

**Dokumentierte, nicht implementierte Alternativverfahren** (für den Fall, dass klassische unabhängige Tests bei größerem n weiterhin ungeeignet bleiben):

| Verfahren | Eignung |
|---|---|
| Block Bootstrap | geeignet bei bekannter, stabiler Abhängigkeitslänge (hier: 7 Tage) |
| Stationary Bootstrap | geeignet bei unsicherer/variabler Abhängigkeitslänge |
| Permutationsverfahren | geeignet für exakte p-Werte bei kleinem n, rechnerisch aufwendiger |
| HAC/Newey-West | geeignet für Regressions-/Zeitreihenkontext, weniger direkt für einfache Anteilstests |

**Festlegung:** Keine Methode wird jetzt final ausgewählt — die Wahl erfolgt vor der eigentlichen konfirmatorischen Auswertung, nicht danach, und nicht ergebnisabhängig. Block Bootstrap ist aufgrund der bekannten, stabilen 7-Tage-Abhängigkeitsstruktur der naheliegendste Kandidat, wird hier aber nur als solcher benannt, nicht gewählt.

---

## 14. Pre-Registration Document (Kernfestlegungen)

| Feld | Festlegung |
|---|---|
| **Primary Question** | Hat die bestehende Market-State-Engine (Model B, `domain_balanced_v1`) bei 168h einen robusten predictive edge gegenüber den eingefrorenen Baselines (Abschnitt 12)? |
| **Primary Target** | 168h Forward-Return-Richtung, bestehende State-Evaluation (BULLISH/BEARISH-Hit-Rate) |
| **Primary Metric** | Hit-Rate Difference (Modell − Baseline 1: Always-Bearish, 53,5%), siehe Abschnitt 6.1 |
| **Primary Baseline** | Always-Bearish, empirisch 53,5% (Abschnitt 5) |
| **Significance** | α=0,05, zweiseitig, Ein-Stichproben-Anteils-z-Test (konsistent mit Phase 1) |
| **Multiple Testing** | Primärtest unkorrigiert (m=1); Sekundärtests (m≈9–11) mit Benjamini-Hochberg, Bonferroni als dokumentierte Sensitivitätsprüfung (Abschnitt 7) |
| **Minimum Effect** | Diskussionsvorschlag +5pp (MPRE, Abschnitt 6.2) — **noch nicht final bestätigt** |
| **Minimum Sample** | Power-basiert: n≥200 (Szenario C) empfohlen, damit MDE (~9,9pp) unter dem bisher größten beobachteten Effekt (13,0pp) liegt (Abschnitt 4.5, 5.1) |
| **Confidence Intervals** | 95%, Wald-Approximation (konsistent mit bisheriger Methodik), Erweiterung auf Wilson-Score als mögliche zukünftige Verfeinerung dokumentiert, nicht implementiert |
| **Dependence Treatment** | raw n und effective n immer gemeinsam berichten (Abschnitt 13); finale Korrekturmethode vor Auswertung festzulegen, Block Bootstrap wahrscheinlichster Kandidat |
| **Regime Analysis** | Secondary/exploratory, Mindest-n-Gate 30/50 (Abschnitt 11) |
| **24h/720h** | Secondary/exploratory |
| **Testset** | **LOCKED** |
| **Production** | **LOCKED** |
| **Model Parameters** | **LOCKED** (alle vier eingefrorenen Modelle unverändert) |

---

## 15. Decision Gates

| Gate | Frage | Bei NEIN |
|---|---|---|
| 1 — Data Sufficiency | Ist die erforderliche effektive Stichprobe erreicht (Zielgröße Abschnitt 4.4/4.5)? | CONTINUE DATA ACCUMULATION, keine Modelländerung |
| 2 — Validation Integrity | Sind Purging, Embargo, Leakage-Checks, Datenvollständigkeit, Label-Integrität sauber? | STOP |
| 3 — Baseline Comparison | Zeigt die Engine einen Vorteil gegenüber den eingefrorenen Baselines (Abschnitt 12)? | NO DEMONSTRATED ENGINE ADVANTAGE |
| 4 — Statistical Significance | Überlebt der primäre Effekt die vorab definierte Korrektur? | NO STATISTICAL EVIDENCE |
| 5 — Effect Size | Ist der Effekt praktisch relevant (MPRE, Abschnitt 6.2)? | STATISTICALLY INTERESTING BUT ECONOMICALLY WEAK |
| 6 — Robustness | Stabil über Zeitperioden, plausible Regime, angemessene Abhängigkeiten, kleine methodische Variationen? | FRAGILE SIGNAL |
| 7 — Testset | Erst nach Gates 1–6: Testset-Evaluation. Bis dahin: unangetastet. | TESTSET MUST REMAIN UNTOUCHED |

**Aktueller Stand aller Gates (Stand 28.08.2026, zur Transparenz, keine Vorwegnahme künftiger Ergebnisse):** Gate 1 = NEIN (Future-Research-Window noch bei n=0, siehe Abschnitt 4.3). Gate 2 = JA (Phase 1, 24/24 leakage=false). Gates 3–7 aktuell nicht auswertbar, da Gate 1 nicht erfüllt.

---

## 16. Was nicht gemacht werden darf

Absolut verboten in Phase 3 (unverändert aus dem Auftrag übernommen): Threshold-Tuning, Weight-Tuning, Feature-Selection, Feature-Engineering, Modell-Reweighting, neue Modellvarianten, Calibration-Tuning, Target-Tuning nach Ergebnis, Horizon-Tuning nach Ergebnis, Baseline-Tuning, Regime-Tuning, Testset-Evaluation, Production-Deployment, Änderung bestehender Production-Funktionen. Auch scheinbar kleine Verbesserungen sind verboten.

Alle in diesem Dokument berichteten SQL-Abfragen waren rein lesend (`SELECT`, `corr()`, `var_pop()`); keine neue Migration, Tabelle, Funktion oder Edge Function wurde für Phase 3 angelegt.

---

## 17. Erwartetes Deliverable

Ausschließlich `docs/research/PHASE-3-RESEARCH-PROTOCOL.md` (dieses Dokument). Keine neue Production-Tabelle, keine Migration, keine Edge Function, keine API-/UI-Änderung, keine Modelländerung.

---

## 18. Final Report — Drei Evidenzebenen

**A — FACT (durch vorhandene Daten belegt):**
- 168h zeigt deutlich höhere State→Forward-Return-Erklärkraft (η²≈4,33%) als 24h (η²≈0,08%).
- Effektive Faktordimensionalität ≈2,86 von 6 (Kaiser=2 Komponenten).
- Aktuelle 168h-Zellgrößen (n=46–73) liegen unter der für den bisher größten beobachteten Effekt (13pp) benötigten Stichprobe (n≈112) — teilweise knapp darüber (n=124 gesamt-direktional, n=187 alle States), aber bereits diagnostisch "verbraucht".
- Bonferroni und Benjamini-Hochberg liefern bei den Phase-1-Daten identisches Ergebnis (0/36).
- `backtest_states` wächst automatisch (+1/Tag, 1D) über einen bereits aktiven `pg_cron`-Job — keine zusätzliche Infrastruktur nötig.

**B — INFERENCE (plausible strukturelle Erklärung, nicht bewiesen):**
- Die höhere 168h-Erklärkraft ist plausibel auf einen Horizon-Mismatch zwischen mittelfristig-persistenten Faktoren (ADX, EMA-Spread) und dem kurzfristigen 24h-Ziel zurückzuführen.
- Faktor-Redundanz (H1) reduziert vermutlich die effektive Informationsmenge der additiven Aggregation, ohne dass dies bereits als Ursache für die fehlende Signifikanz nachgewiesen ist.

**C — HYPOTHESIS (erst mit größerem n testbar):**
- Ob der 168h/BEARISH-Effekt (+13pp) bei ausreichender Power (Szenario C/D) signifikant bleibt, sich verkleinert oder verschwindet.
- Ob eine BULLISH-168h-Zelle in zukünftigen, andersgearteten Marktphasen überhaupt in ausreichender Zahl auftritt.
- Ob Volatilitäts-Regime (noch nicht geprüft) eine belastbare Differenzierung liefern.
- Ob Predictive Redundancy (H1-C) bei voller 14-Faktor-Coverage ein anderes Bild zeigt als bei den aktuell 6 verfügbaren Faktoren.

---

## 19. Abschluss-Entscheidung

**OPTION 1 — DATA ACCUMULATION CONTINUES.**

Begründung: Gate 2 (Validation Integrity) ist erfüllt. Kein Befund aus Phase 0–3 belegt einen Architekturfehler, der eine Architekturüberprüfung (Option 3) oder Ablehnung der Engine (Option 4) rechtfertigen würde — H1 (Redundanz) ist ein struktureller, nicht notwendigerweise leistungsmindernder Befund (Abschnitt 8, explizit nicht als Beweis für Fehlleistung interpretiert). Die Diagnostik aus Phase 2 ist inhaltlich abgeschlossen genug, um einen präzisen, vorab festgelegten konfirmatorischen Test zu definieren (dieses Dokument) — eine weitere Diagnostikrunde vor Datensammlung (Option 2) ist nicht begründet, da die offenen Fragen (H2-Kern, H4-Regime, H1-C) explizit mehr Daten benötigen, nicht mehr Diagnostik an denselben Daten. Der limitierende Faktor ist durchgehend und eindeutig Stichprobengröße (H6, Abschnitt 5, 13) — das primäre Blockade ist Gate 1, nicht Gate 2–6.

**Nächster konkreter Schritt (kein Implementierungsschritt, reine Beobachtung):** `backtest_states` (1D) läuft automatisch weiter; frühestens bei Erreichen von Szenario C (n≈200, ca. Ende März 2027) sollte die primäre konfirmatorische 168h-Auswertung gemäß diesem eingefrorenen Protokoll durchgeführt werden. Vor diesem Zeitpunkt sind keine weiteren Änderungen an Baseline-, Metrik- oder Korrekturfestlegungen zulässig.

---

## 20. Stop Condition

**STOP.** Keine weiteren Änderungen, keine Implementierung, keine Threshold-/Gewichts-/Feature-/Production-Änderung, kein Zugriff auf das Testset. Warte auf einen neuen Auftrag.

**Kernprinzip (aus dem Auftrag, hier bestätigt eingehalten):** Phase 3 beweist nicht, dass Nexus-Atlas funktioniert. Phase 3 stellt sicher, dass bei ausreichender Datenbasis ehrlich entschieden werden kann, ob Nexus-Atlas funktioniert. Kein Ergebnis in diesem Dokument wurde zugunsten oder zulasten der Engine zurechtgebogen — Research Integrity vor Model Improvement.
