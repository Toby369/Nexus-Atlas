# Wave Anchor: Abschlussbericht — 2026-09-19 (v3, final)

**STATUS: RESEARCH ONLY.** Keine Änderungen an Production (Market-State Engine, 14 Faktoren,
Gewichte, Thresholds, Production/Testset, Baseline, pg_cron, Production UI, Production Signals,
Datenpipelines) — verifiziert per `git diff` gegen `main`, siehe Abschnitt 18.

Dieser Bericht beantwortet die zehn v3-Kernfragen (A–J) und schließt mit genau einer der vier
zulässigen Klassifikationen. Alle Unterlagen: `WAVE-ANCHOR-ORIGINAL-SOURCE.md`,
`WAVE-ANCHOR-SECURITY-AUDIT.md`, `WAVE-ANCHOR-REPAINT-AUDIT.md`, `WAVE-ANCHOR-FEATURE-SPEC.md`,
`WAVE-ANCHOR-EVENT-STUDY.md`, `WAVE-ANCHOR-INCREMENTAL-VALUE.md`.

## Executive Summary

Der Wave-Anchor-Indikator (StormCat1, Pine v5, Originalquelltext liegt seit dieser Untersuchung
vollständig vor) markiert Kreuzungen des WaveTrend-Oszillators (VuManChu/LazyBear-Basis) durch
±60 auf höheren Zeitebenen. Eine vollständige Forschungs-Reimplementierung (888 TRAIN_VAL-
Statistikzellen über 12 Testkategorien, gepoolte BH-FDR-Korrektur, OOS-Bestätigung auf einem
eingefrorenen 20%-Split, ergänzt um einen Incremental-Value-Regressionstest) zeigt: **kein**
Wave-Anchor-Feature (weder Fast Wave/WT1 noch Slow Wave/WT2, weder als Cross-Event noch als
Zustand, weder roh noch in MTF-Konfluenz) reproduziert seinen Effekt zuverlässig außerhalb der
Trainingsdaten. Einfache Baseline-Kontrollgrößen (Preis-Momentum, RSI, EMA-Trend, MACD) zeigen
demgegenüber teilweise stabilere, teils sogar größere Effekte. Kein Hinweis auf Look-Ahead oder
Repainting in der Forschungsimplementierung.

## A. Was macht der Wave Anchor mathematisch tatsächlich?

`src=HLC3; esa=EMA(src,9); de=EMA(|src-esa|,9); ci=(src-esa)/(0.015·de); WT1=EMA(ci,12);
WT2=SMA(WT1,3)`. Berechnet für 4H, Daily und 1H (Kategorie A, exakter Originalquelltext, siehe
`WAVE-ANCHOR-ORIGINAL-SOURCE.md` Abschnitt 2/5). WT1 ("Fast Wave") und WT2 ("Slow Wave") sind über
einen echten Nutzer-Dropdown (`input.string`, Default "Fast Wave") wählbar, gelten aber laut Code
IMMER global für alle Cross-Bedingungen gleichzeitig — nie beide gleichzeitig aktiv im Original.

## B. Was unterscheidet Fast Wave und Slow Wave?

WT1 (Fast) reagiert unmittelbarer (ist selbst die EMA von `ci`), WT2 (Slow) ist zusätzlich über
3 Perioden geglättet (SMA von WT1) — WT2 ist strukturell eine verzögerte, geglättete Version von
WT1. Empirisch (siehe `cells_train_val.csv`, TEST1 vs. TEST2, TEST3 vs. TEST4): beide zeigen
ähnlich kleine, ähnlich instabile Effekte; **kein** systematischer Vorteil einer Welle gegenüber
der anderen in dieser Untersuchung feststellbar (weder TRAIN_VAL noch OOS). Kein "Winner" wird
ausgewiesen (wie in v3 Abschnitt 16 gefordert).

## C. Wie funktionieren +60/-60?

Fest im Code verdrahtet (`overboughtLevel=60`, `oversoldLevel=-60`, kein Input-Parameter, kein
±53-Pfad — Kategorie A, siehe `WAVE-ANCHOR-ORIGINAL-SOURCE.md` Abschnitt 4). Vier
`ta.crossover()`/`ta.crossunder()`-Bedingungen erzeugen die vier Cross-Events (Abschnitt 6 dort).
Der Indikator selbst ist primär ein **Event-System** (Label erscheint am Kreuzungsmoment), kein
anhaltender Zustandsanzeiger — bestätigt durch die öffentliche Beschreibungsseite UND den
Originalcode. Die Forschung testet beide Lesarten getrennt (State: TEST3/4, Cross: TEST5).

## D/E. Welche Informationen sind auf 15m bzw. 1H tatsächlich verfügbar?

