"""Trend factors for BTC/USDT perpetuals (Phase 3, Säule 1).

ADX/DMI already lives in ``momentum.py`` (Wilder's construction) -- this
module adds the second Säule-1 indicator, rolling linear-regression
slope/R², kept separate so ``momentum.py`` is not touched.

Same causality guarantee as the other feature modules: every function only
reads data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_trend.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(series: pd.Series, name: str) -> None:
    if not series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def linreg_trend(
    price: pd.Series,
    window: int = 20,
    min_periods: int | None = None,
) -> pd.DataFrame:
    """Rolling simple-linear-regression slope and R^2 of `price` over `window` bars.

    For each window ending at (and including) bar t, fits price ~ a + b*x
    where x = 0, 1, ..., window-1 is the in-window bar index (not a
    timestamp/epoch -- the window is assumed regularly spaced, matching the
    other rolling-window features in this package). Reports:

        slope_t : b, in price units per bar
        r2_t    : R^2 of the fit (== corr(price, x)^2 for simple linear
                  regression), in [0, 1]

    Implemented via the closed-form OLS estimator (not `scipy.stats.linregress`
    or `statsmodels.OLS` per window) for speed -- with a fixed, regularly
    spaced x this reduces to a single rolling covariance/variance computation,
    algebraically identical to a per-window least-squares fit but O(n) instead
    of O(n*window).

    Strictly causal: the window ending at t only uses bars <= t (pandas'
    default trailing/non-centered rolling window).

    Parameters
    ----------
    price : pd.Series
        Chronologically indexed price (or any other) series.
    window : int
        Number of bars in each regression window. Must be >= 2.
    min_periods : int | None
        Defaults to ``window`` (no value until a full window is available).

    Returns
    -------
    pd.DataFrame with columns: slope, r2
    """
    _assert_sorted_index(price, "linreg_trend")
    if window < 2:
        raise ValueError("window must be >= 2 (a line needs at least 2 points)")
    if min_periods is None:
        min_periods = window

    # x is a plain, monotonically increasing bar index (0, 1, 2, ...) sharing
    # price's index -- NOT rolled itself; `Rolling.cov`/`Rolling.corr` take a
    # plain Series as `other` and internally align it to each window.
    x = pd.Series(np.arange(len(price), dtype=float), index=price.index)

    roll_price = price.rolling(window=window, min_periods=min_periods, center=False)

    # Rolling covariance/variance of (price, in-window bar index).
    cov = roll_price.cov(x)
    var_x = x.rolling(window=window, min_periods=min_periods, center=False).var(ddof=1)

    slope = cov / var_x.replace(0, np.nan)

    # R^2 for simple linear regression == corr(price, x)^2.
    corr = roll_price.corr(x)
    r2 = corr**2

    return pd.DataFrame({"slope": slope, "r2": r2})
