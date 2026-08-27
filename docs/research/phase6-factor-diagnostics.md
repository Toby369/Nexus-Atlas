# Phase 6 — Factor Diagnostics, Redundancy, Time-Scale Audit

Scope: nur die 6 in TRAIN+VALIDATION (201 Tage, 19.12.2025–07.07.2026) durchgehend verfügbaren Faktoren (`structure`, `momentum`, `cvd`, `trend_strength`, `trend_regime`, `vwap_position`). Die anderen 8 Faktoren haben in diesem Fenster 0% Coverage (siehe `research_factor_coverage()`, `phase6-ist-zustand-audit.md`) — für sie ist jede Diagnostik `INSUFFICIENT_DATA`, keine einzelne Analyse wurde für sie durchgeführt (bewusste Scope-Entscheidung).

## Distribution (zugrundeliegende kontinuierliche Metriken, n=201)

| Metrik | Mean | Median | StdDev | Min | Max |
|---|---|---|---|---|---|
| rsi_14 | 45.9 | 45.4 | 12.2 | 15.4 | 70.0 |
| macd_histogram | 5.5 | 152.7 | 649.6 | −2253.3 | 1179.4 |
| cvd_delta | 57.4 | −190.3 | 6092.7 | −25871.2 | 23432.0 |
| adx_14 | 30.5 | 27.1 | 11.7 | 13.8 | 58.3 |
| trend_spread_pct (EMA50 vs EMA200) | −11.6 | −10.8 | 3.8 | −17.8 | −5.9 |
| vwap_pct_diff | −1.2 | −0.9 | 5.1 | −21.9 | 8.6 |

**Zentraler Befund:** `trend_spread_pct` ist über **das gesamte** TRAIN+VALIDATION-Fenster durchgehend negativ (Min −17.8%, Max nur −5.9%) — EMA50 lag die ganze Zeit unter EMA200. Der `trend_regime`-Faktor konnte in diesem Fenster strukturell kaum je `BULLISH` liefern (Bedingung `close>EMA50>EMA200`), unabhängig vom Marktverhalten. Das ist eine reale Charakteristik dieses Zeitfensters (Erholung aus einem größeren vorherigen Rückgang, EMA200 blieb entsprechend erhöht) — kein Bug, aber eine wichtige Erklärung dafür, warum VALIDATION komplett ohne BULLISH-Tage blieb (Phase 5, Abschnitt G).

## Time-Scale (Autokorrelation, Lag 1/7 Tage)

| Metrik | AC Lag-1 | AC Lag-7 | Charakter |
|---|---|---|---|
| trend_spread_pct | 0.999 | 0.935 | extrem persistent |
| adx_14 | 0.994 | 0.798 | sehr persistent |
| macd_histogram | 0.975 | 0.532 | persistent |
| rsi_14 | 0.937 | 0.628 | persistent |
| vwap_pct_diff | 0.908 | 0.546 | persistent |
| **cvd_delta** | **0.139** | **0.183** | **praktisch memoryless** |

**Zentraler Befund (Section 8 der Vorgabe, jetzt mit echten Zahlen belegt):** `cvd` verhält sich auf Tagesbasis fast wie Rauschen (Autokorrelation nahe 0), während die anderen 5 Faktoren stark geglättete, mehrtägige Persistenz zeigen (EMA-/RSI-/ADX-basiert, by construction). Ein tagesbasierter CVD-Wert trägt kaum Information über den Vortag hinaus, während `trend_regime`/`adx_14` sich über Wochen kaum ändern. Die Frage aus der Vorgabe — "ist es methodisch sinnvoll, diese auf derselben Zeitskala zu aggregieren?" — hat damit eine konkrete, evidenzbasierte Antwort: nein, nicht ohne Weiteres. `orderbook` (ebenfalls als "schnell/CVD-artig" vermutet) konnte nicht mitgeprüft werden — 0% Coverage in diesem Fenster.

## Redundanz (Pearson + Spearman, n=201) — deutliche Revision gegenüber Phase 3

Phase 3 fand auf der (viel kürzeren, 1H, 11 Tage) Datenbasis nur schwache Korrelationen (r=0.26–0.53). Auf der jetzt verfügbaren, 18× längeren, regime-diversen 1D-Basis zeigt sich ein deutlich anderes Bild:

| Paar | Pearson r | Spearman ρ |
|---|---|---|
| momentum ↔ vwap_position | **0.699** | 0.686 |
| structure ↔ trend_regime | **0.665** | 0.665 |
| structure ↔ vwap_position | **0.654** | 0.658 |
| trend_regime ↔ trend_strength | 0.642 | 0.636 |
| momentum ↔ trend_strength | 0.591 | 0.609 |
| structure ↔ momentum | 0.591 | 0.611 |
| cvd ↔ momentum | 0.589 | 0.534 |
| trend_regime ↔ vwap_position | 0.534 | 0.526 |
| cvd ↔ structure | 0.297 | 0.285 |

**Zentraler Befund:** Mit mehr Daten wird die Redundanz innerhalb der Market-Structure/Momentum-Trend-Domänen deutlich sichtbarer als in Phase 3 angenommen — 8 von 9 geprüften Paaren liegen zwischen r=0.53 und r=0.70 (moderat bis stark), nicht mehr "schwach". Das stützt die ursprüngliche Vermutung aus der Nexus-Atlas-Spezifikation ("dasselbe Signal wird mehrfach gezählt") stärker, als Phase 3 mit der damals verfügbaren, viel dünneren Datenbasis zeigen konnte. Einzige Ausnahme: `cvd ↔ structure` bleibt schwach (r=0.297) — konsistent mit dem Time-Scale-Befund oben (CVD tickt auf einer anderen Frequenz).

**Einordnung, technische Korrelation vs. ökonomische Redundanz vs. Kausalität:** Alle sechs Faktoren sind unterschiedliche mathematische Transformationen derselben zugrundeliegenden Preisreihe (RSI/MACD/ADX/EMA/VWAP/Swing-Struktur) — eine moderate bis starke Korrelation ist ökonomisch plausibel und erwartbar, nicht überraschend. Keine Kausalaussage möglich oder nötig — es sind alles abgeleitete Indikatoren derselben Zeitreihe. Die relevante Konsequenz ist architektonisch: die aktuelle Baseline (Model A) zählt diese 6 teils stark korrelierten Faktoren als 6 unabhängige Stimmen in der Summe.

## Bewusst nicht durchgeführt (Scope-Entscheidung)

Distribution-/Redundanz-/Time-Scale-Analyse für die 8 datenarmen Faktoren (funding, positioning, orderbook, options, macro, sentiment, oi_price, basis) — Coverage 0% in TRAIN+VALIDATION, keine sinnvolle Aussage möglich. Formal `INSUFFICIENT_DATA`, siehe `research_factor_coverage()`.
