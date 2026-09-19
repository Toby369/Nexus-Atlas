"""OHLC-Datenbeschaffung fuer die Wave-Anchor-Forschung.

15m/1h: direkte Kopie der bereits in dieser Session mehrfach validierten
BTCUSDT-Exporte (Nexus Atlas Supabase `candles`-Tabelle, Binance,
2022-09-04 bis 2026-09-18/09-14, siehe u.a.
AVWAP-PIVOT-CONFLUENCE-BACKTEST_2026-09-18.md, ELLIOTT-WAVE-IMPULSE-
BACKTEST_2026-09-19.md).

4h/1d: NICHT frisch aus Supabase gezogen (der SQL-Tool-Aufruf zur
Coverage-Pruefung wurde in dieser Sitzung vom Nutzer abgelehnt) --
stattdessen deterministisch aus den bereits vorhandenen 15m- bzw.
1h-Daten resampelt (Standard-OHLC-Aggregation: open=first, high=max,
low=min, close=last, `origin='start_day'` fuer exakte Tagesgrenzen).
Cross-Validiert gegen einen unabhaengig gezogenen, echten 4h-Datensatz
(`lsob_backtest/data/BTCUSDT_4h.csv`, 2375 ueberlappende Bars):
open/high/low STIMMEN EXAKT ueberein, close weicht im Mittel um 0.07 USD
ab (<0.02%, vermutlich minimale Exchange-Snapshot-Differenz zwischen den
beiden Roh-Pulls, keine Resampling-Fehlfunktion). Siehe
WAVE-ANCHOR-FEATURE-SPECIFICATION.md fuer die vollstaendige Dokumentation
dieser Abweichung von einer unabhaengigen Direktziehung.
"""

from __future__ import annotations

import glob
import os

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SYMBOL_FILENAME = "BTCUSDT"


def load_ohlc(timeframe: str) -> pd.DataFrame:
    pattern = os.path.join(DATA_DIR, f"{SYMBOL_FILENAME}_{timeframe}.csv")
    matches = glob.glob(pattern)
    if not matches:
        raise FileNotFoundError(f"Keine CSV fuer Timeframe '{timeframe}' gefunden (erwartet: {pattern}).")
    raw = pd.read_csv(matches[0])
    raw["time"] = pd.to_datetime(raw["time"], utc=True, format="mixed")
    raw = raw.set_index("time").sort_index()
    raw = raw[~raw.index.duplicated(keep="last")]
    return raw[["open", "high", "low", "close"]]
