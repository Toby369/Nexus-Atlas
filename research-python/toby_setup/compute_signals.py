"""Berechnet alle Signalgruppen aus docs/research/TOBY-SETUP-PHASEN-
DEFINITION.md ueber den vollen Datensatz:

- 15m-nativ (Momentum, Orderflow, Entry-Muster-Kerzenmuster): direkt auf
  der 15m-Setup-Universums-Aufloesung, kein Timeframe-Join noetig.
- 1H-nativ (GUSS): wie in der Produktion, spaeter per confirmed_asof_join
  (wave_anchor_research/mtf_join.py) auf die 15m-Entries gemappt --
  identisches Muster wie bereits fuer die Phase in join_phase_to_setups.py.

Ausgeschlossen (Zirkularitaet mit der Phasen-Konstruktion, siehe
Definitions-Dokument): structure/trend_strength/trend_regime-Faktoren,
rohe ADX/DI/Slope/Bandwidth-Werte, regime.py-Regime-Label,
swing_structure-Struktur-Label.
"""
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.features.momentum import adx, macd
from src.signals.candlestick_patterns import detect_candlestick_patterns
from src.signals.guss import compute_guss_signal
from src.signals.momentum_divergence import detect_momentum_divergence
from src.signals.orderflow import compute_orderflow_signals

t0 = time.time()

# --- 15m-nativ ---------------------------------------------------------
df15 = pd.read_csv("data/BTCUSDT_15m_full_with_volume.csv")
df15["time"] = pd.to_datetime(df15["time"], utc=True)
df15 = df15.set_index("time").sort_index()
print(f"15m-Datenbasis: {df15.index[0]} bis {df15.index[-1]}, {len(df15)} Bars")

adx15 = adx(df15, period=14)
macd15 = macd(df15["close"])
momentum_div = detect_momentum_divergence(adx15["adx"], adx15["plus_di"], adx15["minus_di"], macd15["macd_histogram"])
orderflow = compute_orderflow_signals(df15)
patterns = detect_candlestick_patterns(df15)

signals_15m = pd.concat(
    [momentum_div.rename("momentum_divergence"), orderflow, patterns], axis=1
)
signals_15m.to_csv("output/signals_15m.csv")
print(f"15m-Signale berechnet ({time.time()-t0:.1f}s): {list(signals_15m.columns)}")
print(signals_15m.mean(numeric_only=True).mul(100).round(3).astype(str) + "%")

# --- 1H-nativ (GUSS) -----------------------------------------------------
t1 = time.time()
df1h = pd.read_csv("data/BTCUSDT_1h.csv")
df1h["time"] = pd.to_datetime(df1h["time"], utc=True)
df1h = df1h.set_index("time").sort_index()

guss = compute_guss_signal(df1h, ema_period=50, swing_lookback=20)
guss.to_frame("guss_signal").to_csv("output/signals_1h.csv")
print(f"\n1H-GUSS-Signal berechnet ({time.time()-t1:.1f}s): n={len(guss)}, fires={guss.sum()} ({guss.mean()*100:.3f}%)")

print(f"\nGesamt: {time.time()-t0:.1f}s. Ausgabe in output/signals_15m.csv, output/signals_1h.csv")
