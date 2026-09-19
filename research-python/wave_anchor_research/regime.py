"""Regime-Klassifizierung (Aufgabenstellung Abschnitt 14) -- VOR jeder
Ergebnis-Betrachtung festgelegte, deterministische Methodik (kein
Cherry-Picking). Auf 1D-Daten berechnet, look-ahead-sicher per
`confirmed_asof_join` auf die LTF-Zeitachse projiziert -- derselbe
Mechanismus wie fuer alle anderen HTF-Groessen dieser Forschung.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TREND_SMA_WINDOW = 50
TREND_SLOPE_LOOKBACK = 10
VOL_WINDOW = 20


def compute_daily_regimes(daily_df: pd.DataFrame) -> pd.DataFrame:
    """trend_regime (BULL/BEAR/SIDEWAYS) + vol_regime (LOW/MID/HIGH,
    Terzile ueber die volle verfuegbare 1D-Historie) je 1D-Bar."""
    close = daily_df["close"]
    sma = close.rolling(window=TREND_SMA_WINDOW, min_periods=TREND_SMA_WINDOW).mean()
    sma_slope = sma - sma.shift(TREND_SLOPE_LOOKBACK)

    trend = pd.Series(
        np.select(
            [(close > sma) & (sma_slope > 0), (close < sma) & (sma_slope < 0)],
            ["BULL", "BEAR"],
            default="SIDEWAYS",
        ),
        index=daily_df.index,
    ).astype(object).where(sma.notna() & sma_slope.notna(), other=None)

    log_ret = np.log(close / close.shift(1))
    realized_vol = log_ret.rolling(window=VOL_WINDOW, min_periods=VOL_WINDOW).std()
    valid_vol = realized_vol.dropna()
    vol_regime = pd.Series(index=daily_df.index, dtype=object)
    if len(valid_vol) >= 3:
        terciles = pd.qcut(valid_vol, q=3, labels=["LOW", "MID", "HIGH"])
        vol_regime.loc[valid_vol.index] = terciles.astype(object)

    return pd.DataFrame({"trend_regime": trend, "vol_regime": vol_regime}, index=daily_df.index)
