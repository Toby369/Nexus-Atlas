"""Stufe 2 des Toby-Setup-Phasen-Projekts (siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md): berechnet die kombinierte
Aufwaerts/Abwaerts/Seitwaerts-Phase (src.structural_phase) auf 1h-Bars ueber
den vollen verfuegbaren BTC/USDT-Datensatz (2022-09-04 bis 2026-09-18) und
zaehlt Bar-Anteile + Segment-Anzahl/-Dauer pro Phase. Reiner Zaehllauf --
das Verknuepfen mit den 15m-Setup-Events (bereits in tiered_mfe_engine.py
gebaut) ist der naechste Schritt, hier erstmal nur die Phasenverteilung
selbst.
"""
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # research-python/ Root fuer `src.*`-Importe

from src.features.mean_reversion import distance_to_ma_zscore
from src.features.momentum import adx
from src.features.trend import linreg_trend
from src.features.volatility import atr_ratio, bollinger_bands
from src.structural_phase import ALL_PHASES, classify_structural_phase

t0 = time.time()
df = pd.read_csv("data/BTCUSDT_1h.csv")
df["time"] = pd.to_datetime(df["time"], utc=True, format="mixed")
df = df.set_index("time").sort_index()
print(f"Datenbasis: {df.index[0]} bis {df.index[-1]}, {len(df)} 1h-Kerzen")

adx_df = adx(df, period=14)
trend_df = linreg_trend(df["close"], window=20)
bb_df = bollinger_bands(df["close"], window=20)
atrr = atr_ratio(df, period=14, sma_window=20)
distz = distance_to_ma_zscore(df["close"], window=50)

features = pd.DataFrame(
    {
        "adx": adx_df["adx"],
        "plus_di": adx_df["plus_di"],
        "minus_di": adx_df["minus_di"],
        "slope": trend_df["slope"],
        "bandwidth": bb_df["bandwidth"],
        "atr_ratio": atrr,
        "dist_zscore_sma50": distz,
    },
    index=df.index,
)

result = classify_structural_phase(features, df)
result.to_csv("output/phase_segmentation_1h.csv")

n_valid = len(result)
print(f"\nBerechnung: {time.time()-t0:.1f}s, {n_valid} Bars\n")

print("--- Bar-Anteile pro Phase (voller Datensatz) ---")
counts = result["phase"].value_counts().reindex(ALL_PHASES, fill_value=0)
pct = (counts / len(result) * 100).round(2)
for phase in ALL_PHASES:
    print(f"  {phase:<12} n={counts[phase]:>6}  ({pct[phase]:>5.2f}%)  = {counts[phase]*1:.0f}h")

# Segment-Analyse: zusammenhaengende Laeufe derselben Phase.
phase_series = result["phase"]
change = phase_series.ne(phase_series.shift())
segment_id = change.cumsum()
segments = phase_series.groupby(segment_id).agg(seg_phase="first", n_bars="size").reset_index(drop=True)
print(f"\n--- Segmente (zusammenhaengende Laeufe derselben Phase) ---")
print(f"Gesamtzahl Segmente: {len(segments)}")
seg_summary = segments.groupby("seg_phase")["n_bars"].agg(["count", "mean", "median", "max"]).reindex(ALL_PHASES)
seg_summary.columns = ["anzahl_segmente", "mittel_bars", "median_bars", "max_bars"]
seg_summary["mittel_stunden"] = seg_summary["mittel_bars"].round(1)
seg_summary["median_stunden"] = seg_summary["median_bars"]
print(seg_summary[["anzahl_segmente", "mittel_stunden", "median_stunden", "max_bars"]].round(1))

print("\nFertig. Volle Phasenreihe in output/phase_segmentation_1h.csv")
