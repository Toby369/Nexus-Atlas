"""Volatility factors for BTC/USDT perpetuals (OHLC-based).

Same causality guarantee as ``derivatives.py``: every function only reads
data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_volatility.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

_LN2_TERM = 2.0 * np.log(2.0) - 1.0  # Garman-Klass drift-correction constant


def _assert_sorted_index(df_or_series: pd.DataFrame | pd.Series, name: str) -> None:
    if not df_or_series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def _require_ohlc_columns(ohlc: pd.DataFrame) -> None:
    missing = {"open", "high", "low", "close"} - set(ohlc.columns)
    if missing:
        raise ValueError(f"OHLC DataFrame is missing required columns: {sorted(missing)}")


def garman_klass_volatility(
    ohlc: pd.DataFrame,
    window: int = 24,
    min_periods: int | None = None,
    annualize: bool = False,
    periods_per_year: float | None = None,
) -> pd.Series:
    """Rolling Garman-Klass realized volatility over ``window`` bars (default 24 = 24h on hourly bars).

    Per-bar variance estimator (Garman & Klass, 1980):

        gk_t = 0.5 * ln(H_t / L_t)^2 - (2*ln(2) - 1) * ln(C_t / O_t)^2

    Realized volatility over the rolling window is the square root of the
    **sum** (not mean) of the per-bar variance contributions -- the standard
    "realized variance" convention (variance is additive across
    approximately-independent sub-periods). This is a deliberate, documented
    choice: some libraries instead average the per-bar estimates, which
    produces a materially different (and not directly comparable) number.

    A single bar's ``gk_t`` can occasionally be negative (it is not a squared
    quantity by construction -- it is a difference of two squared log-ratio
    terms). Summed over a full window this is rare but not impossible for
    very low-range bars; the summed value is clipped at 0 before the square
    root, documented here rather than silently producing NaN or a fabricated
    positive number.

    Parameters
    ----------
    ohlc : pd.DataFrame
        Must contain columns "open", "high", "low", "close", chronologically indexed.
    window : int
        Rolling window length in bars.
    min_periods : int | None
        Defaults to ``window``.
    annualize : bool
        If True, multiply the result by sqrt(periods_per_year). Off by
        default -- annualization is a presentation choice, not baked in
        silently.
    periods_per_year : float | None
        Required if ``annualize=True`` (e.g. 24*365 for hourly bars).

    Returns
    -------
    pd.Series named "garman_klass_vol"
    """
    _require_ohlc_columns(ohlc)
    _assert_sorted_index(ohlc, "garman_klass_volatility")
    if annualize and periods_per_year is None:
        raise ValueError("annualize=True requires periods_per_year to be specified explicitly")
    if min_periods is None:
        min_periods = window

    log_hl = np.log(ohlc["high"] / ohlc["low"])
    log_co = np.log(ohlc["close"] / ohlc["open"])
    gk = 0.5 * log_hl**2 - _LN2_TERM * log_co**2

    windowed_sum = gk.rolling(window=window, min_periods=min_periods, center=False).sum()
    windowed_sum = windowed_sum.clip(lower=0.0)
    vol = np.sqrt(windowed_sum)

    if annualize:
        vol = vol * np.sqrt(periods_per_year)

    return vol.rename("garman_klass_vol")


def bollinger_bands(
    close: pd.Series,
    window: int = 20,
    num_std: float = 2.0,
    ddof: int = 0,
    min_periods: int | None = None,
) -> pd.DataFrame:
    """Standard Bollinger Bands: %B and Bandwidth, window=20, 2 std dev.

    - Middle band = rolling mean(close, window)
    - Upper/Lower = Middle +/- num_std * rolling std(close, window)
    - %B = (Close - Lower) / (Upper - Lower)
    - Bandwidth = (Upper - Lower) / Middle

    ``ddof=0`` (population std) is used by default -- matching the common
    charting-platform convention for Bollinger Bands -- documented explicitly
    rather than left as an implicit pandas default (which is ddof=1).

    Returns
    -------
    pd.DataFrame with columns: middle, upper, lower, percent_b, bandwidth
    """
    _assert_sorted_index(close, "bollinger_bands")
    if min_periods is None:
        min_periods = window

    rolling = close.rolling(window=window, min_periods=min_periods, center=False)
    middle = rolling.mean()
    std = rolling.std(ddof=ddof)

    upper = middle + num_std * std
    lower = middle - num_std * std
    band_range = (upper - lower).replace(0, np.nan)

    percent_b = (close - lower) / band_range
    bandwidth = band_range / middle.replace(0, np.nan)

    return pd.DataFrame(
        {
            "middle": middle,
            "upper": upper,
            "lower": lower,
            "percent_b": percent_b,
            "bandwidth": bandwidth,
        }
    )