15m-Chart: ausschließlich bereits bestätigte 1H- und 4H-Wave-Werte (kein 15m-eigener Wave im
Code). 1H-Chart: ausschließlich bestätigte 4H- und Daily-Wave-Werte. Die
Forschungsimplementierung erzwingt dies streng über `confirmed_asof_join` (HTF-Wert erst ab
`close_time` der jeweiligen HTF-Bar verfügbar) — siehe `WAVE-ANCHOR-REPAINT-AUDIT.md`.

## F. Gibt es Lookahead/Repainting?

**Security Audit: PASS. Repainting: NO_REPAINT** für alle sechs geprüften Größen (WT1, WT2,
+60-Cross, -60-Cross, MTF-State, MTF-Konfluenz) in der Forschungsimplementierung — belegt durch
6 automatisierte Tests (`test_mtf_join.py`) plus Ende-zu-Ende-Prüfung (`test_features.py`). Der
Originalcode verwendet `request.security()` ohne `lookahead_on` (Kategorie A) — kein Beleg für
absichtlichen Zukunftsdatenzugriff. Eine einzige verbleibende Kategorie-D-Unsicherheit (exakte
numerische Feinstruktur der verschachtelten `security()`-Aufrufe zwischen zwei HTF-Updates,
siehe `WAVE-ANCHOR-SECURITY-AUDIT.md` Abschnitt 3) betrifft NICHT die Bestätigungszeitpunkte
selbst und damit nicht die Look-Ahead-Sicherheit der hier berichteten Ergebnisse.

## G. Sind die Events statistisch mit zukünftigen Returns verbunden?

**Nein, nicht robust.** Von 192 getesteten Event-Zellen (4 Cross-Typen × 2 Wellen × 2 HTFs ×
6 Horizonte × 2 Setups) überlebt genau eine die BH-FDR-Korrektur — und diese eine reproduziert
NICHT im OOS-Split (raw p=0.188). Details: `WAVE-ANCHOR-EVENT-STUDY.md`.

## H. Ist dieser Zusammenhang robust?

**Nein.** Regime-Stratifizierung (trend_regime BULL/BEAR/SIDEWAYS, vol_regime LOW/MID/HIGH,
vorab definiert per SMA50-Trend bzw. Volatilitäts-Terzile) auf der stärksten TRAIN_VAL-Zelle
(`htfA_wt1` Rank-IC vs. `forward_return_1H`, 15m-Setup) zeigt: Effektrichtung konsistent negativ
über alle Regime-Segmente (BULL -0.028, BEAR -0.023, SIDEWAYS -0.029; LOW -0.023, MID -0.022,
HIGH -0.036) — aber die Effektgröße bleibt in JEDEM Segment ökonomisch vernachlässigbar (|IC| ≤
0.036) und war bereits im gepoolten OOS-Test (n=28.330) nicht signifikant (p=0.080). Kein
Hinweis auf einen in bestimmten Marktphasen verborgenen, stärkeren Effekt.

## I. Hat Wave Anchor gegenüber einfachen Baselines zusätzlichen Informationswert?

**Nein.** Zwei unabhängige, konvergente Belege:

1. **Direkter Rank-IC-Vergleich** (TEST1/2 vs. TEST12_BASELINE, `cells_train_val.csv`/
   `cells_oos.csv`): die Baseline-Kontrollgrößen (`baseline_rsi`: TRAIN_VAL-IC bis -0.058,
   OOS -0.053 bei 1H; `baseline_momentum`: TRAIN_VAL -0.044, OOS -0.045) zeigen **größere und OOS-
   reproduzierbare** Effekte als jede Wave-Anchor-Größe (WT1/WT2-IC: TRAIN_VAL bis -0.027, OOS
   NICHT signifikant, p=0.08–0.13).
2. **Incremental-Value-Regression** (`WAVE-ANCHOR-INCREMENTAL-VALUE.md`): Baseline+Wave-Anchor
   gegen Baseline allein — ΔR² durchgehend < 0.4 Prozentpunkte, und selbst die wenigen TRAIN_VAL-
   signifikanten Fälle (5 von 24) reproduzieren OOS in **keinem einzigen** Fall (alle OOS-Wald-p
   > 0.25).

**Konsequenz**: Wave Anchor liefert nach dieser Untersuchung keinen belastbaren
Informationsgewinn gegenüber simplen, bereits etablierten Momentum-/Trend-Indikatoren — im
direkten Vergleich schneiden die einfacheren Baselines sogar tendenziell besser (größere, OOS-
stabilere Effekte) ab.

## J. Ist das Ergebnis OOS reproduzierbar?

