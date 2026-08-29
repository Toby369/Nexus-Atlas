"""Momentum/mean-reversion factors for BTC/USDT perpetuals (Phase 3, Säule 3).

Same causality guarantee as the other feature modules: every function only
reads data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_mean_reversion.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(series: pd.Series, name: str) -> None:
    if not series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def _wilder_ema(x: pd.Series, period: int) -> pd.Series:
    """Wilder's (1978) running-average smoothing -- see `momentum._wilder_smooth`
    for the full derivation/rationale. Deliberately duplicated (not imported)
    for the same reason given in `volatility._wilder_ema`: keeps this module
    independent of another module's private/underscore-prefixed internals.
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


def rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's (1978) Relative Strength Index, 14-period default.

    gain_t = max(close_t - close_{t-1}, 0)
    loss_t = max(close_{t-1} - close_t, 0)
    avg_gain_t = WilderSmooth(gain, period)_t
    avg_loss_t = WilderSmooth(loss, period)_t
    RS_t   = avg_gain_t / avg_loss_t
    RSI_t  = 100 - 100 / (1 + RS_t)

    Edge cases (explicit, since the textbook formula is undefined at them):
      - avg_loss_t == 0 and avg_gain_t > 0  -> RSI = 100 (pure up-moves, no
        losses to divide by -- this is the standard convention, matching the
        live TS `collect-candles.computeRsi` implementation).
      - avg_loss_t == 0 and avg_gain_t == 0 -> RSI = 50 (no movement at all
        over the window -- neither overbought nor oversold; NOT the same as
        "pure up-moves", so must be handled as its own case rather than
        falling into the avg_loss==0 branch above).

    Strictly causal: gain/loss use only `close_t` and `close_{t-1}`; Wilder
    smoothing is a backward-looking recursion.

    Returns
    -------
    pd.Series named "rsi_14" (or "rsi_<period>" for a non-default period),
    NaN until the smoothing window is fully seeded.
    """
    _assert_sorted_index(close, "rsi_wilder")
    if period < 1:
        raise ValueError("period must be a positive integer")

    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    # The first bar has no previous close; delta/gain/loss are already NaN
    # there via .diff(), which _wilder_ema correctly treats as "not yet a
    # full valid window" rather than a spurious zero-move bar.

    avg_gain = _wilder_ema(gain, period)
    avg_loss = _wilder_ema(loss, period)

    rsi = pd.Series(np.nan, index=close.index)
    both_zero = (avg_gain == 0) & (avg_loss == 0)
    loss_zero_only = (avg_loss == 0) & (avg_gain > 0)
    normal = avg_loss > 0

    rsi[both_zero] = 50.0
    rsi[loss_zero_only] = 100.0
    rs = avg_gain[normal] / avg_loss[normal]
    rsi[normal] = 100.0 - 100.0 / (1.0 + rs)

    return rsi.rename(f"rsi_{period}")


def distance_to_ma_zscore(
    price: pd.Series,
    window: int,
    ddof: int = 0,
) -> pd.Series:
    """Z-score of price's distance from its own rolling simple moving average.

    z_t = (price_t - SMA(price, window)_t) / STD(price, window)_t

    A positive z means price is currently `z` rolling-standard-deviations
    above its own `window`-bar mean (stretched to the upside, a classic
    mean-reversion "extended" signal); negative means stretched to the
    downside. `ddof=0` (population std) by default -- same convention as
    `volatility.bollinger_bands`, documented explicitly rather than left as
    an implicit pandas default (ddof=1).

    Strictly causal: SMA/STD at t use only price_[t-window+1 .. t].

    Returns
    -------
    pd.Series named "dist_zscore_sma<window>", NaN until a full window of
    history exists (or where the rolling std is exactly 0, division-by-zero
    guarded rather than fabricating +/-inf).
    """
    _assert_sorted_index(price, "distance_to_ma_zscore")
    if window < 2:
        raise ValueError("window must be >= 2 (a standard deviation needs >= 2 points)")

    rolling = price.rolling(window=window, min_periods=window, center=False)
    sma = rolling.mean()
    std = rolling.std(ddof=ddof)

    z = (price - sma) / std.replace(0, np.nan)
    return z.rename(f"dist_zscore_sma{window}")


def distance_to_ma_zscore_multi(
    price: pd.Series,
    windows: tuple[int, ...] = (20, 50, 200),
    ddof: int = 0,
) -> pd.DataFrame:
    """`distance_to_ma_zscore` for several MA windows at once (default: SMA20/50/200).

    Returns
    -------
    pd.DataFrame with one `dist_zscore_sma<window>` column per window.
    """
    return pd.DataFrame(
        {f"dist_zscore_sma{w}": distance_to_ma_zscore(price, window=w, ddof=ddof) for w in windows}
    )
