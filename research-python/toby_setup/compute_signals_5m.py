"""5m-Variante von compute_signals.py: berechnet die Momentum-/Orderflow-/
Entry-Muster-Signalgruppen auf der 5m-Setup-Universums-Aufloesung statt 15m.
GUSS bleibt 1H-nativ und unveraendert (output/signals_1h.csv wird bereits
von compute_signals.py erzeugt und ist timeframe-unabhaengig von der
Setup-Basis -- keine Neuberechnung noetig).
"""
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.features.momentum import adx, macd
from src.signals.candlestick_patterns import detect_candlestick_patterns
from src.signals.momentum_divergence import detect_momentum_divergence
from src.signals.orderflow import compute_orderflow_signals

t0 = time.time()

df5 = pd.read_csv("data/BTCUSDT_5m_full_with_volume.csv")
df5["time"] = pd.to_datetime(df5["time"], utc=True)
df5 = df5.set_index("time").sort_index()
print(f"5m-Datenbasis: {df5.index[0]} bis {df5.index[-1]}, {len(df5)} Bars")

adx5 = adx(df5, period=14)
macd5 = macd(df5["close"])
momentum_div = detect_momentum_divergence(adx5["adx"], adx5["plus_di"], adx5["minus_di"], macd5["macd_histogram"])
orderflow = compute_orderflow_signals(df5)
patterns = detect_candlestick_patterns(df5)

signals_5m = pd.concat(
    [momentum_div.rename("momentum_divergence"), orderflow, patterns], axis=1
)
signals_5m.to_csv("output/signals_5m.csv")
print(f"5m-Signale berechnet ({time.time()-t0:.1f}s): {list(signals_5m.columns)}")
print(signals_5m.mean(numeric_only=True).mul(100).round(3).astype(str) + "%")
