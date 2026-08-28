"""Momentum factors for BTC/USDT perpetuals.

Same causality guarantee as the other feature modules: every function only
reads data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_momentum.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(df_or_series: pd.DataFrame | pd.Series, name: str) -> None:
    if not df_or_series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def _require_ohlc_columns(ohlc: pd.DataFrame, needed=("high", "low", "close")) -> None:
    missing = set(needed) - set(ohlc.columns)
    if missing:
        raise ValueError(f"OHLC DataFrame is missing required columns: {sorted(missing)}")


def _wilder_smooth(x: pd.Series, period: int) -> pd.Series:
    """Welles Wilder's (1978) smoothing method, in running-average form.

    Classic Wilder smoothing is usually stated as a recursive *sum*:
        smoothed_1 = sum(x[0:period])
        smoothed_t = smoothed_{t-1} - smoothed_{t-1}/period + x_t

    This implementation uses the mathematically equivalent *average* form
    (each value pre-divided by ``period``), which is the more common modern
    formulation and lets +DI/-DI/ADX be computed as plain ratios without an
    extra rescale step:
        avg_1 = mean(x[0:period])                      (first full window)
        avg_t = avg_{t-1} + (x_t - avg_{t-1}) / period  (t > first window)

    This is explicitly NOT the same as ``pandas.Series.ewm(alpha=1/period,
    adjust=False)``, which seeds its first value from x[0] directly instead
    of from the mean of the first ``period`` values -- that difference
    matters for the first ``period`` bars and would not reproduce Wilder's
    original ADX numbers. Implemented as an explicit causal loop (not
    vectorized) because the recursion is inherently sequential/stateful.

    Returns NaN for all indices before the first full window is available.
    """
    n = len(x)
    out = np.full(n, np.nan)
    values = x.to_numpy(dtype=float)

    if n < period:
        return pd.Series(out, index=x.index)

    # Find the first window of `period` consecutive non-NaN values to seed on.
    # (In practice TR/DM/DX series only have leading NaNs from .diff()/.shift(),
    # so the first `period` values starting at the first fully-valid index work.)
    first_valid = 0
    while first_valid <= n - period and np.isnan(values[first_valid : first_valid + period]).any():
        first_valid += 1
    if first_valid > n - period:
        return pd.Series(out, index=x.index)

    seed_end = first_valid + period - 1
    avg = values[first_valid : first_valid + period].mean()
    out[seed_end] = avg

    for t in range(seed_end + 1, n):
        if np.isnan(values[t]) or np.isnan(out[t - 1]):
            out[t] = np.nan
            continue
        avg = out[t - 1] + (values[t] - out[t - 1]) / period
        out[t] = avg

    return pd.Series(out, index=x.index)


def adx(ohlc: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """Average Directional Index (ADX), 14-period, Welles Wilder smoothing.

    Standard Wilder (1978) construction:
      1. True Range:  TR_t   = max(H_t - L_t, |H_t - C_{t-1}|, |L_t - C_{t-1}|)
      2. Directional Movement:
           up_move   = H_t - H_{t-1}
           down_move = L_{t-1} - L_t
           +DM_t = up_move   if (up_move > down_move) and (up_move > 0)   else 0
           -DM_t = down_move if (down_move > up_move) and (down_move > 0) else 0
      3. Wilder-smooth TR, +DM, -DM over `period`  (see _wilder_smooth)
      4. +DI_t = 100 * smoothed(+DM)_t / smoothed(TR)_t
         -DI_t = 100 * smoothed(-DM)_t / smoothed(TR)_t
      5. DX_t  = 100 * |+DI_t - -DI_t| / (+DI_t + -DI_t)
      6. ADX_t = Wilder-smooth(DX)_t over `period`

    All six steps are causal by construction (TR/DM use only t and t-1;
    Wilder smoothing is a backward-looking recursion; DI/DX are pointwise
    functions of already-causal series).

    Returns
    -------
    pd.DataFrame with columns: plus_di, minus_di, dx, adx
    """
    _require_ohlc_columns(ohlc)
    _assert_sorted_index(ohlc, "adx")

    high, low, close = ohlc["high"], ohlc["low"], ohlc["close"]
    prev_close = close.shift(1)

    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    # DataFrame.max(axis=1) uses skipna=True by default, so at index 0 (where
    # prev_close is NaN) it silently falls back to just `high-low` instead of
    # propagating NaN -- True Range is undefined without a previous close, so
    # this must be forced to NaN explicitly (mirrors the +DM/-DM handling
    # below). Left as pandas' default this shifts the Wilder-smoothing seed
    # window by one bar in _wilder_smooth (caught by
    # tests/test_momentum.py::TestAdxCorrectness via the independent
    # reference implementation).
    tr.iloc[0] = np.nan

    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=ohlc.index
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=ohlc.index
    )
    # The very first bar has no t-1 reference; diff()/shift() already produce
    # NaN there, keep it NaN (not 0) so it is not silently counted as "no move".
    plus_dm.iloc[0] = np.nan
    minus_dm.iloc[0] = np.nan

    smoothed_tr = _wilder_smooth(tr, period)
    smoothed_plus_dm = _wilder_smooth(plus_dm, period)
    smoothed_minus_dm = _wilder_smooth(minus_dm, period)

    safe_tr = smoothed_tr.replace(0, np.nan)
    plus_di = 100.0 * smoothed_plus_dm / safe_tr
    minus_di = 100.0 * smoothed_minus_dm / safe_tr

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / di_sum

    adx_value = _wilder_smooth(dx, period)

    return pd.DataFrame(
        {
            "plus_di": plus_di,
            "minus_di": minus_di,
            "dx": dx,
            "adx": adx_value,
        }
    )


def log_return(price: pd.Series, periods: int) -> pd.Series:
    """Log return over `periods` bars: ln(P_t / P_{t-periods}).

    Strictly causal: uses ``shift(periods)`` (looking *backward*), never
    ``shift(-periods)``.
    """
    _assert_sorted_index(price, "log_return")
    if periods <= 0:
        raise ValueError("periods must be a positive integer (a look-back length)")
    return np.log(price / price.shift(periods)).rename(f"log_return_{periods}")


def return_momentum(
    price: pd.Series,
    bar_interval_hours: float = 1.0,
    horizons_hours: tuple[float, ...] = (1.0, 4.0, 24.0),
) -> pd.DataFrame:
    """Log-return momentum over 1h/4h/24h (default), expressed in bars.

    ``horizons_hours`` are converted to an integer number of bars via
    ``round(horizon_hours / bar_interval_hours)``. The default 1h/4h/24h
    horizons assume hourly bars (bar_interval_hours=1.0); pass the correct
    ``bar_interval_hours`` explicitly for any other bar frequency rather than
    relying on an implicit "hourly" assumption.

    Returns
    -------
    pd.DataFrame with one log_return_<Nh> column per horizon.
    """
    _assert_sorted_index(price, "return_momentum")

    out = {}
    for h in horizons_hours:
        periods = round(h / bar_interval_hours)
        if periods <= 0:
            raise ValueError(
                f"horizon {h}h resolves to {periods} bars at bar_interval_hours="
                f"{bar_interval_hours} -- must be >= 1 bar"
            )
        out[f"log_return_{h:g}h"] = log_return(price, periods)

    return pd.DataFrame(out)
