"""Fuehrt die CRV-Walk-Forward-Validierung (1:1.5 / 1:2 / 1:3) auf allen drei
Timeframes x Richtungen aus und schreibt crv_walk_forward_report.md +
Equity-Chart nach output/.

Aufruf: python run_crv_walk_forward.py [--source csv|ccxt]
"""

from __future__ import annotations

import argparse
import os

from backtest import clear_resolve_exit_cache
from config import BacktestParams, DIRECTIONS, LsobParams, TIMEFRAMES
from crv_walk_forward import CRV_CANDIDATES, run_crv_walk_forward, run_fixed_crv_oos_baseline
from crv_walk_forward_report import plot_crv_walk_forward_curves, write_crv_walk_forward_report
from data_loader import load_ohlcv
from lsob_engine import run_lsob

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def main(source: str = "csv") -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    lsob_params = LsobParams()
    initial_equity = BacktestParams().initial_equity

    results_by_bucket = {}
    baselines_by_bucket = {}

    for tf in TIMEFRAMES:
        clear_resolve_exit_cache()  # neuer Timeframe -> neues df, alter Cache ist irrelevant
        print(f"[{tf}] lade Daten ({source}) ...")
        df = load_ohlcv(tf, source=source)
        signals = run_lsob(df, lsob_params)
        print(f"[{tf}] {len(signals)} Entry-Signale.")

        for direction in DIRECTIONS:
            dir_signals = [s for s in signals if s.direction == direction]
            result = run_crv_walk_forward(df, dir_signals, timeframe=tf, direction=direction)
            results_by_bucket[(tf, direction)] = result
            selected = [f.selected_crv for f in result.folds]
            print(f"  {direction}: gewaehlte CRV je Fold = {selected}, OOS-Trades gesamt = {len(result.oos_trades_chained)}")

            fold_boundaries = [(f.test_start, f.test_end) for f in result.folds]
            baselines_by_bucket[(tf, direction)] = {
                crv: run_fixed_crv_oos_baseline(df, dir_signals, crv, fold_boundaries) for crv in CRV_CANDIDATES
            }

    print("Erzeuge Equity-Kurven-Chart ...")
    chart_path = os.path.join(OUTPUT_DIR, "crv_walk_forward_equity.png")
    plot_crv_walk_forward_curves(results_by_bucket, baselines_by_bucket, initial_equity, chart_path)

    print("Schreibe crv_walk_forward_report.md ...")
    report_path = os.path.join(OUTPUT_DIR, "crv_walk_forward_report.md")
    write_crv_walk_forward_report(
        results_by_bucket, baselines_by_bucket, initial_equity, report_path,
        chart_relpath="crv_walk_forward_equity.png",
    )

    print(f"Fertig. Ergebnisse liegen in: {OUTPUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["csv", "ccxt"], default="csv")
    args = parser.parse_args()
    main(source=args.source)
