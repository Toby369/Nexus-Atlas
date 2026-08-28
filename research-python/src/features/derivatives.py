"""Derivatives-market factors for BTC/USDT perpetuals.

All functions are strictly causal: the value at index ``t`` is a function of
data at indices ``<= t`` only. None of them use ``.shift(-k)``, ``center=True``
rolling windows, or any other construct that would let information from
``t+1, t+2, ...`` leak into the value reported at ``t``. This is verified by
the look-ahead unit tests in ``tests/test_derivatives.py``.

Design choices that are *not* self-evident from the task spec are documented
explicitly below (ddof, min_periods, sign(0) handling) rather than picked
silently, per project convention: no undocumented magic numbers.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(series: pd.Series, name: str) -> None:
    """Guard against silently-wrong-order input, a common look-ahead source."""
    if not series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological). "
            "A misordered index can silently leak future values into rolling "
            "windows without raising any error."
        )


def funding_zscore(
    funding_rate: pd.Series,
    window: int = 90,
    ddof: int = 1,
    min_periods: int | None = None,
) -> pd.Series:
    """Rolling Z-Score of the funding rate over ``window`` periods (8h funding => w=90 ~ 30 days).

    z_t = (FR_t - mean(FR_[t-window+1 .. t])) / std(FR_[t-window+1 .. t])

    Only the window ending *at and including* t is used (pandas' default,
    non-centered rolling window) -- this is not look-ahead: the value being
    scored (FR_t) is itself already known at time t, only *future* values
    (t+1, t+2, ...) would constitute look-ahead, and they are never touched.

    Parameters
    ----------
    funding_rate : pd.Series
        Funding rate per 8h period, chronologically indexed.
    window : int
        Rolling window length in periods. Default 90 (as specified).
    ddof : int
        Delta degrees of freedom for the rolling std. Default 1 (sample
        stddev, pandas' natural default) -- documented explicitly since this
        is a common silent-divergence source between implementations.
    min_periods : int | None
        Minimum periods required before a value is produced. Defaults to
        ``window`` (i.e. no z-score until a full historical window exists) --
        a deliberately conservative choice ("nur historische Fenster nutzen"),
        not the pandas default of 1.

    Returns
    -------
    pd.Series
        Z-score, NaN for the first ``min_periods - 1`` observations.
    """
    _assert_sorted_index(funding_rate, "funding_zscore")
    if min_periods is None:
        min_periods = window

    rolling = funding_rate.rolling(window=window, min_periods=min_periods, center=False)
    mean = rolling.mean()
    std = rolling.std(ddof=ddof)

    z = (funding_rate - mean) / std
    return z.replace([np.inf, -np.inf], np.nan).rename("funding_zscore")


def funding_persistence(funding_rate: pd.Series) -> pd.Series:
    """Count of consecutive periods with an identical, non-zero sign(FR_t).

    Definition (explicit, since the spec does not define the sign(0) edge
    case): a funding rate of exactly 0 breaks the streak and resets the
    counter to 0 for that period -- it is neither "positive" nor "negative"
    persistence. The counter itself is fully causal: persistence[t] only
    depends on sign(FR_1..t]).

    Returns
    -------
    pd.Series (int, NaN where funding_rate itself is NaN)
        1 for the first period of a new-sign streak, 2 for the second, ...
    """
    _assert_sorted_index(funding_rate, "funding_persistence")

    sign = np.sign(funding_rate)

    # A new streak starts whenever the sign differs from the previous period's
    # sign (or the previous value was NaN). Using cumsum-of-breaks + groupby is
    # the standard vectorized (and still fully causal) way to compute a
    # "consecutive count" without an explicit Python loop.
    is_new_streak = (sign != sign.shift(1)) | sign.shift(1).isna()
    streak_id = is_new_streak.cumsum()

    persistence = sign.groupby(streak_id).cumcount() + 1

    # Zero-sign periods (and NaN funding rate periods) have no persistence.
    persistence = persistence.where(sign != 0, other=0)
    persistence = persistence.where(funding_rate.notna(), other=np.nan)

    return persistence.rename("funding_persistence")


def oi_volume_ratio(
    open_interest_usd: pd.Series,
    volume: pd.Series,
    window: int = 24,
    min_periods: int | None = None,
) -> pd.Series:
    """Open Interest (USD) divided by the rolling moving average of volume.

    ratio_t = OI_t / mean(volume_[t-window+1 .. t])

    ``window`` is expressed in **bars**, not hours. The literal "rolling 24h
    moving average" from the spec assumes hourly bars; if the input series is
    not hourly, pass the correct ``window`` for your bar interval explicitly
    (e.g. window=6 for 4h bars) rather than relying on an implicit "24"
    default that would silently mean something else.

    Parameters
    ----------
    open_interest_usd : pd.Series
        Open interest in USD, same index as ``volume``.
    volume : pd.Series
        Traded volume per bar.
    window : int
        Rolling window length in bars for the volume moving average.
    min_periods : int | None
        Defaults to ``window`` (no ratio until a full historical window of
        volume data exists).

    Returns
    -------
    pd.Series
        OI / rolling average volume. NaN where the rolling average volume is
        NaN or exactly 0 (division-by-zero guarded, not fabricated as inf).
    """
    _assert_sorted_index(open_interest_usd, "oi_volume_ratio (open_interest_usd)")
    _assert_sorted_index(volume, "oi_volume_ratio (volume)")
    if not open_interest_usd.index.equals(volume.index):
        raise ValueError("oi_volume_ratio: open_interest_usd and volume must share the same index")

    if min_periods is None:
        min_periods = window

    avg_volume = volume.rolling(window=window, min_periods=min_periods, center=False).mean()
    ratio = open_interest_usd / avg_volume.replace(0, np.nan)
    return ratio.rename("oi_volume_ratio")
