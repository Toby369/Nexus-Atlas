# Triple-Barrier-Backtest von Tobys realem Setup + MTF-Alignment-Filter — 2026-09-04

## 1. Fragestellung

Anlass: Toby beschreibt sein reales Setup (15m/5m-Einstiege, 1h/4h/1d zur Trendbestimmung,
20-40x Hebel, ~10 USDT Einsatz, SL max. 10%, TP 30%, oft 80% TP + 20% mit nachgezogenem SL
laufen lassen) und fragt konkret: **"kannst du backtesten, wo ich bei meinem setup, mit 20x
hebel, sl 10% und tp 30% einstiege gehabt hätte? und genau dann vor diesen die signale von
nexus recherchieren?"**

Anders als alle bisherigen Tests dieser Session (fester Vorwärts-Horizont, z.B. "Kurs nach
24h") bildet dies **Tobys tatsächlichen Trade-Mechanismus** ab: ein echter SL/TP-Trade mit
Hebel, nicht eine abstrakte Renditeerwartung.

## 2. Methodik (vorregistriert vor Ergebnis-Ansicht)

**Triple-Barrier-Methode** (López de Prado, "Advances in Financial Machine Learning") —
Standardverfahren für genau diesen Anwendungsfall: pro Einstiegspunkt werden ein oberer
(TP) und unterer (SL) Preis-Barrier sowie ein maximaler Haltezeitraum (vertikaler Barrier)
definiert; welcher zuerst berührt wird, entscheidet den Ausgang.

**Umrechnung von Tobys Setup:** SL 10% / TP 30% = % des Einsatzes/Margin bei 20x Hebel
→ **TP bei +1,5% Kursbewegung, SL bei -0,5%** (30%/20, 10%/20). Chance-Risiko-Verhältnis 3:1.

**Parameter:**
- Intervall: 15m (2 Jahre Historie, 2024-09-04 bis 2026-09-04)
- Long UND Short an **jeder** 15m-Kerze getestet (kein Filter in Phase 1)
- Entry = Open der nächsten Kerze nach dem Signal-Zeitpunkt (kein Lookahead)
- Max. Haltedauer 48h (192 Kerzen), danach "Timeout"
- Tie-Break bei gleichzeitiger TP/SL-Berührung in derselben Kerze: SL gewinnt (konservativ,
  gleiche Konvention wie die Directional-Change-Studie)
- Vereinfachung: volle Position bis TP/SL, Tobys Teil-Exit (80/20 mit Trailing-SL) NICHT
  mitmodelliert — das würde das Ergebnis eher verbessern, nicht verschlechtern

**Phase 2 — Kontext-Faktor (Tobys eigene Methodik):** `mtf_aligned` = 1h-, 4h- UND
1d-Struktur (`structure_trend` aus `market_features`) stimmen alle mit der Trade-Richtung
überein (für LONG: alle drei "bullish"; für SHORT: alle drei "bearish"). Punkt-in-Zeit-sicher:
nur die zuletzt VOLLSTÄNDIG abgeschlossene Kerze je Intervall zum Signal-Zeitpunkt.

**Splits:** identisch zum Rest der Session (train bis 2026-01-14, validation bis 2026-05-14,
test ab 2026-05-15 — bis zu diesem Zeitpunkt in dieser Session nie angeschaut).

## 3. Phase 1: Basisrate ohne jeden Filter

| Richtung | TP | SL | Timeout |
|---|---|---|---|
| LONG | 25,0% | 73,8% | 1,2% |
| SHORT | 24,6% | 74,7% | 0,8% |

Bei 3:1 CRV liegt die Gewinnschwelle exakt bei 25% — der reine Zufallswert trifft sie fast
exakt. Tobys TP/SL-Verhältnis ist also **realistisch kalibriert**, aber ungefiltert ist es
ein Nullsummenspiel (vor Gebühren/Funding).

## 4. Phase 2: MTF-Alignment-Filter

**Erste Auswertung (naiv, überlappende Labels):** p-Werte < 0,000001 in allen 4 Zellen
(Split × Richtung) — aber die 48h-Barrier bei 15-Minuten-Kerzenabstand erzeugt massiv
überlappende, autokorrelierte Labels. Solche p-Werte sind Artefakte, keine echten
Signifikanzaussagen (dasselbe Problem wie bei jedem bisherigen Test dieser Session, hier nur
extremer).

**Korrigierte Auswertung (max. 1 Signal pro 48h-Fenster, echte Unabhängigkeit angenähert):**

| Split | Richtung | n (aligned) | TP% (aligned) | n (nicht aligned) | TP% (nicht aligned) | Diff | p-Wert |
|---|---|---|---|---|---|---|---|
| Train | LONG | 95 | 33,7% | 244 | 23,0% | +10,7pp | 0,043 |
| Train | SHORT | 85 | 28,2% | 243 | 22,2% | +6,0pp | 0,262 |
| Validation | LONG | 29 | 31,0% | 55 | 23,6% | +7,4pp | 0,463 |
| Validation | SHORT | 23 | 30,4% | 57 | 21,1% | +9,4pp | 0,372 |
| **Test (vorher nie angesehen)** | LONG | 21 | 38,1% | 56 | 17,9% | +20,2pp | — |
| **Test (vorher nie angesehen)** | SHORT | 24 | 58,3% | 55 | 23,6% | +34,7pp | — |

Einzeln reicht die Power in keiner Zelle für Signifikanz nach Korrektur — aber die Richtung
ist **in allen 6 Zellen identisch** (aligned > nicht aligned), inkl. des zuvor nie
betrachteten Testzeitraums.

**Gepoolt über alle drei Zeiträume** (weiterhin nicht-überlappend, ~1 Signal/48h):

| Richtung | n (aligned) | TP% (aligned) | n (nicht aligned) | TP% (nicht aligned) | Diff | p-Wert |
|---|---|---|---|---|---|---|
| LONG | 150 | 33,3% | 358 | 22,1% | +11,3pp | 0,0078 |
| SHORT | 132 | 34,1% | 359 | 22,6% | +11,5pp | 0,0095 |
| **Kombiniert** | 282 | 33,7% | 717 | 22,3% | +11,4pp | **0,0002** |

Das übersteht eine BH-FDR-Korrektur über die hier getesteten Zellen deutlich.

## 5. Einordnung

- **Das ist das erste Ergebnis dieser Session, das SUPPORTED ist** — nicht "kein Edge
  nachgewiesen" wie bei jedem vorherigen Test. Konsistent über 3 unabhängige Zeiträume
  (inkl. Testset), beide Richtungen, überlebt die Korrektur für überlappende Labels.
- **Ökonomische Bedeutung:** bei 3:1 CRV verschiebt eine Trefferquote von ~25% (Baseline) auf
  ~34% (aligned) den Erwartungswert pro Trade von ~0 auf ca. +0,35R — potenziell wirklich
  profitabel, falls sich das hält.
- **Aber:** nach der nicht-überlappenden Bereinigung bleiben nur ~150-280 wirklich
  unabhängige Beobachtungen je Richtung über 2 Jahre — der Filter reduziert die
  Handelsfrequenz drastisch (ca. 1 qualifizierendes Signal alle 3-5 Tage je Richtung). Das
  passt zu "wenig Zeit", bedeutet aber auch: die Stichprobe ist klein genug, dass "SUPPORTED"
  richtig ist, "PROVEN" (im Sinne dieser Session) noch nicht gerechtfertigt wäre.
- **Nicht enthalten:** Trading-Gebühren, Funding-Kosten über die Haltedauer, Slippage, und
  Tobys echter Teil-Exit-Mechanismus (80% TP + 20% mit Trailing-SL) — letzterer würde das
  Ergebnis eher verbessern.
- **Statistischer Status: SUPPORTED**, dass MTF-Alignment (1h+4h+1d-Struktur stimmen mit der
  Trade-Richtung überein) die Trefferquote von Tobys 15m-Setup deutlich über die 25%-
  Gewinnschwelle hebt. NICHT PROVEN im strengen Sinne dieser Session (Stichprobe zu klein für
  die höchste Beweisstufe) — aber der erste Fund, der diese Einstufung überhaupt verdient.

## 5b. Nachtrag: 1h-Momentum-Zusatzfilter getestet und verworfen

Deskriptiv fiel auf (innerhalb der bereits `mtf_aligned=true`-Trades): bei TP-Ausgängen zeigte
das MACD-Histogramm der letzten 1h-Kerze deutlich häufiger in Trade-Richtung als bei
SL-Ausgängen (LONG 67-72% vs. 55-57%, SHORT 63-64% vs. 58-60%). Als zusätzlicher,
vorregistrierter Filter (`momentum_confirmed_1h`) mit derselben nicht-überlappenden
Methodik getestet:

| Richtung | TP% mit Momentum-Bestätigung | TP% ohne | Diff | p-Wert |
|---|---|---|---|---|
| LONG | 30,5% (n=141) | 39,7% (n=121) | -9,2pp | 0,12 |
| SHORT | 35,2% (n=122) | 37,7% (n=106) | -2,5pp | 0,70 |
| Kombiniert | 32,7% (n=263) | 38,8% (n=227) | -6,1pp | 0,16 |

**Der Effekt kehrt sich um und ist nicht signifikant.** Die ursprüngliche deskriptive
Beobachtung war ein Artefakt überlappender, autokorrelierter Kerzen (dieselbe
Kausalitätsfalle wie beim naiven MTF-Test in Abschnitt 4, hier aber nicht durch
Neuprüfung aufgelöst, sondern verschwunden). **Ergebnis: kein zusätzlicher Nutzen durch
einen 1h-Momentum-Filter oben auf dem Trend-Alignment-Filter — verworfen.** Der
Trend-Alignment-Filter (Abschnitt 4/5) bleibt der einzige Fund dieser Session, der die
volle Prüfung übersteht.

## 6. Für Nexus / für Toby

- Kein automatisches Handelssignal wird eingebaut — das bleibt eine bewusste Entscheidung.
- Konkret nachvollziehbar: bevor du auf 15m/5m einsteigst, prüfe ob 1h, 4h UND 1d alle
  dieselbe Richtung zeigen (in der App: `structure_trend` je Intervall, aktuell nicht direkt
  als eigene Kachel sichtbar — kann bei Bedarf ergänzt werden).
- Empfehlung: erst mit kleinerer Positionsgrösse/Paper-Trading beobachten, ob sich die ~34%
  Trefferquote in der Praxis (inkl. Gebühren) bestätigt, bevor die Positionsgrösse erhöht wird
  — die Stichprobe ist vielversprechend, aber noch nicht gross genug für volles Vertrauen.

Neue DB-Objekte: `research_triple_barrier_events()`, `research_triple_barrier_results`,
`research_build_triple_barrier_context()`, `research_triple_barrier_context`.

## 7. Vollfaktoren-Screen + Produktionsentscheidung (Nachtrag)

Auf Wunsch ("können wir alle Signale so durchtesten wie vorhin") alle 9 in
`research_triple_barrier_context` bereits verfügbaren Einzelfaktoren mit derselben
nicht-überlappenden Methodik getestet (gepoolt LONG+SHORT, Train+Validation+Test),
BH-FDR über alle 9 Kandidaten:

| Signal | n (Bedingung erfüllt) | TP% (erfüllt) | TP% (nicht erfüllt) | Diff | p-Wert | BH-Fazit |
|---|---|---|---|---|---|---|
| **Struktur 4h allein** | 543 | 32,8% | 17,9% | +14,8pp | <0,0001 | ✅ |
| Struktur 1h allein | 705 | 30,1% | 20,4% | +9,6pp | <0,0001 | ✅ |
| Struktur 15m allein | 732 | 29,4% | 20,8% | +8,6pp | 0,0001 | ✅ |
| Struktur 1h+4h+1d (Abschnitt 4) | 282 | 33,7% | 22,3% | +11,4pp | 0,0002 | ✅ |
| Struktur 1d allein | 369 | 26,8% | 22,1% | +4,7pp | 0,125 | ❌ |
| Trendstärke (ADX≥20 + DI-Richtung) | 732 | 24,0% | 26,1% | -2,0pp | 0,366 | ❌ |
| Momentum 1h (Abschnitt 5b) | 727 | 24,8% | 25,9% | -1,1pp | 0,629 | ❌ |
| CVD-Richtung (15m) | 732 | 25,4% | 24,9% | +0,5pp | 0,810 | ❌ |
| RSI-Richtung (15m, >50/<50) | 732 | 24,7% | 24,9% | -0,1pp | 0,952 | ❌ |

4 von 9 überleben die Korrektur — RSI, CVD, Trendstärke und 1h-Momentum bestätigen
sich erneut als nicht hilfreich (konsistent mit Abschnitt 5b und den Kerzenmuster-
Backtests). Die 4 signifikanten Struktur-Signale sind **nicht unabhängig**
voneinander (dieselbe zugrundeliegende Trendrichtung, nur auf verschiedenen
Zeitebenen gemessen) — das ist eine Erkenntnis, keine vier.

**"4h-Struktur allein" ist die stärkste Einzelvariante:** grösserer Effekt
(+14,8pp vs. +11,4pp) UND fast doppelt so viele qualifizierende Trades (543 vs.
282 nicht-überlappend) als die ursprüngliche 3-Timeframe-Regel, da sie
mathematisch eine schwächere (leichter erfüllbare) Bedingung ist, die die
3-fache Übereinstimmung als Teilmenge enthält. Für LONG und SHORT einzeln
symmetrisch bestätigt: 33,2%/18,2% (LONG) bzw. 32,3%/17,7% (SHORT), je
n=257-288.

**Produktionsentscheidung (auf Tobys Wunsch):** `lib/entryFilter.ts` nutzt jetzt
**"4h-Struktur allein"** statt der 3-Timeframe-Regel als Einstiegsfilter-Basis —
mehr qualifizierende Signale bei zugleich grösserem gemessenem Effekt. Weiterhin
derselbe bereits von `compute-market-state` berechnete Wert
(`mtf_alignment.timeframes["4h"]`), keine neue Berechnung.
