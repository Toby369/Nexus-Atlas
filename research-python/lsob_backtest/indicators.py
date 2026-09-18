"""MACD und RSI, Standard-TradingView-Formeln (nicht Teil der Pine-Datei --
Toby nutzt diese in der Praxis als zusaetzlichen Bestaetigungsfilter fuer
LSOB-Signale, siehe momentum_filter.py).
"""

from __future__ import annotations

import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Klassisches MACD (12/26/9): macd_line = EMA(fast) - EMA(slow),
    signal_line = EMA(macd_line, signal), histogram = macd_line - signal_line.
    """
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """RSI via Wilder-Glaettung (ewm mit alpha=1/period) -- die in der Praxis
    ueberall (u.a. TradingViews ta.rsi()) genutzte Naeherung von Wilders
    urspruenglicher RMA. NUR der allererste Wert (Index 0, wegen close.diff())
    ist NaN -- pandas' ewm(..., adjust=False) nimmt den ersten gueltigen
    Gain/Loss-Wert direkt als Startwert, es gibt KEINE `period`-lange NaN-
    Aufwaermphase danach. Die ersten paar Werte sind entsprechend noch nicht
    eingeschwungen (reagieren staerker auf die Anfangswerte als eine echte,
    lange laufende Glaettung) -- in diesem Projekt unkritisch, da LSOB-
    Signale durch die eigene Pivot-Bestaetigungsverzoegerung ohnehin nie so
    frueh im Datensatz auftreten (siehe momentum_filter.py).
    """
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))
