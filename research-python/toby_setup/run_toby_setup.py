"""Toby Setup Standard 2 (siehe ../TOBY_SETUP_STANDARDS.py -- "Toby Setup"
ist keine einzelne Definition, sondern 4 Standards mit fixem SL 10% und
variabler TP-Distanz; hier TP 30% = Standard 2, NICHT der Referenz-Standard
1 mit TP 35%): 20x Hebel, ~10 USDT Einsatz, SL 10%/TP 30% der Marge ->
SL 0.5%/TP 1.5% Kursbewegung (CRV 3:1). Trailing-Exit nach TP-Beruehrung:
10% Marge-Rueckgang vom bisherigen Hoch/Tief seit TP-Beruehrung -> 0.5%
Kursbewegung (Nutzer-Vorgabe 18.09.2026, "wie sl/tp als Hebelprozent").
Max. Haltedauer 192 Bars = 48h (gleiche Konvention wie die bisherigen
Toby-Setup-Backtests dieser Codebasis). Jede 15m-Kerze als Signal, LONG
und SHORT getrennt, voller verfuegbarer Datensatz (2022-09-04 bis
2026-09-18, ~4 Jahre).
"""
import time

import pandas as pd

from toby_setup_engine import events_to_dataframe, run_toby_setup

TP_PCT = 1.5
SL_PCT = 0.5
RETRACE_PCT = 0.5
VERTICAL_BARS = 192

df = pd.read_csv("data/BTCUSDT_15m_full.csv")
df["time"] = pd.to_datetime(df["time"], utc=True, format="mixed")
df = df.set_index("time").sort_index()
print(f"Datenbasis: {df.index[0]} bis {df.index[-1]}, {len(df)} Kerzen")

all_events = {}
for direction in ["LONG", "SHORT"]:
    t0 = time.time()
    events = run_toby_setup(df, direction, tp_pct=TP_PCT, sl_pct=SL_PCT, retrace_pct=RETRACE_PCT, vertical_bars=VERTICAL_BARS)
    edf = events_to_dataframe(events)
    all_events[direction] = edf
    edf.to_csv(f"output/toby_setup_events_{direction.lower()}.csv", index=False)
    print(f"\n{direction} ({time.time()-t0:.1f}s, n={len(edf)}):")
    summary = edf.groupby("outcome").agg(n=("outcome", "size"), avg_mfe=("mfe_pct", "mean"), avg_bars=("bars_to_resolution", "mean"))
    summary["pct"] = summary["n"] / len(edf) * 100
    summary["avg_hours"] = summary["avg_bars"] * 0.25
    print(summary[["n", "pct", "avg_mfe", "avg_hours"]].round(3))

print("\nFertig. Events gespeichert in output/toby_setup_events_{long,short}.csv")
