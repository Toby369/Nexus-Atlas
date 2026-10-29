"""RSI, MACD, ATR (TradingView-Formeln) und Pivot-Erkennung.

Pivots sind -- wie ta.pivothigh/ta.pivotlow -- erst `right` Kerzen nach dem
Extrem bekannt. Die Funktionen liefern den Wert deshalb am Index der
Bestaetigung, nicht am Index des Extrems.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    avg_gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    return 100 - 100 / (1 + avg_gain / avg_loss)


def macd_hist(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    line = ema(close, fast) - ema(close, slow)
    return line - ema(line, signal)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift()
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _pivot(values: np.ndarray, left: int, right: int, is_high: bool) -> np.ndarray:
    """Array gleicher Laenge; an Index i+right steht der Wert von Bar i, wenn
    Bar i strikt das Extrem im Fenster [i-left, i+right] war, sonst NaN."""
    n = len(values)
    out = np.full(n, np.nan)
    if n < left + right + 1:
        return out
    windows = np.lib.stride_tricks.sliding_window_view(values, left + right + 1)
    center = windows[:, left]
    others = np.delete(windows, left, axis=1)
    mask = (center[:, None] > others).all(axis=1) if is_high else (center[:, None] < others).all(axis=1)
    idx = np.nonzero(mask)[0]
    out[idx + left + right] = center[idx]
    return out


def pivot_high(high: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(np.asarray(high, dtype=float), left, right, True)


def pivot_low(low: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(np.asarray(low, dtype=float), left, right, False)
