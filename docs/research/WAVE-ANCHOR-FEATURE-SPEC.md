# Wave Anchor: Feature-Spezifikation — 2026-09-19 (v3)

Aktualisiert `WAVE-ANCHOR-FEATURE-SPECIFICATION.md` (v2) für die v3-Aufgabenstellung. Referenz für
`WAVE-ANCHOR-RESEARCH-REPORT.md`. Siehe `WAVE-ANCHOR-ORIGINAL-SOURCE.md` für die Quellenlage
(Kategorie A weiterhin leer, Kategorie U = Nutzer-Beschreibung, Kategorie B jetzt per Screenshot
der offiziellen Beschreibungsseite direkt bestätigt).

## 1. Datenbasis (unverändert aus v1/v2)

BTC/USDT Perpetual Futures, Binance, UTC. 15m (141.668 Zeilen), 1h (35.422), 4h (8.855, resampled),
1d (1.476, resampled) — 2022-09-04 bis 2026-09-18. Details: `WAVE-ANCHOR-FEATURE-SPECIFICATION.md`
Abschnitt 1 (v2, unverändert gültig).

## 2. WaveTrend-Formel und Parameter — jetzt einziges Preset

```
src = HLC3
esa = EMA(src, 9)
de  = EMA(|src - esa|, 9)
ci  = (src - esa) / (0.015 * de)
WT1 = EMA(ci, 12)   ("Fast Wave")
WT2 = SMA(WT1, 3)   ("Slow Wave")
```

**v3-Änderung**: nur noch das primärquellenbestätigte Preset `chlen=9/avg=12/malen=3` wird
getestet (v3 Abschnitt 24 "KEINE PARAMETER-OPTIMIERUNG"). Das v1/v2-LazyBear-Alternativpreset
(10/21/4) entfällt für die v3-Hauptbatterie — es war in v1/v2 eine von zwei gleichermaßen
plausiblen Annahmen; jetzt, da 9/12/3 direkt bestätigt ist (Kategorie U+C übereinstimmend), wäre
ein Paralleltest keine Prüfung zweier plausibler Hypothesen mehr, sondern ein Schritt Richtung
Parameter-Exploration — explizit nicht Teil dieses Tests.

**Terminologie**: `wt1` (Code) ≡ **Fast Wave** (Original-Begriff), `wt2` (Code) ≡ **Slow Wave**.
Beide werden vollständig getrennt getestet (v3 Abschnitt 3), keine Vorab-Entscheidung, welche
"besser" ist.

## 3. Anchor-Level — nur ±60

**v3-Änderung**: `features.THRESHOLD_LEVELS` enthält weiterhin alle drei VuManChu-Level (L1=±53,
L2=±60, L3=+100/-75) im Code (keine Löschung getesteter, funktionierender Infrastruktur), aber
die v3-Hauptbatterie (`run_research.py`) testet **ausschließlich L2 (±60)** — v3 Abschnitt 4:
"Diese Werte sind Bestandteil des konkreten Wave Anchor. Nicht auf +53/-53 ändern." Jetzt direkt
durch die offizielle Beschreibungsseite bestätigt (Screenshot: *"overbought (above 60) or oversold
(below -60)"*).

## 4. Feature-Definitionen (siehe v2-Dokument Abschnitt 4 für die vollständige Herleitung,
   hier nur die v3-relevanten Anpassungen)

Je Welle (`fast_wave`=wt1, `slow_wave`=wt2) und Level 2 (±60):

- **State**: `above_60` (Welle > 60), `between_levels` (-60 ≤ Welle ≤ 60), `below_minus_60`
  (Welle < -60) — v3-Terminologie (Abschnitt 12), technisch identisch zu v1/v2s `OB`/`NEUTRAL`/`OS`
  (Spaltenname im Code bleibt `state` mit Werten `"OB"/"NEUTRAL"/"OS"`, hier nur die
  Berichts-Terminologie an v3 angepasst).
- **Cross Events**: `CROSS_ABOVE_PLUS60` (`cross_up_ob`), `CROSS_BELOW_PLUS60` (`cross_down_ob`),
  `CROSS_BELOW_MINUS60` (`cross_down_os`), `CROSS_ABOVE_MINUS60` (`cross_up_os`) — v3-Namen links,
  Code-Spaltennamen rechts. **Primäre Größe** laut v3 Abschnitt 7 (Original ist primär ein
  Event-/Cross-System, `ta.crossover()`/`ta.crossunder()`) — im Report werden Event-Ergebnisse vor
  State-Ergebnissen diskutiert.
- **Distance**: `distance_to_plus60 = 60 - Welle`, `distance_to_minus60 = Welle - (-60)`.
- **Slope**: `delta_1 = Welle.diff()` (Vorzeichen → RISING/FALLING/FLAT, wie v1/v2). Ein `delta_2`
  (zweite Differenz / Beschleunigung, v3 Abschnitt 12 nennt beide `delta_1`/`delta_2`) wird NICHT
  separat als Testgröße geführt — `delta_1`-Vorzeichen (Slope-Richtung) ist bereits über TEST6
  abgedeckt; eine zusätzliche Beschleunigungsgröße würde die ohnehin schon große Testmatrix ohne
  klaren Mehrwert weiter aufblähen (dokumentierte Scope-Entscheidung).

