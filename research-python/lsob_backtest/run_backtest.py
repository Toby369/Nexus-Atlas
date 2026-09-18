"""Orchestriert den kompletten LSOB-Backtest: Daten laden -> Signale
erzeugen -> Trades simulieren -> Kennzahlen -> Report/Charts/CSV.

Aufruf:
    python run_backtest.py [--source csv|ccxt]

Erwartet bei --source csv (Default) die Dateien
data/BTCUSDT_15m.csv, data/BTCUSDT_1h.csv, data/BTCUSDT_4h.csv
(siehe README, Abschnitt "Eigene Daten einspielen").
"""

from __future__ import annotations

import argparse
import os

from backtest import simulate_bucket
from config import BacktestParams, DIRECTIONS, LsobParams, TIMEFRAMES
from data_loader import load_ohlcv
from lsob_engine import run_lsob
from metrics import compute_bucket_metrics
from momentum_filter import MomentumFilterParams, apply_macd_rsi_filter
from report import export_trades_csv, plot_equity_curves, plot_momentum_filter_comparison, write_report_md

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def main(source: str = "csv") -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    lsob_params = LsobParams()
    bt_params = BacktestParams()
    momentum_params = MomentumFilterParams()

    all_metrics = []
    filtered_metrics = []
    trades_by_bucket = {}
    filtered_trades_by_bucket = {}
    data_ranges = {}

    for tf in TIMEFRAMES:
        print(f"[{tf}] lade Daten ({source}) ...")
        df = load_ohlcv(tf, source=source)
        data_ranges[tf] = (df.index[0], df.index[-1])
        print(f"[{tf}] {len(df)} Kerzen, {df.index[0]} bis {df.index[-1]}")

        signals = run_lsob(df, lsob_params)
        filtered_signals = apply_macd_rsi_filter(df, signals, momentum_params)
        print(
            f"[{tf}] {len(signals)} Entry-Signale gefunden, "
            f"{len(filtered_signals)} davon MACD+RSI-bestätigt."
        )

        for direction in DIRECTIONS:
            dir_signals = [s for s in signals if s.direction == direction]
            trades = simulate_bucket(df, dir_signals, bt_params)
            trades_by_bucket[(tf, direction)] = trades
            m = compute_bucket_metrics(tf, direction, trades, bt_params.initial_equity)
            all_metrics.append(m)

            dir_filtered_signals = [s for s in filtered_signals if s.direction == direction]
            filtered_trades = simulate_bucket(df, dir_filtered_signals, bt_params)
            filtered_trades_by_bucket[(tf, direction)] = filtered_trades
            fm = compute_bucket_metrics(tf, direction, filtered_trades, bt_params.initial_equity)
            filtered_metrics.append(fm)

            print(
                f"  {direction}: alle={m.trades} Trades/Winrate {m.winrate_pct:.1f}%/"
                f"Return {m.total_return_pct:.1f}% | gefiltert={fm.trades} Trades/"
                f"Winrate {fm.winrate_pct:.1f}%/Return {fm.total_return_pct:.1f}%"
            )

    print("Exportiere Trade-CSVs ...")
    export_trades_csv(trades_by_bucket, OUTPUT_DIR)

    print("Erzeuge Equity-Kurven-Chart ...")
    chart_path = os.path.join(OUTPUT_DIR, "equity_curves.png")
    plot_equity_curves(trades_by_bucket, bt_params.initial_equity, chart_path)

    print("Erzeuge MACD+RSI-Filter-Vergleichs-Chart ...")
    filtered_chart_path = os.path.join(OUTPUT_DIR, "momentum_filter_equity.png")
    plot_momentum_filter_comparison(
        trades_by_bucket, filtered_trades_by_bucket, bt_params.initial_equity, filtered_chart_path
    )

    print("Schreibe backtest_report.md ...")
    report_path = os.path.join(OUTPUT_DIR, "backtest_report.md")
    write_report_md(
        all_metrics, lsob_params, bt_params, data_ranges, report_path,
        equity_chart_relpath="equity_curves.png",
        filtered_metrics=filtered_metrics,
        momentum_params=momentum_params,
        filtered_chart_relpath="momentum_filter_equity.png",
    )

    print(f"Fertig. Ergebnisse liegen in: {OUTPUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["csv", "ccxt"], default="csv")
    args = parser.parse_args()
    main(source=args.source)
