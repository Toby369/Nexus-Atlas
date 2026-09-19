"""Orchestriert den Elliott-Wave-Reversal-Backtest gegen alle 4 Toby-Setup-
Standards (siehe config.py TOBY_STANDARDS -- "Toby Setup" ist mehrdeutig
ohne Standard-Nummer, Korrektur 19.09.2026) auf 5m/15m/1h.

Aufruf:
    python run_backtest.py
"""
from __future__ import annotations

import os
import pickle
import time

import pandas as pd

from backtest import simulate_signals, trades_to_dataframe
from config import BacktestParams, DIRECTIONS, ElliottWaveParams, TIMEFRAMES, TOBY_STANDARDS
from data_loader import load_ohlcv
from elliott_wave_engine import run_elliott_wave_signals, signals_to_dataframe
from metrics import compute_bucket_metrics

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

_TF_MINUTES = {"5m": 5, "15m": 15, "1h": 60}


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    ew_params = ElliottWaveParams()
    bt_params = BacktestParams()

    all_metrics = []
    all_trades = {}
    all_signals = {}
    data_ranges = {}

    for tf in TIMEFRAMES:
        t0 = time.time()
        df = load_ohlcv(tf)
        data_ranges[tf] = (df.index[0], df.index[-1])
        print(f"[{tf}] {len(df)} Kerzen, {df.index[0]} bis {df.index[-1]}")

        signals = run_elliott_wave_signals(df, ew_params)
        print(f"[{tf}] {len(signals)} Signale gefunden ({time.time()-t0:.1f}s)")
        all_signals[tf] = signals

        t1 = time.time()
        for direction in DIRECTIONS:
            dir_signals = [s for s in signals if s.direction == direction]
            for std_num, standard in TOBY_STANDARDS.items():
                trades = simulate_signals(df, dir_signals, bt_params, standard, tf_minutes=_TF_MINUTES[tf])
                all_trades[(tf, direction, std_num)] = trades
                m = compute_bucket_metrics(tf, direction, std_num, trades, bt_params.initial_equity)
                all_metrics.append(m)
                print(
                    f"  {direction} / Standard {std_num} (TP {standard.tp_pct}%): {m.trades} Trades, "
                    f"Winrate {m.winrate_pct:.1f}%, Total Return {m.total_return_pct:.1f}%, PF {m.profit_factor:.2f}"
                )
        print(f"[{tf}] Simulation fertig ({time.time()-t1:.1f}s)")

    print("Exportiere Signale + Trades ...")
    for tf in TIMEFRAMES:
        signals_to_dataframe(all_signals[tf]).to_csv(os.path.join(OUTPUT_DIR, f"signals_{tf}.csv"), index=False)
        rows = []
        for direction in DIRECTIONS:
            for std_num in TOBY_STANDARDS:
                tdf = trades_to_dataframe(all_trades[(tf, direction, std_num)])
                if not tdf.empty:
                    tdf = tdf.copy()
                    tdf["standard"] = std_num
                    rows.append(tdf)
        combined = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
        combined.to_csv(os.path.join(OUTPUT_DIR, f"trades_{tf}.csv"), index=False)

    with open(os.path.join(OUTPUT_DIR, "_metrics.pkl"), "wb") as f:
        pickle.dump({"metrics": all_metrics, "data_ranges": data_ranges}, f)

    print("Fertig.")


if __name__ == "__main__":
    main()
