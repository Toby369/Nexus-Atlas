"""Referenz-Baseline-Features (Aufgabenstellung Abschnitt 11) -- reine
Kontrollgroessen, um zu pruefen, ob Wave-Anchor-Features ueber einfachen
Preis-Momentum-Wissen hinaus zusaetzlichen Informationsgehalt liefern.
NICHT fuer Nexus-Produktion gedacht (siehe Hard Constraint, Abschnitt 17
der Aufgabenstellung).

Standardformeln, keine exotischen Varianten:
- Momentum: einfache Rendite ueber ein festes Rueckblick-Fenster.
- EMA-Trend: Vorzeichen von EMA_kurz - EMA_lang (Standard 12/26, wie MACD).
- RSI: Wilder-Glaettung, Periode 14 (Standard).
- MACD: EMA12 - EMA26, Signal = EMA9 von MACD (Standard).
"""

from __future__ import annotations

import pandas as pd


def momentum(close: pd.Series, lookback_bars: int) -> pd.Series:
    return close / close.shift(lookback_bars) - 1.0


def ema_trend(close: pd.Series, fast: int = 12, slow: int = 26) -> pd.Series:
    ema_fast = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    return ema_fast - ema_slow


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    # Wilder-Glaettung == EWM mit alpha=1/period (com=period-1).
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "macd_signal": signal_line, "macd_hist": hist}, index=close.index)


def compute_all_baselines(df: pd.DataFrame, momentum_lookback_bars: int) -> pd.DataFrame:
    close = df["close"]
    macd_df = macd(close)
    return pd.DataFrame(
        {
            "baseline_momentum": momentum(close, momentum_lookback_bars),
            "baseline_ema_trend": ema_trend(close),
            "baseline_rsi": rsi(close),
            "baseline_macd_hist": macd_df["macd_hist"],
        },
        index=df.index,
    )
