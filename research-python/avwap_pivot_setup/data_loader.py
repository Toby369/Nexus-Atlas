"""OHLCV-Datenbeschaffung. CSV-Dateien aus Nexus Atlas' Supabase-
`candles`-Tabelle exportiert (chunked string_agg-Extraktion, wie in den
anderen Projekten dieser Session), inkl. Volumen (fuer AVWAP benoetigt,
anders als lsob_backtest/oms_backtest, die kein Volumen brauchten).
"""

from __future__ import annotations

import glob
import os

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SYMBOL_FILENAME = "BTCUSDT"


def load_ohlcv(timeframe: str) -> pd.DataFrame:
    pattern = os.path.join(DATA_DIR, f"{SYMBOL_FILENAME}_{timeframe}.csv")
    matches = glob.glob(pattern)
    if not matches:
        raise FileNotFoundError(f"Keine CSV fuer Timeframe '{timeframe}' gefunden (erwartet: {pattern}).")
    raw = pd.read_csv(matches[0])
    raw["time"] = pd.to_datetime(raw["time"], utc=True, format="mixed")
    raw = raw.set_index("time").sort_index()
    raw = raw[~raw.index.duplicated(keep="last")]
    return raw[["open", "high", "low", "close", "volume"]]
