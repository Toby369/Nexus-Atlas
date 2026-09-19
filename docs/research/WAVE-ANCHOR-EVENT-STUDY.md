# Wave Anchor: Event-Study — 2026-09-19 (v3)

Beantwortet v3 Abschnitt 15 ("EVENT STUDY"): für jedes der vier Cross-Events N, Mittelwert,
Median, Hit-Rate, Standardabweichung/CI, Effektgröße, für alle Targets. Rohdaten:
`output/cells_train_val.csv` (Filter `test_category == "TEST5"`) und `output/cells_oos.csv`.

## 1. Methodik

Vier Events (v3 Abschnitt 6, exakt aus dem Originalquelltext, siehe
`WAVE-ANCHOR-ORIGINAL-SOURCE.md` Abschnitt 6): `CROSS_ABOVE_PLUS60`, `CROSS_BELOW_PLUS60`,
`CROSS_BELOW_MINUS60`, `CROSS_ABOVE_MINUS60`. Getestet je Welle (Fast/Slow), je überwachtem HTF
(A=näher, B=weiter), je Horizont (1H/4H/12H/24H/48H/7D), je Studien-Setup — **192 Event-Zellen
insgesamt** (4 Events × 2 Wellen × 2 HTFs × 6 Horizonte × 2 Setups).

Je Zelle: `n_condition` (Stichprobengröße des Events), Mittelwert des Forward-Returns bei
Event-Eintritt (`mean_condition`), Median (`median_condition`), Hit-Rate (`hit_rate_condition` =
Anteil positiver Forward-Returns), Effektgröße (`observed_diff` = Mitteldifferenz zur
unkonditionierten Baseline, Moving-Block-Bootstrap-CI), roher und BH-adjustierter p-Wert.

## 2. Ergebnis (Horizont 1H, repräsentativ — vollständige Tabelle für alle 6 Horizonte in
   `output/cells_train_val.csv`)

| Setup | Feature | Event | N | Mean | Median | Hit-Rate | Effekt (Δ vs. Baseline) | raw p | BH-adj. p |
|---|---|---|---|---|---|---|---|---|---|
| 15m→1H+4H | htfA_wt1 | CROSS_ABOVE_PLUS60 | 1987 | 0.000208 | -0.000243 | 47.4% | +0.000141 | 0.476 | 0.997 |
| 15m→1H+4H | htfA_wt1 | CROSS_BELOW_PLUS60 | 1987 | 0.000439 | 0.000220 | 53.3% | +0.000372 | 0.028 | 0.507 |
| 15m→1H+4H | htfA_wt1 | CROSS_BELOW_MINUS60 | 1771 | 0.000244 | 0.000486 | 56.0% | +0.000178 | 0.416 | 0.997 |
| 15m→1H+4H | htfA_wt1 | CROSS_ABOVE_MINUS60 | 1771 | -0.000160 | -0.000054 | 49.1% | -0.000227 | 0.284 | 0.947 |
| 15m→1H+4H | htfA_wt2 | CROSS_ABOVE_PLUS60 | 1663 | 0.000211 | -0.000219 | 47.0% | +0.000144 | 0.520 | 0.997 |
| 15m→1H+4H | htfA_wt2 | CROSS_BELOW_PLUS60 | 1663 | 0.000176 | 0.000101 | 51.4% | +0.000109 | 0.508 | 0.997 |
| 15m→1H+4H | htfA_wt2 | CROSS_BELOW_MINUS60 | 1423 | -0.000187 | 0.000134 | 51.8% | -0.000253 | 0.316 | 0.951 |
| 15m→1H+4H | htfA_wt2 | CROSS_ABOVE_MINUS60 | 1423 | -0.000231 | -0.000093 | 48.9% | -0.000297 | 0.288 | 0.947 |
| 1H→4H+1D | htfA_wt1 | CROSS_BELOW_PLUS60 | 563 | 0.000529 | 0.000417 | **56.0%** | +0.000462 | **0.000** | **0.000** |

Vollständige Tabelle (alle 32 Kombinationen bei 1H, plus 6 weitere Horizonte) in
`output/cells_train_val.csv`. **Kernbefund**: Hit-Rates liegen durchgängig nahe 50 % (47–56 %,
kein Ausreißer weit davon entfernt), Effektgrößen liegen in der Größenordnung von
0.0001–0.0005 (0.01–0.05 % Forward-Return) — ökonomisch vernachlässigbar selbst dort, wo p-Werte
klein sind.

## 3. BH-FDR-Ergebnis

Von 192 Event-Zellen (TRAIN_VAL) überlebt **genau eine** die gepoolte BH-FDR-Korrektur (α=0.05):
`htfA_wt1_L2_cross_down_ob` (CROSS_BELOW_PLUS60, Fast Wave, näherer HTF) im Setup "1H→4H+1D",
Horizont 1H: N=563, Hit-Rate 56.0 %, Effekt +0.000462, `bh_adjusted_p ≈ 0`.

## 4. OOS-Bestätigung — entscheidender Befund

Diese eine überlebende Zelle wurde auf dem unberührten OOS-Split erneut getestet (5000 Replikate):

| | TRAIN_VAL | OOS |
|---|---|---|
| N | 563 | 112 |
| Effekt (Δ) | +0.000462 | +0.000328 |
| raw p-Wert | 0.000 | **0.188** |

**Die Zelle reproduziert NICHT signifikant im OOS-Split** (p=0.188 bei α=0.05). Von 192
getesteten Event-Zellen überlebt damit **keine einzige** sowohl die BH-FDR-Korrektur ALS AUCH die
OOS-Bestätigung.

## 5. Antwort auf v3 Frage G ("Sind die Events statistisch mit zukünftigen Returns verbunden?")

**Nein, nicht robust.** Eine von 192 getesteten Kombinationen zeigt im TRAIN_VAL-Set ein nach
BH-FDR signifikantes Ergebnis — bei 192 Tests und α=0.05 wäre ohne jeden echten Effekt bereits
mit ca. 9–10 rohen p<0.05-Zufallstreffern zu rechnen (die BH-FDR-Korrektur selektiert daher
korrekt sehr konservativ); dass die einzige verbleibende Zelle im OOS-Split nicht reproduziert,
ist der entscheidende, konsistente Befund: kein Cross-Event zeigt eine robuste, außerhalb der
Trainingsdaten reproduzierbare Verbindung zu zukünftigen Returns.