## 5. MTF-Konfluenz (v3 Abschnitt 13)

Getestet für Level 2, je Welle: `above_60`/`between_levels`/`below_minus_60` kombiniert zwischen
HTF A und HTF B → `MIXED`, wenn unterschiedlich, sonst der gemeinsame Zustand — identisch zur
v1/v2-Logik (`mtf_confluence()`). v3 verlangt zusätzlich explizite Cross-Kombinationen (z. B. "1H
Cross-Above-60 UND 4H bereits above_60") — das wird über die bereits vorhandene MTF-Konfluenz-Zelle
(State-Kombination) plus die getrennten Cross-Event-Zellen abgedeckt, ohne eine dritte, noch
größere kombinatorische Matrix zu bauen (jede der 3×3=9 denkbaren State-Kombinationen wird über
`MIXED`/gemeinsamer-Zustand bereits klassifiziert; die einzelnen Cross-Events sind über TEST5
separat auswertbar — eine explizite "Cross-A UND State-B"-Kreuzmatrix wäre eine weitere
Vervielfachung der Zellenzahl ohne durch v3 zwingend geforderte Einzelaufschlüsselung).

## 6. Targets (unverändert aus v1/v2, siehe FEATURE-SPECIFICATION.md Abschnitt 6)

`forward_return`, `direction`, `abs_return`, `mfe`, `mae`, Horizonte 1H/4H/12H/24H/48H/7D.

## 7. Baselines (unverändert, siehe v2-Dokument Abschnitt 7)

`baseline_momentum`, `baseline_ema_trend`, `baseline_rsi`, `baseline_macd_hist`.

## 8. Statistik-Zellen — v3-Matrix (nur L2, ein Preset)

Siehe `run_research.py::_generate_cells()`. Pro (Studien-Setup × Horizont), **ein** Preset:

| Test | Beschreibung | Zellen/Horizont |
|---|---|---|
| TEST 1 | Fast-Wave-Rank-IC, je HTF A/B | 2 |
| TEST 2 | Slow-Wave-Rank-IC, je HTF A/B | 2 |
| TEST 3 | Fast-Wave-State (above_60/below_minus_60 vs. Rest), je HTF A/B | 4 |
| TEST 4 | Slow-Wave-State, je HTF A/B | 4 |
| TEST 5 | 4 Cross-Events, je HTF A/B, je Welle | 16 |
| TEST 6 | Slope, je HTF A/B, je Welle | 8 |
| TEST 7 | Distance-Rank-IC, je HTF A/B, je Welle | 8 |
| TEST 8 | Anchor-Duration-Rank-IC, je HTF A/B, je Welle | 8 |
| TEST 9/10 | MTF-Konfluenz, je Welle | 6 |
| TEST 11 | State×Slope, HTF A only, je Welle | 12 |
| TEST 12 | Baseline-Rank-IC (Momentum/EMA/RSI/MACD) | 4 |

**Summe: 74 Zellen/Horizont/Setup** × 6 Horizonte × 2 Setups = **888 TRAIN_VAL-Zellen** (v2 hatte
2.064 bei zwei Presets und drei Leveln — deutliche Reduktion durch v3s engeren, jetzt besser
belegten Scope).

## 9. Incremental-Value-Test (v3 Abschnitt 18, NEU — nicht in v1/v2)

Siehe `incremental_value.py`. Logistische Regression (Richtung) bzw. OLS (Forward-Return), Modell
"nur Baseline" vs. "Baseline+Wave-Anchor" (`{htfA_wt2, htfB_wt2}` — bewusst kleiner, gut
interpretierbarer Block, siehe Moduldoc für die Begründung). HAC/Newey-West-robuste
Standardfehler, `maxlags=block_length` (identische Herleitung wie überall im Projekt). Wald-Test
für die gemeinsame Signifikanz des Wave-Anchor-Blocks. Auf TRAIN_VAL UND OOS berechnet (beantwortet
v3 Frage J direkt).

## 10. TRAIN_VAL/OOS-Split, BH-FDR (unverändert aus v1/v2)

Chronologischer 80/20-Split, BH-FDR über den gesamten gepoolten TRAIN_VAL-Zellensatz, OOS-
Bestätigung nur für BH-signifikante Zellen bei 5000 Replikaten.

## 11. Performance-Staffelung (aus v2 übernommen)

`MIN_BLOCK_LENGTH=10`, gestaffelte Replikatzahl bei kurzer Blocklänge (`block_length<20` → 250,
`<100` → 500, sonst 1000) — siehe `stats_battery.py`-Docstring für die Kalibrierungsmessung.