**Nein — und genau das ist der zentrale, konsistente Befund dieser Untersuchung.** Über alle vier
unabhängigen Analyseachsen hinweg (rohe Rank-IC/State/Distance/Duration in der Hauptbatterie,
Cross-Event-Study, Incremental-Value-Regression, Regime-Stratifizierung) gilt durchgängig: jeder
im TRAIN_VAL-Split gefundene, BH-FDR-signifikante Wave-Anchor-Effekt verschwindet im
eingefrorenen, bis zu diesem Zeitpunkt unberührten OOS-Split. Einzige Ausnahme mit teilweiser
OOS-Reproduktion sind die Baseline-Kontrollgrößen selbst (nicht Wave Anchor).

## Statistische Disziplin — Zusammenfassung

- **Stichprobenumfang**: 15m-Setup n=141.668 (TRAIN_VAL 113.334 / OOS 28.334), 1H-Setup n=35.422
  (TRAIN_VAL 28.338 / OOS 7.084). Jede Zelle mit N<30 je Gruppe: `INSUFFICIENT_DATA`, keine
  Schlussfolgerung — kam in dieser Batterie nicht vor (alle 888 Zellen `status=OK`).
- **Multiple Testing**: 888 TRAIN_VAL-Zellen in EINEM gepoolten BH-FDR-Lauf (α=0.05) korrigiert —
  25 überleben (2,8 %), was bei rein zufälligem Rauschen und α=0.05 in der Größenordnung des
  Erwartbaren liegt (kein Hinweis auf ein systematisch übervertretenes Signal).
- **Überlappende Targets**: Moving-Block-Bootstrap mit `block_length = max(10, 2×horizon_bars)`
  für alle Rank-IC/Bedingungs-Tests; HAC/Newey-West-robuste Standardfehler
  (`maxlags=block_length`) für die Incremental-Value-Regression — konsistente
  Abhängigkeitslängen-Konvention im gesamten Projekt.
- **Keine Parameteroptimierung**: nur das primärquellenbestätigte 9/12/3-Preset und Level ±60
  getestet (v3 Abschnitt 24), keine nachträgliche Anpassung.
- **OOS-Protokoll**: 80/20-chronologischer Split, Threshold-/Parameter-/Feature-Auswahl
  ausschließlich vor OOS-Betrachtung festgelegt, OOS nur zur Bestätigung bereits BH-signifikanter
  TRAIN_VAL-Zellen verwendet, keine nachträgliche Anpassung nach OOS-Einblick.

## Ökonomische Bedeutsamkeit

Effektgrößen der (ohnehin größtenteils nicht OOS-reproduzierbaren) TRAIN_VAL-Befunde liegen bei
0,01–0,05 % Forward-Return pro Event bzw. Rank-IC-Beträgen von 0,02–0,04 — deutlich unterhalb
realistischer BTC/USDT-Perpetual-Handelskosten (Taker-Fee + Funding + Slippage liegen typischer­
weise bereits bei 0,05–0,15 % pro Round-Trip). Selbst im hypothetischen Fall einer OOS-
Reproduktion wären diese Effekte nach Kosten wirtschaftlich nicht nutzbar. Diese Einschätzung ist
angesichts des fehlenden OOS-Nachweises ohnehin nachrangig.

## Limitations

- Kategorie-D bleibt für die exakte numerische Feinstruktur der verschachtelten
  `request.security()`-Aufrufe (betrifft nicht Look-Ahead-Sicherheit, siehe Abschnitt F).
- Nur BTC/USDT getestet — keine Aussage über andere Symbole/Assetklassen.
- Nur ein WaveTrend-Parameter-Preset (9/12/3) und ein Level (±60) getestet, wie von v3 explizit
  vorgeschrieben — keine Aussage über andere Parameterkombinationen.
- Regime-Robustheit nur für eine repräsentative Zelle demonstriert (nicht für alle 888 Zellen
  einzeln durchexerziert), da der übergeordnete OOS-Befund bereits eindeutig negativ ist.

## 18. Production Barrier — verifiziert

```
git diff --stat main...claude/work-by-prompt-gxzjbj -- . ':!research-python/wave_anchor_research' ':!docs/research/WAVE-ANCHOR*'
```
→ **leer** (keine Zeile Output) — keine Datei außerhalb des Research-Bereichs verändert.
**Production changes: NONE.**

## Finale Klassifikation

Basierend ausschließlich auf dem vollständigen Forschungsprotokoll (nicht auf visueller
Chart-Interpretation, nicht auf der Popularität des Indikators, nicht auf Entwickler-Aussagen):

**NO_INCREMENTAL_EVIDENCE**

Begründung in einem Satz: der Wave-Anchor-Indikator zeigt in dieser Untersuchung keinen
statistisch robusten, außerhalb der Trainingsdaten reproduzierbaren Informationsgewinn für
BTC/USDT-Forward-Returns — weder isoliert noch inkrementell gegenüber einfachen Baseline-
Kontrollgrößen — bei sauber nachgewiesener Look-Ahead-Sicherheit und ohne Hinweis auf
Repainting in der Forschungsimplementierung.
