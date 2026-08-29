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


# Same 4-quadrant scenario naming as the live `lib/marketContext.ts`
# `classifyMarketContext()` (kept in sync deliberately, so a research-side
# "long_buildup" means exactly the same thing as the live dashboard's) --
# this is a NEW, independent raw/continuous-feature version for Phase 3
# (oi_change_pct/price_change_pct as actual numeric features, not just a
# gated display label), it does not read from or modify `marketContext.ts`.
_OI_PRICE_QUADRANTS = ("long_buildup", "short_buildup", "short_covering", "long_unwind", "neutral")


def oi_price_change_matrix(
    open_interest: pd.Series,
    price: pd.Series,
    window: int,
    price_flat_threshold_pct: float = 0.0,
    oi_flat_threshold_pct: float = 0.0,
) -> pd.DataFrame:
    """OI-Change vs Price-Change Matrix: raw % changes plus the resulting quadrant.

    price_change_pct_t = 100 * (price_t - price_{t-window}) / price_{t-window}
    oi_change_pct_t     = 100 * (OI_t - OI_{t-window}) / OI_{t-window}

    Quadrant (mirrors `lib/marketContext.ts::classifyMarketContext`):
        price up   & OI up    -> "long_buildup"   (bullish: fresh long positioning)
        price down & OI up    -> "short_buildup"  (bearish: fresh short positioning)
        price up   & OI down  -> "short_covering" (bullish: shorts unwinding)
        price down & OI down  -> "long_unwind"    (bearish: longs unwinding)
        otherwise              -> "neutral"        (below the flat thresholds)

    "Up"/"down" are relative to +/- the respective flat threshold (0 by
    default, i.e. any nonzero move counts -- pass a nonzero
    `price_flat_threshold_pct`/`oi_flat_threshold_pct` to require a move
    larger than normal noise before it counts as directional, matching the
    live dashboard's timeframe-scaled thresholds if desired).

    Strictly causal: both pct-changes use `shift(window)` (backward-looking).

    Parameters
    ----------
    open_interest, price : pd.Series
        Same DatetimeIndex, chronologically sorted.
    window : int
        Look-back length in bars for both pct-changes.
    price_flat_threshold_pct, oi_flat_threshold_pct : float
        Minimum absolute %-change (in percentage points, e.g. 0.5 for 0.5%)
        required to count as "up"/"down" rather than flat. Must be >= 0.

    Returns
    -------
    pd.DataFrame with columns: price_change_pct, oi_change_pct, quadrant
    """
    _assert_sorted_index(open_interest, "oi_price_change_matrix (open_interest)")
    _assert_sorted_index(price, "oi_price_change_matrix (price)")
    if not open_interest.index.equals(price.index):
        raise ValueError("oi_price_change_matrix: open_interest and price must share the same index")
    if window <= 0:
        raise ValueError("window must be a positive integer")
    if price_flat_threshold_pct < 0 or oi_flat_threshold_pct < 0:
        raise ValueError("flat thresholds must be >= 0")

    price_ref = price.shift(window)
    oi_ref = open_interest.shift(window)

    price_change_pct = 100.0 * (price - price_ref) / price_ref.replace(0, np.nan)
    oi_change_pct = 100.0 * (open_interest - oi_ref) / oi_ref.replace(0, np.nan)

    price_up = price_change_pct > price_flat_threshold_pct
    price_down = price_change_pct < -price_flat_threshold_pct
    oi_up = oi_change_pct > oi_flat_threshold_pct
    oi_down = oi_change_pct < -oi_flat_threshold_pct

    quadrant = pd.Series(
        np.select(
            [
                price_up & oi_up,
                price_down & oi_up,
                price_up & oi_down,
                price_down & oi_down,
            ],
            ["long_buildup", "short_buildup", "short_covering", "long_unwind"],
            default="neutral",
        ),
        index=price.index,
    )
    # A missing change value (still inside the warm-up window) has no
    # determinable quadrant -- must not silently fall into "neutral", which
    # is a real classification, not a "not yet known" placeholder.
    quadrant = quadrant.where(price_change_pct.notna() & oi_change_pct.notna(), other=np.nan)

    return pd.DataFrame(
        {
            "price_change_pct": price_change_pct,
            "oi_change_pct": oi_change_pct,
            "quadrant": quadrant,
        }
    )


def cvd_zscore(
    cvd_delta: pd.Series,
    window: int = 48,
    ddof: int = 1,
    min_periods: int | None = None,
) -> pd.Series:
    """Rolling Z-Score of per-bar Cumulative-Volume-Delta (CVD delta), window=48 bars.

    z_t = (cvd_delta_t - mean(cvd_delta_[t-window+1 .. t])) / std(cvd_delta_[t-window+1 .. t])

    Promotes the ad hoc rolling-zscore pattern previously only used inline in
    `benchmark_production.py` into a reusable, independently tested feature
    function. Takes the already-computed per-bar CVD delta (2*taker_buy -
    volume, matching the live `collect-candles` Edge Function's definition)
    as input rather than recomputing it from raw taker-buy/volume columns --
    keeps this function agnostic to which venue/table CVD delta came from.

    Same z-score conventions as `funding_zscore`: ddof=1 (sample stddev),
    min_periods defaults to `window` (conservative -- no value until a full
    historical window exists).

    Returns
    -------
    pd.Series named "cvd_zscore".
    """
    _assert_sorted_index(cvd_delta, "cvd_zscore")
    if min_periods is None:
        min_periods = window

    rolling = cvd_delta.rolling(window=window, min_periods=min_periods, center=False)
    mean = rolling.mean()
    std = rolling.std(ddof=ddof)

    z = (cvd_delta - mean) / std.replace(0, np.nan)
    return z.replace([np.inf, -np.inf], np.nan).rename("cvd_zscore")
