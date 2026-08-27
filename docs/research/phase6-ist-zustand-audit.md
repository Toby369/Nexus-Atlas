# Nexus-Atlas — Phase 6 Research Framework: Ist-Zustand-Audit

Stand: 27.08.2026. Reine Bestandsaufnahme — nichts an Production wurde durch dieses Dokument verändert. Alle Angaben sind live gegen den Produktionscode (`compute-market-state` v8, Supabase Project `cpktesxmbqrzpsurntul`) und die tatsächlichen Datenbank-Zeilen verifiziert, keine Erinnerungswerte.

## 1. Die 14 Faktoren — exakte Berechnung, Datenquelle, Timestamp/Sync

| # | Faktor | Formel (exakt aus `compute-market-state` v8) | Datenquelle / Tabelle | Sampling |
|---|---|---|---|---|
| 1 | `structure` | `structure_trend='bullish'→1 / 'bearish'→-1 / sonst 0` | `market_features.structure_trend` (nexus-atlas-engine) | 15 Min Cron, Kerzen-Intervall 1H |
| 2 | `momentum` | `rsi_14>55 UND macd_histogram>0 → 1`; `rsi_14<45 UND macd_histogram<0 → -1`; sonst `0`; `null` falls RSI/MACD fehlt | `market_features.rsi_14`, `.macd_histogram` | 15 Min |
| 3 | `cvd` | `cvd_trend='rising'→1 / 'falling'→-1 / sonst 0` | `market_features.cvd_trend` | 15 Min |
| 4 | `oi_price` | `\|oi_delta_pct\| > 0.3% → (close>ema_20 ? 1 : -1)`; sonst `0`; `null` falls oi_delta_pct/close/ema_20 fehlt | `market_features.oi_delta_pct`, `.close_price`, `.ema_20` | 15 Min |
| 5 | `positioning` | `score>10→1 / score<-10→-1 / sonst 0` (Divergence Engine, Retail vs. Top-Trader Long/Short) | `positioning_signals.score` (collect-positioning, 4 Börsen) | 5 Min |
| 6 | `orderbook` | Ø `depth_imbalance` über den jüngsten gemeinsamen Tick aller Börsen; `>0.08→1 / <-0.08→-1 / sonst 0` | `orderbook_snapshots` (Binance/Bybit/OKX) | 5 Min |
| 7 | `options` | `put_call_oi_ratio<0.7→1 / >1.1→-1 / sonst 0` | `options_snapshots` (Deribit) | 30 Min |
| 8 | `macro` | `get_macro_regime()`: Risk-On/-Off-Zählung über VIX/S&P500/Nasdaq/DXY + Net Liquidity (Fed-Bilanz−TGA−RRP aus FRED). `Risk-On→1 / Risk-Off→-1 / Neutral/Mixed→0` | `macro_snapshots` (Yahoo Finance + FRED), RPC `get_macro_regime()` | 30 Min |
| 9 | `funding` | `get_funding_intelligence()`: Ø Funding-Rate über 4 Börsen, **kontrafaktisch**: `>0.05%→-1 / <-0.05%→1 / sonst 0` | `market_snapshots.funding_rate`, RPC `get_funding_intelligence()` | 5 Min |
| 10 | `sentiment` | Fear&Greed-Klassifikation, **kontrafaktisch**: `'Extreme Fear'→1 / 'Extreme Greed'→-1 / sonst 0` | `sentiment_snapshots` (alternative.me) | 60 Min |
| 11 | `trend_strength` | `adx_14<20→0`; sonst `plus_di>minus_di→1 / minus_di>plus_di→-1` | `market_features.adx_14`, `.plus_di`, `.minus_di` | 15 Min |
| 12 | `trend_regime` | `close>ema_50>ema_200→1`; `close<ema_50<ema_200→-1`; sonst `0` | `market_features.ema_50`, `.ema_200`, `.close_price` | 15 Min |
| 13 | `vwap_position` | `pct_diff=(close-vwap)/vwap×100`; `>0.15%→1 / <-0.15%→-1 / sonst 0` | `market_features.vwap`, `.close_price` | 15 Min |
| 14 | `basis` | Perpetual-Premium vs. Spot, **kontrafaktisch**: `>0.15%→-1 / <-0.15%→1 / sonst 0` | `market_features.basis_pct` | 15 Min |

Jeder Faktor liefert zusätzlich `null` bei fehlenden Rohdaten oder wenn die zugrundeliegende Quelle älter ist als ein pro-Faktor definiertes `MAX_AGE_MS` (Freshness-Fenster: positioning/orderbook 30 Min, options 2h, sentiment 3h, market_features-Faktoren 3h). `null` wird **nie** als `0` (neutral) gewertet.

## 2. Score-Berechnung, State-Schwellen, Coverage-Logik (Model A / Baseline)

```
withData        = Faktoren mit value != null
dataCoveragePct = count(withData) / 14 * 100
score           = Σ value über withData                       (einfache Summe, gleichgewichtet)
insufficientData = dataCoveragePct < 40  ODER  count(withData) = 0

wenn insufficientData:
  overall_state = INSUFFICIENT_DATA
  confidence    = 0
sonst:
  positiveCount = count(withData mit value=1)
  negativeCount = count(withData mit value=-1)
  overall_state = BULLISH   wenn score >= 3
                = BEARISH   wenn score <= -3
                = MIXED     wenn positiveCount>0 UND negativeCount>0
                = NEUTRAL   sonst
  confidence    = round( (dataCoveragePct/100) × (|score| / count(withData)) × 100 )
```

