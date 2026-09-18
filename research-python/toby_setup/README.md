# Toby Setup: Trailing-Exit-Backtest

Python-Port von Supabase-RPC `research_swing_setup_events()` (siehe
`docs/research/SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md`), notwendig weil die RPC pro Signal
einen teuren Lateral-Join macht und selbst kleine Zeitfenster am 60s-Tool-Timeout des
SQL-Interfaces scheitern. Ergebnisse siehe `docs/research/TOBY-SETUP-TRAILING-BACKTEST_2026-09-18.md`.

## Dateien

- `toby_setup_engine.py` — 1:1-Port der RPC-Logik (`run_toby_setup()`)
- `validate_against_swing_setup.py` — validiert den Port gegen die publizierten Zahlen aus dem
  SWING-SETUP-TRAILING-Report (gleicher Algorithmus, andere Parameter)
- `run_toby_setup.py` — Hauptlauf mit Tobys exakten Parametern (TP 1,5%/SL 0,5%/Trailing-
  Rücksetzer 0,5%, entspricht 20x Hebel, SL 10%/TP 30%/Rücksetzer 10% Marge)

## Daten

`data/BTCUSDT_15m_full.csv` (gitignored) — voller verfügbarer 15m-BTCUSDT-Datensatz aus Nexus
Atlas' Supabase-`candles`-Tabelle, 2022-09-04 bis 2026-09-18 (~4 Jahre, 141.668 Kerzen),
zusammengesetzt aus einer chunked SQL-Extraktion (älterer Teil) + der bereits vorhandenen CSV aus
`research-python/oms_backtest/data/BTCUSDT_15m.csv` (jüngerer Teil, 13 Monate).

## Ausführen

```bash
cd research-python/toby_setup
python3 validate_against_swing_setup.py   # Validierung (optional, ~2s)
python3 run_toby_setup.py                  # Hauptlauf (~7s), schreibt output/toby_setup_events_{long,short}.csv
```
