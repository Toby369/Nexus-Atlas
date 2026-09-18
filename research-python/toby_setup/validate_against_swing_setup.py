"""Validiert toby_setup_engine.py gegen die PUBLIZIERTEN Ergebnisse aus
docs/research/SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md (gleicher
Algorithmus/RPC, andere Parameter: TP=1.75%, SL=0.5%, Retrace=0.25%,
192 Bars, 2024-09-04 bis 2026-09-04). Reproduziert der Python-Port diese
Zahlen, ist er als treuer Nachbau der SQL-RPC verifiziert.
"""
import time

import pandas as pd

from toby_setup_engine import events_to_dataframe, run_toby_setup

df = pd.read_csv("data/BTCUSDT_15m_full.csv")
df["time"] = pd.to_datetime(df["time"], utc=True, format="mixed")
df = df.set_index("time").sort_index()
df = df.loc["2024-09-04":"2026-09-04"]
print(f"Validierungsfenster: {df.index[0]} bis {df.index[-1]}, {len(df)} Kerzen")

for direction in ["LONG", "SHORT"]:
    t0 = time.time()
    events = run_toby_setup(df, direction, tp_pct=1.75, sl_pct=0.5, retrace_pct=0.25, vertical_bars=192)
    edf = events_to_dataframe(events)
    print(f"\n{direction} ({time.time()-t0:.1f}s, n={len(edf)}):")
    summary = edf.groupby("outcome").agg(n=("outcome", "size"), avg_mfe=("mfe_pct", "mean"), avg_bars=("bars_to_resolution", "mean"))
    summary["pct"] = summary["n"] / len(edf) * 100
    summary["avg_hours"] = summary["avg_bars"] * 0.25
    print(summary[["n", "pct", "avg_mfe", "avg_hours"]].round(3))