`MIN_COVERAGE_PCT = 40` ist eine benannte Konstante in `compute-market-state` — **bereits die in Section 5 der Phase-6-Vorgabe geforderte defensive Regel**: 0 aktive Faktoren führt zwingend zu `INSUFFICIENT_DATA`/`confidence=0`, nie zu einem künstlichen `NEUTRAL`. Diese Regel existierte bereits vor Phase 6 und wurde nicht verändert (siehe Abschnitt 6 unten für die formale Verifikation).

## 3. Domain-Struktur (Model B, additiv, Phase 3)

7 aus dem Code hergeleitete Domänen (nicht aus einer Vorgabe übernommen):

| Domäne | Faktoren |
|---|---|
| `market_structure` | structure, vwap_position |
| `momentum_trend` | momentum, trend_strength, trend_regime |
| `order_flow` | cvd, orderbook |
| `derivatives_leverage` | oi_price, positioning, funding, basis |
| `options` | options |
| `macro_liquidity` | macro |
| `sentiment` | sentiment |

Domain-Score = Ø der verfügbaren Faktoren je Domäne (verhindert Mehrfachzählung eines Phänomens). Implementiert in `experimental_domain_signal_state(factors jsonb)` — additiv, läuft parallel, schreibt nie in `market_states`.

## 4. Train/Validation/Test (Phase 5, wiederverwendet — nicht neu erstellt)

Einziges Intervall mit ausreichender lückenloser Historie für einen 3-Wege-Split: **1D, 251 Tage** (19.12.2025–26.08.2026, keine Lücken).

| Split | Zeitraum | n |
|---|---|---|
| TRAIN | 19.12.2025–18.05.2026 | 151 |
| VALIDATION | 19.05.–07.07.2026 | 50 |
| TEST | 08.07.–26.08.2026 | 50 |

Technisch durchgesetzt via `backtest_model_runs` (Tabelle) + `prevent_frozen_model_update()`-Trigger: ein als `is_frozen=true` markierter Modell-Run kann nicht mehr verändert werden (DB-Ebene, nicht nur Konvention — in Phase 5 per Test verifiziert).

4H (43 Tage, seit 15.07.2026) und 1H (12 Tage, seit 15.08.2026) sind beide lückenlos, aber zu kurz für einen eigenen 3-Wege-Split — bereits in Phase 5 als `INSUFFICIENT_DATA` für Kalibrierungszwecke dokumentiert, nicht erneut aufgeteilt.

## 5. Bestehende Walk-Forward-/Backtest-Funktionen (wiederverwendet)

| Funktion | Zweck |
|---|---|
| `backtest_reconstruct_states_v2(interval, from, to)` | Point-in-Time-sichere Rekonstruktion aller 14 Faktoren je historischer Kerze (asof-Joins, kein Look-ahead, pgTAP-verifiziert) |
| `backtest_hit_rate_by_horizon(...)`, `backtest_hit_rate_by_confidence(...)` | Hit-Rate/Forward-Return mit Baseline-Vergleich |
| `baseline_signal_state(factors)` | Model A, reine Spiegelung der Produktions-Aggregation |
| `experimental_domain_signal_state(factors)` | Model B, Domain-Mittelung |
| `calibrated_v1_signal_state(factors)` | Model C, TRAIN-gelernte Domain-Gewichte (nur 3 Domänen, mild regularisiert) |
| `backtest_populate_model_results(model_version)` | Schreibt Split-weise Kennzahlen nach `backtest_model_results` |
| 4 einfache Walk-Forward-Folds (Section 12, Phase 5) | 24h-Horizont, Model B — TRAIN/VALIDATION-Bereich, kein PIT-Verstoß (nach Korrektur des dokumentierten Zwischenfalls) |

## 6. Verifikation der defensiven Coverage-Regel (Section 5 der Phase-6-Vorgabe)

Geprüft (SQL, live): `MIN_COVERAGE_PCT=40` in `compute-market-state`, `experimental_domain_signal_state` verwendet dieselbe Schwelle (`< 0.4` auf Domain-Ebene), `calibrated_v1_signal_state` ebenso. Alle drei Modelle setzen bei Unterschreitung `overall_state='INSUFFICIENT_DATA'` und `confidence=0` — **keine** Pfad führt zu einem stillen `NEUTRAL` bei fehlenden Daten. Diese Regel wurde für Phase 6 **nicht verändert** (Vorgabe: "wenn bereits eine sinnvolle Regel existiert, dokumentiere sie und ändere sie nicht unnötig").

## 7. Bekannte, bereits verifizierte Einschränkungen (aus Phase 3–5, hier referenziert statt wiederholt)

- Nur 6 von 14 Faktoren sind auf 1D über die volle 251-Tage-Historie durchgehend verfügbar (structure, momentum, cvd, trend_strength, trend_regime, vwap_position). Die übrigen 8 haben in TRAIN+VALIDATION 1–9 von 251 Beobachtungen (Rohdatenquellen erst seit Mitte/Ende August 2026 aktiv).
- Confidence erreicht in TRAIN+VALIDATION nie einen Wert ≥50 (128/128 Beobachtungen im Bucket 0–50) — Confidence-Kalibrierung strukturell nicht testbar auf dieser Basis.
- VWAP-Schwellenwert ist unempfindlich gegenüber der Bandbreite (52–53% Hit-Rate über 0.15–1.0%); OI-Delta-Schwelle nicht testbar (5/251 Beobachtungen).
- Einziger in TRAIN sichtbarer Edge-Kandidat (BEARISH, 1 Woche, +9 bis +11pp) bricht in VALIDATION vollständig zusammen (Overfitting-Muster).
- Entscheidung aus Phase 5: **KEEP BASELINE**.

Dieses Dokument ist die Referenz-Grundlage für alle weiteren Phase-6-Forschungsmodule (`docs/research/`). Es wird nicht rückwirkend verändert; neue Erkenntnisse werden in separaten, datierten Folgedokumenten ergänzt.
