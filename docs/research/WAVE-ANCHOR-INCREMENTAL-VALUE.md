# Wave Anchor: Incremental-Value-Test — 2026-09-19 (v3)

Beantwortet v3 Abschnitt 18/19 ("Liefert Wave Anchor Informationen, die einfache
Baseline-Variablen nicht bereits enthalten?"). Methodik: siehe `incremental_value.py` und
`WAVE-ANCHOR-FEATURE-SPEC.md` Abschnitt 9. Rohdaten: `output/incremental_value.csv` (48 Zellen:
2 Setups × 6 Horizonte × 2 Zieltypen × 2 Splits).

## 1. Ergebnis-Übersicht (TRAIN_VAL)

| Setup | Horizont | Ziel | R² Baseline | R² Baseline+WA | ΔR² | Wald-p (WA-Block) |
|---|---|---|---|---|---|---|
| 15m→1H+4H | 1H | forward_return | 0.000112 | 0.000187 | 0.000075 | 0.391 |
| 15m→1H+4H | 4H | direction | 0.003709 | 0.004104 | 0.000395 | **0.025** |
| 15m→1H+4H | 24H | forward_return | 0.003556 | 0.006921 | 0.003364 | 0.057 |
| 15m→1H+4H | 48H | forward_return | 0.002507 | 0.006328 | 0.003821 | **0.046** |
| 1H→4H+1D | 1H | forward_return | 0.000433 | 0.000829 | 0.000396 | **0.006** |
| 1H→4H+1D | 1H | direction | 0.002968 | 0.003380 | 0.000412 | **0.0002** |
| 1H→4H+1D | 4H | forward_return | 0.002317 | 0.003621 | 0.001304 | **0.007** |

(Vollständige 24-Zeilen-Tabelle in `output/incremental_value.csv`.)

**Fünf von 24 TRAIN_VAL-Zellen** zeigen einen bei α=0.05 signifikanten Wald-Test für den
Wave-Anchor-Block — aber **ΔR² liegt in JEDEM Fall unter 0.004** (0.4 Prozentpunkte erklärte
Varianz zusätzlich). Selbst das absolute `R²` des vollen Modells (Baseline+WaveAnchor) bleibt
durchgehend unter 0.015 — das lineare/logistische Modell erklärt in keinem Fall mehr als ~1.5 %
der Varianz des Ziels, mit oder ohne Wave-Anchor-Block.

## 2. OOS-Bestätigung — entscheidender Befund

| Setup | Horizont | Ziel | Wald-p TRAIN_VAL | Wald-p OOS |
|---|---|---|---|---|
| 15m→1H+4H | 4H | direction | 0.025 | 0.254 |
| 15m→1H+4H | 48H | forward_return | 0.046 | 0.949 |
| 1H→4H+1D | 1H | forward_return | 0.006 | 0.610 |
| 1H→4H+1D | 1H | direction | 0.0002 | 0.956 |
| 1H→4H+1D | 4H | forward_return | 0.007 | 0.665 |

**Keine der fünf TRAIN_VAL-signifikanten Zellen reproduziert im OOS-Split** (alle OOS-Wald-p-Werte
> 0.25, die meisten > 0.6). Über alle 24 (Setup×Horizont×Ziel)-Kombinationen hinweg zeigt der
Wave-Anchor-Block im OOS-Split **kein einziges Mal** eine gemeinsame Signifikanz auf dem 5 %-Niveau.

## 3. Antwort auf v3 Frage I ("Hat Wave Anchor gegenüber einfachen Baselines zusätzlichen
   Informationswert?")

**Nein.** Die wenigen TRAIN_VAL-signifikanten ΔR²-Werte sind (a) durchweg ökonomisch trivial
klein (< 0.4 Prozentpunkte zusätzliche erklärte Varianz) und (b) reproduzieren in keinem Fall
im unberührten OOS-Split. Konsistent mit dem Event-Study-Befund (`WAVE-ANCHOR-EVENT-STUDY.md`)
und dem direkten Baseline-Vergleich (`WAVE-ANCHOR-RESEARCH-REPORT.md` Abschnitt zu Frage I):
die Baseline-Variablen (Momentum/EMA-Trend/RSI/MACD) allein liefern bereits den überwiegenden
Teil der (ohnehin geringen) erklärten Varianz; der Wave-Anchor-Block liefert keinen robusten
Zusatzbeitrag.

## 4. Methodische Einordnung

Kein Widerspruch zu den einzelnen BH-FDR-signifikanten Rank-IC-Zellen aus der Hauptbatterie
(`WAVE-ANCHOR-EVENT-STUDY.md`, `cells_train_val.csv`): diese Regression testet den Wave-Anchor-
Block ZUSÄTZLICH zu den bereits vorhandenen Baseline-Variablen, nicht isoliert — der Test fragt
explizit nach INKREMENTELLEM Wert, nicht nach isolierter Korrelation. Dass isolierte Rank-ICs von
WT1/WT2 selbst im TRAIN_VAL-Set signifikant erscheinen (aber ebenfalls nicht OOS reproduzieren,
siehe Hauptbericht), während der inkrementelle Beitrag ÜBER die Baselines hinaus noch kleiner
ausfällt, ist inhaltlich konsistent: ein Teil der (ohnehin geringen) WT-Rohwert-Korrelation ist
bereits durch Preis-Momentum/RSI/EMA-Trend miterklärt, da WaveTrend selbst eine Glättungs-
Transformation von Preisbewegung ist.
