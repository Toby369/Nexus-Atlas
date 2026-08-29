"""Macro/sentiment factors for BTC/USDT perpetuals (Phase 3, Säule 5).

Same causality guarantee as the other feature modules: every function only
reads data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_sentiment.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(series: pd.Series, name: str) -> None:
    if not series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def liquidation_cluster_density(
    liquidation_notional_usd: pd.Series,
    window: int = 6,
    baseline_window: int = 48,
    ddof: int = 1,
    min_periods: int | None = None,
) -> pd.Series:
    """Aggregated liquidation "cluster density": how unusually clustered
    recent liquidation notional is, relative to its own rolling baseline.

    Two stages, both strictly causal (trailing windows only):
      1. cluster_sum_t = rolling_sum(liquidation_notional_usd, window)_t
         -- total liquidated notional within the trailing `window` bars (a
         "cluster" of forced closures happening close together in time).
      2. density_t = z-score of cluster_sum_t against its own rolling
         mean/std over the longer `baseline_window` -- i.e. how large this
         cluster is relative to what's typical over `baseline_window` bars.

    A high positive density means an unusually large burst of liquidations
    just occurred (cascade-like); near 0 means normal background liquidation
    flow; very negative means an unusually *quiet* stretch.

    `liquidation_notional_usd` is expected to already be bar-aggregated (sum
    of `notional_usd` from `liquidation_events` per bar, 0 for bars with no
    liquidations -- NOT NaN, since "no liquidations this bar" is a real,
    informative zero, not missing data). Aggregating raw event-level
    timestamps onto a regular bar index is a data-preparation step left to
    the caller (mirrors how `funding_zscore`/`oi_volume_ratio` take an
    already bar-aligned series rather than raw ticks).

    Parameters
    ----------
    liquidation_notional_usd : pd.Series
        Per-bar summed liquidation notional (USD), 0 where none occurred,
        chronologically indexed.
    window : int
        Cluster window length in bars (default 6).
    baseline_window : int
        Baseline look-back length in bars for the z-score (default 48).
        Must be > `window`.
    ddof : int
        Delta degrees of freedom for the baseline std (default 1, sample
        stddev, matching `funding_zscore`/`cvd_zscore`).
    min_periods : int | None
        Minimum periods required for the baseline mean/std. Defaults to
        `baseline_window` (conservative -- no density value until a full
        baseline history exists).

    Returns
    -------
    pd.Series named "liq_cluster_density".
    """
    _assert_sorted_index(liquidation_notional_usd, "liquidation_cluster_density")
    if window < 1:
        raise ValueError("window must be a positive integer")
    if baseline_window <= window:
        raise ValueError("baseline_window must be strictly greater than window")
    if min_periods is None:
        min_periods = baseline_window

    cluster_sum = liquidation_notional_usd.rolling(
        window=window, min_periods=window, center=False
    ).sum()

    baseline = cluster_sum.rolling(window=baseline_window, min_periods=min_periods, center=False)
    mean = baseline.mean()
    std = baseline.std(ddof=ddof)

    density = (cluster_sum - mean) / std.replace(0, np.nan)
    return density.replace([np.inf, -np.inf], np.nan).rename("liq_cluster_density")


def net_taker_flow_ratio(
    taker_buy_vol: pd.Series,
    taker_sell_vol: pd.Series,
) -> pd.Series:
    """Net taker flow ratio: (buy - sell) / (buy + sell), in [-1, 1].

    +1 = 100% aggressive buying, -1 = 100% aggressive selling, 0 = balanced.
    A pointwise function (no rolling window) -- trivially causal, since each
    output only depends on same-bar inputs; the sorted-index check is kept
    for consistency with the rest of this package and to guard against a
    caller accidentally passing misaligned/unsorted series.

    Division-by-zero guarded: a bar with zero total taker volume produces
    NaN, not a fabricated 0 or +/-inf.

    Returns
    -------
    pd.Series named "net_taker_flow_ratio".
    """
    _assert_sorted_index(taker_buy_vol, "net_taker_flow_ratio (taker_buy_vol)")
    _assert_sorted_index(taker_sell_vol, "net_taker_flow_ratio (taker_sell_vol)")
    if not taker_buy_vol.index.equals(taker_sell_vol.index):
        raise ValueError("net_taker_flow_ratio: taker_buy_vol and taker_sell_vol must share the same index")

    total = taker_buy_vol + taker_sell_vol
    ratio = (taker_buy_vol - taker_sell_vol) / total.replace(0, np.nan)
    return ratio.rename("net_taker_flow_ratio")
