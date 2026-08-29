"""Market State Matrix Engine (Phase 3, Punkt 2).

Fuses the signals of the 5 Feature-Engine Säulen (``src/features/``) into a
single, mutually-exclusive multi-dimensional market regime label. This
module does no rolling-window computation itself -- it is a pure, row-wise
classifier over an *already-computed* feature matrix (one row per bar,
columns produced by ``src.features.trend/volatility/mean_reversion/
derivatives/sentiment``). Because every input column is itself guaranteed
causal (see each feature module's own lookahead tests), and this classifier
only ever reads column values at row t to produce the label at row t (no
``shift(-k)``, no cross-row aggregation of its own), the regime label at t is
trivially free of look-ahead bias as well -- verified in
``tests/test_regime.py`` by re-running the classifier on a truncated feature
matrix and confirming identical historical labels (same technique as
``tests/lookahead_utils.py``, applied one layer up).

Regime taxonomy (5 labels, priority order = list order, first match wins):

1. HIGH_VOLA_REVERSION
   Volatility has spiked (`atr_ratio` well above its own recent average)
   *and* price is unusually far from its medium-term mean (`|dist_zscore_
   sma50| ` large) -- a classic exhaustion/reversion setup. Checked first
   because it can co-occur with a strong ADX reading (a violent move right
   before it reverses) and should take priority over "just" calling it a
   clean trend continuation.

2. TREND_EXPANSION_BULLISH / TREND_EXPANSION_BEARISH
   Directional trend strength (`adx`) is above the trend threshold, the
   dominant directional indicator agrees with the regression slope's sign
   (`plus_di`/`minus_di` vs `slope`) -- two independent Säule-1 signals
   confirming the same direction.

3. VOLA_SQUEEZE_RANGING
   Trend strength is below the range threshold *and* Bollinger Bandwidth has
   compressed below its own squeeze threshold -- low-ADX, tight-bands
   "coiling" conditions that often precede a breakout in either direction.

4. UNRESOLVED_NEUTRAL
   None of the above -- the default/fallback regime. Deliberately named
   "unresolved" rather than e.g. "neutral" alone, to make clear this is not
   a positive "the market is calm" signal but "the available signals do not
   agree on a regime" (mirrors the live pipeline's own INSUFFICIENT_DATA /
   defensive-fallback philosophy of never fabricating a confident label from
   ambiguous inputs).

A row with any required input missing (NaN) always classifies as
UNRESOLVED_NEUTRAL -- an ambiguous/incomplete read is never allowed to
silently resolve to a confident directional or squeeze regime.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

REGIME_HIGH_VOLA_REVERSION = "HIGH_VOLA_REVERSION"
REGIME_TREND_EXPANSION_BULLISH = "TREND_EXPANSION_BULLISH"
REGIME_TREND_EXPANSION_BEARISH = "TREND_EXPANSION_BEARISH"
REGIME_VOLA_SQUEEZE_RANGING = "VOLA_SQUEEZE_RANGING"
REGIME_UNRESOLVED_NEUTRAL = "UNRESOLVED_NEUTRAL"

ALL_REGIMES = (
    REGIME_HIGH_VOLA_REVERSION,
    REGIME_TREND_EXPANSION_BULLISH,
    REGIME_TREND_EXPANSION_BEARISH,
    REGIME_VOLA_SQUEEZE_RANGING,
    REGIME_UNRESOLVED_NEUTRAL,
)

REQUIRED_COLUMNS = ("adx", "plus_di", "minus_di", "slope", "bandwidth", "atr_ratio", "dist_zscore_sma50")


@dataclass(frozen=True)
class RegimeThresholds:
    """All magic numbers for `classify_market_regime`, named and in one place
    (project convention: no undocumented thresholds scattered through logic).

    Defaults are calibrated for BTC/USDT perpetuals on hourly bars -- pass
    an overridden instance for a different asset/timeframe rather than
    editing these in place.
    """

    adx_trend_threshold: float = 25.0
    """ADX >= this counts as "trending" (TREND_EXPANSION_*). Wilder's own
    original guidance (ADX > 25 = trending market) -- not arbitrary."""

    adx_range_threshold: float = 20.0
    """ADX < this counts as "non-trending" (a precondition for
    VOLA_SQUEEZE_RANGING). Intentionally lower than adx_trend_threshold
    (not simply its complement): the 20-25 band is a deliberate "undecided"
    gap where neither a trend nor a squeeze regime is asserted -- avoids a
    single noisy ADX print flipping the regime back and forth across one
    threshold."""

    atr_ratio_reversion_threshold: float = 1.5
    """atr_ratio (current ATR / 20-bar ATR average) above this counts as a
    volatility spike, a precondition for HIGH_VOLA_REVERSION."""

    dist_zscore_extension_threshold: float = 2.0
    """|dist_zscore_sma50| above this counts as "stretched" from the medium-
    term mean, the second precondition for HIGH_VOLA_REVERSION (two
    standard deviations, the conventional "statistically extended" cutoff)."""

    squeeze_bandwidth_threshold: float = 0.05
    """Bollinger Bandwidth ((upper-lower)/middle) below this counts as a
    "squeeze" -- the bands have compressed to within a 5% envelope of the
    middle band, a precondition for VOLA_SQUEEZE_RANGING."""


def classify_market_regime(
    features: pd.DataFrame,
    thresholds: RegimeThresholds | None = None,
) -> pd.Series:
    """Classify each row of `features` into one of the 5 `ALL_REGIMES` labels.

    Parameters
    ----------
    features : pd.DataFrame
        Must contain the columns in `REQUIRED_COLUMNS` (typically produced by
        concatenating the outputs of `src.features.trend.linreg_trend`,
        `src.features.volatility.bollinger_bands`/`atr_ratio`,
        `src.features.mean_reversion.distance_to_ma_zscore` for window=50,
        and `src.features.momentum.adx`). Chronologically indexed.
    thresholds : RegimeThresholds | None
        Defaults to `RegimeThresholds()`.

    Returns
    -------
    pd.Series of str, named "regime", one of `ALL_REGIMES` per row. Never
    NaN -- an incomplete/ambiguous row resolves to UNRESOLVED_NEUTRAL rather
    than propagating NaN.
    """
    missing = set(REQUIRED_COLUMNS) - set(features.columns)
    if missing:
        raise ValueError(f"features is missing required columns: {sorted(missing)}")
    if not features.index.is_monotonic_increasing:
        raise ValueError("classify_market_regime: index must be monotonically increasing (chronological).")

    t = thresholds or RegimeThresholds()

    adx = features["adx"]
    plus_di = features["plus_di"]
    minus_di = features["minus_di"]
    slope = features["slope"]
    bandwidth = features["bandwidth"]
    atr_ratio = features["atr_ratio"]
    dist_z = features["dist_zscore_sma50"]

    complete = features[list(REQUIRED_COLUMNS)].notna().all(axis=1)

    is_high_vola_reversion = (
        complete
        & (atr_ratio > t.atr_ratio_reversion_threshold)
        & (dist_z.abs() > t.dist_zscore_extension_threshold)
    )

    is_trend = complete & (adx >= t.adx_trend_threshold)
    is_trend_bullish = is_trend & (plus_di > minus_di) & (slope > 0) & ~is_high_vola_reversion
    is_trend_bearish = is_trend & (minus_di > plus_di) & (slope < 0) & ~is_high_vola_reversion

    is_squeeze = (
        complete
        & (adx < t.adx_range_threshold)
        & (bandwidth <= t.squeeze_bandwidth_threshold)
        & ~is_high_vola_reversion
    )

    regime = pd.Series(REGIME_UNRESOLVED_NEUTRAL, index=features.index, dtype=object)
    # Assigned in priority order -- later assignments would overwrite earlier
    # ones if a row matched more than one branch, so the *_high_vola_reversion
    # mask is subtracted (via ~is_high_vola_reversion above) from the lower-
    # priority branches instead of relying on assignment order alone.
    regime[is_squeeze] = REGIME_VOLA_SQUEEZE_RANGING
    regime[is_trend_bearish] = REGIME_TREND_EXPANSION_BEARISH
    regime[is_trend_bullish] = REGIME_TREND_EXPANSION_BULLISH
    regime[is_high_vola_reversion] = REGIME_HIGH_VOLA_REVERSION

    return regime.rename("regime")


def market_state_matrix(
    features: pd.DataFrame,
    thresholds: RegimeThresholds | None = None,
) -> pd.DataFrame:
    """The central Market-State-Matrix output: `features` plus a `regime`
    column and a short human-readable `regime_reasoning` string per row.

    This is the single entry point Phase-3-Punkt-2 asks for ("ein zentrales
    Modul/Funktion, das die Signale der 5 Säulen zusammenführt") -- it does
    not recompute anything itself, it only classifies an already-assembled
    feature matrix and attaches the reasoning trail.

    Returns
    -------
    pd.DataFrame: `features` (unmodified, all original columns kept) plus
    `regime` and `regime_reasoning`.
    """
    regime = classify_market_regime(features, thresholds=thresholds)
    complete = features[list(REQUIRED_COLUMNS)].notna().all(axis=1)

    reasoning = pd.Series(
        [
            (
                f"adx={row.adx:.1f} +DI={row.plus_di:.1f} -DI={row.minus_di:.1f} "
                f"slope={row.slope:.4g} bbw={row.bandwidth:.4g} atr_ratio={row.atr_ratio:.2f} "
                f"dist_z_sma50={row.dist_zscore_sma50:.2f}"
                if is_complete
                else "unvollständige Eingabedaten"
            )
            for row, is_complete in zip(features.itertuples(), complete)
        ],
        index=features.index,
        name="regime_reasoning",
    )

    return pd.concat([features, regime, reasoning], axis=1)
