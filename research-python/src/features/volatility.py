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


def _require_hlc_columns(ohlc: pd.DataFrame) -> None:
    missing = {"high", "low", "close"} - set(ohlc.columns)
    if missing:
        raise ValueError(f"OHLC DataFrame is missing required columns: {sorted(missing)}")


def _wilder_ema(x: pd.Series, period: int) -> pd.Series:
    """Wilder's (1978) running-average smoothing -- see `momentum._wilder_smooth`
    for the full derivation/rationale (deliberately duplicated here, not
    imported, to keep `volatility.py` independent of `momentum.py`'s private
    internals: two small, independently-tested copies of a ~15-line recursion
    are preferable to a cross-module dependency on another module's
    underscore-prefixed helper).

    Returns NaN for all indices before the first full window of `period`
    consecutive non-NaN input values is available.
    """
    n = len(x)
    out = np.full(n, np.nan)
    values = x.to_numpy(dtype=float)

    if n < period:
        return pd.Series(out, index=x.index)

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
        out[t] = out[t - 1] + (values[t] - out[t - 1]) / period

    return pd.Series(out, index=x.index)


def true_range(ohlc: pd.DataFrame) -> pd.Series:
    """True Range: max(H_t - L_t, |H_t - C_{t-1}|, |L_t - C_{t-1}|).

    NaN at the first bar (no previous close to compare against).
    """
    _require_hlc_columns(ohlc)
    _assert_sorted_index(ohlc, "true_range")

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
    tr.iloc[0] = np.nan  # see momentum.adx's identical guard for the rationale
    return tr.rename("true_range")


def atr(ohlc: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range, Wilder-smoothed over `period` bars (default 14).

    atr_t = WilderSmooth(true_range, period)_t

    Returns
    -------
    pd.Series named "atr", NaN until the smoothing window is fully seeded.
    """
    tr = true_range(ohlc)
    return _wilder_ema(tr, period).rename("atr")


def atr_ratio(
    ohlc: pd.DataFrame,
    period: int = 14,
    sma_window: int = 20,
) -> pd.Series:
    """Normalized ATR-Ratio: current ATR relative to its own rolling SMA.

    ratio_t = ATR_t / SMA(ATR, sma_window)_t

    >1 means volatility is currently elevated relative to its recent average
    (`sma_window` bars); <1 means currently depressed (a "squeeze"-like
    condition). NaN-guarded division (an all-zero/NaN ATR average never
    fabricates an infinite ratio).

    Returns
    -------
    pd.Series named "atr_ratio".
    """
    atr_series = atr(ohlc, period=period)
    atr_sma = atr_series.rolling(window=sma_window, min_periods=sma_window, center=False).mean()
    ratio = atr_series / atr_sma.replace(0, np.nan)
    return ratio.rename("atr_ratio")


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
