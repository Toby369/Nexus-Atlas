# Datenbank-Archiv (Parquet)

Am 12.10.2026 aus Supabase ausgelagert, um die Datenbank unter das 500-MB-Limit
des Free-Plans zu bringen. Die Zeilen wurden nach dem Export aus der Datenbank
geloescht; diese Dateien sind die einzige Kopie (Kerzen zusaetzlich jederzeit
neu von https://data.binance.vision ladbar).

| Datei | Quelle | Zeilen |
|---|---|---|
| `candles_binance_btcusdt_1m_2024-09-04_2026-09-27.parquet` | `candles`, interval `1m`, `open_time < 2026-09-28` | 1'085'760 |
| `candles_binance_btcusdt_5m_2022-09-04_2026-09-14.parquet` | `candles`, interval `5m` (einmaliger Research-Backfill) | 423'724 |
| `research_swing_setup_results.parquet` | `research_swing_setup_results` (komplett) | 140'160 |
| `research_triple_barrier_results.parquet` | `research_triple_barrier_results` (komplett) | 280'590 |
| `research_triple_barrier_context.parquet` | `research_triple_barrier_context` (komplett) | 280'590 |

Export per PostgREST (Spalten 1:1, `numeric` als float64, Zeitstempel als
ISO-Strings). Zeilenzahlen und Summen-Pruefwerte wurden gegen die Datenbank
abgeglichen.

In der Datenbank haelt der Cron-Job `purge-old-1m-candles-daily` die
1m-Kerzen auf die letzten 14 Tage (die App braucht davon nur ~2 Tage fuer CVD).

## `phase7/` – Aufraeumrunde Phase 7 (12.10.2026)

Vor dem Droppen der Tabellen exportiert (Plan: `docs/research/DB-AUFRAEUMEN_2026-10-12.md`
auf dem Aufraeum-Branch). Je Tabelle eine Parquet-Datei, `jsonb`-Spalten als
JSON-Text. Zeilenzahlen geprueft, Stichproben-Pruefsummen (`sum(id)`) stimmen.

| Tabelle | Zeilen |
|---|---|
| backtest_states | 28'309 |
| research_pattern_events | 41'762 |
| research_dc_events | 3'742 |
| market_commentary | 1'622 |
| report_runs / report_configs | 263 / 4 |
| backtest_model_results / backtest_model_runs | 162 / 9 |
| research_pattern_results_purged / research_model_results_purged | 258 / 140 |
| research_leakage_integrity_log / research_test_access_log | 54 / 1 |
| handelslage_snapshots, chart_narratives, market_state_narratives, signal_engine_snapshots, custom_query_runs, news_analysis_snapshots, youtube_overall_analyses | 7, 1, 4, 11, 1, 7, 2 |
| chart_vision_analyses (als `.json`, Tabelle ist nicht oeffentlich lesbar) | 7 |

Die Screenshots zu `chart_vision_analyses` liegen im Storage-Bucket
`chart-vision-screenshots` und sind nicht Teil dieses Archivs.

```python
import pandas as pd
df = pd.read_parquet("research-python/data/archive/candles_binance_btcusdt_1m_2024-09-04_2026-09-27.parquet")
```
