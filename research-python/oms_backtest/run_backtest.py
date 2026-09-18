"""Orchestriert den kompletten "Old Money Stack"-Backtest: Daten laden ->
Signale erzeugen -> Trades simulieren -> Kennzahlen -> Report/Charts/CSV.

Aufruf:
    python run_backtest.py [--source csv|ccxt]

Erwartet bei --source csv (Default) die Dateien
data/BTCUSDT_1m.csv, data/BTCUSDT_5m.csv
(siehe README, Abschnitt "Eigene Daten einspielen").
"""

from __future__ import annotations

import argparse
import os

from backtest import clear_resolve_exit_cache, simulate_bucket
from config import BacktestParams, DIRECTIONS, OmsParams, TIMEFRAMES
from data_loader import load_ohlcv
from metrics import compute_bucket_metrics
from oms_engine import run_oms
from report import export_trades_csv, plot_equity_curves, write_report_md

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def main(source: str = "csv") -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    oms_params = OmsParams()
    bt_params = BacktestParams()

    all_metrics = []
    trades_by_bucket = {}
    data_ranges = {}

    for tf in TIMEFRAMES:
        clear_resolve_exit_cache()  # Cache-Schluessel nutzt id(df)+len(df) -- explizit trennen zwischen Timeframes.
        print(f"[{tf}] lade Daten ({source}) ...")
        df = load_ohlcv(tf, source=source)
        data_ranges[tf] = (df.index[0], df.index[-1])
        print(f"[{tf}] {len(df)} Kerzen, {df.index[0]} bis {df.index[-1]}")

        signals = run_oms(df, oms_params)
        print(f"[{tf}] {len(signals)} Ausbruchs-Signale gefunden.")

        for direction in DIRECTIONS:
            dir_signals = [s for s in signals if s.direction == direction]
            trades = simulate_bucket(df, dir_signals, bt_params)
            trades_by_bucket[(tf, direction)] = trades
            m = compute_bucket_metrics(tf, direction, trades, bt_params.initial_equity)
            all_metrics.append(m)

            print(
                f"  {direction}: {m.trades} Trades, Winrate {m.winrate_pct:.1f}%, "
                f"Return {m.total_return_pct:.1f}%"
            )

    print("Exportiere Trade-CSVs ...")
    export_trades_csv(trades_by_bucket, OUTPUT_DIR)

    print("Erzeuge Equity-Kurven-Chart ...")
    chart_path = os.path.join(OUTPUT_DIR, "equity_curves.png")
    plot_equity_curves(trades_by_bucket, bt_params.initial_equity, chart_path)

    print("Schreibe backtest_report.md ...")
    report_path = os.path.join(OUTPUT_DIR, "backtest_report.md")
    write_report_md(
        all_metrics, trades_by_bucket, oms_params, bt_params, data_ranges, report_path,
        equity_chart_relpath="equity_curves.png",
    )

    print(f"Fertig. Ergebnisse liegen in: {OUTPUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["csv", "ccxt"], default="csv")
    args = parser.parse_args()
    main(source=args.source)
