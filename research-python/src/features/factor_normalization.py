"""Konzept-Skript: rollierende Z-Score-Normalisierung als Nachfolger der
starr diskreten {-1, 0, 1}-Schwellenwert-Klassifikation.

STATUS: RESEARCH-KONZEPT, NICHT PRODUKTION. Siehe
docs/research/PHASE-0-RECONCILIATION.md Abschnitt 5 ("Normalisierung --
Bewertung"): die bestehende harte Diskretisierung (RSI>55, ADX<20 etc. in
compute-market-state) ist oekonomisch begruendet und wird durch dieses
Konzept NICHT ersetzt oder automatisch abgeloest -- dieses Modul ist ein
paralleler Research-Kandidat (Model E in der dortigen Nomenklatur), der
getestet, aber nicht uebernommen wird, ohne dass ein Vergleich auf
VALIDATION/TEST-Daten zeigt, dass er tatsaechlich mehr Information traegt.

WARUM ueberhaupt: die Institutional-Grade-Professionalisierungs-Analyse
(docs/research/INSTITUTIONAL_COMPARE.md) und die Fallstudie vom 29.08.2026
(docs/research/METHODIC_DIVERGENCE_2026-08-29.md) zeigen denselben
strukturellen Punkt aus zwei Richtungen: die harte Diskretisierung eines
Faktors auf {-1, 0, 1} wirft die tatsaechliche Staerke eines Signals weg
(RSI 37.09 und RSI 45.0 sind beide "neutral", obwohl 37.09 deutlich naeher
an ueberverkauft liegt) -- institutionelle Faktor-Modelle (Barra, Bloomberg
MAC3) arbeiten durchgehend mit kontinuierlichen, typischerweise
z-score-normalisierten Exposures statt einer Drei-Werte-Diskretisierung.

Same causality guarantee as the other feature modules: every function only
reads data at indices ``<= t`` when producing the value at ``t``. Verified in
``tests/test_factor_normalization.py``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _assert_sorted_index(series: pd.Series, name: str) -> None:
    if not series.index.is_monotonic_increasing:
        raise ValueError(
            f"{name}: index must be monotonically increasing (chronological)."
        )


def rolling_zscore(
    series: pd.Series,
    window: int = 60,
    min_periods: int | None = None,
    ddof: int = 0,
) -> pd.Series:
    """Causal rolling z-score: ``(x_t - rolling_mean_t) / rolling_std_t``.

    Strictly causal: the window ending at t only uses bars <= t (pandas'
    default trailing/non-centered rolling window) -- no expanding/centered
    variant is used here, matching the causality convention of every other
    feature in this package (see e.g. ``trend.py::linreg_trend``).

    A near-constant window (rolling std ~= 0, e.g. a flat funding rate
    stretch) produces NaN rather than a division-by-near-zero blow-up --
    same "no data" philosophy as the rest of this package: an undefined
    z-score is reported as missing, not as an invented extreme value.

    Parameters
    ----------
    series : pd.Series
        Chronologically indexed raw factor reading (e.g. RSI, ADX, funding
        rate) -- NOT the already-discretized -1/0/1 value.
    window : int
        Rolling window length in bars.
    min_periods : int | None
        Defaults to ``window`` (no value until a full window is available).
    ddof : int
        Delta degrees of freedom for the rolling standard deviation
        (0 = population std, matching ``pandas`` rolling default).

    Returns
    -------
    pd.Series of z-scores, same index as `series`.
    """
    _assert_sorted_index(series, "rolling_zscore")
    if window < 2:
        raise ValueError("window must be >= 2 (a std needs at least 2 points)")
    if min_periods is None:
        min_periods = window

    roll = series.rolling(window=window, min_periods=min_periods, center=False)
    mean = roll.mean()
    std = roll.std(ddof=ddof)

    return (series - mean) / std.replace(0, np.nan)


def soft_discretize(zscore: pd.Series, clip: float = 3.0) -> pd.Series:
    """Map a z-score to a continuous factor reading in [-1, 1], preserving
    magnitude -- the proposed successor to the hard ``sign(z) if |z| > t
    else 0`` discretization used implicitly by the production factors'
    fixed thresholds (e.g. RSI > 55 -> +1, RSI < 45 -> -1, else 0).

    Linear clip-and-scale (not tanh): kept intentionally simple and
    interpretable for a first concept -- a z-score of ±clip or beyond
    saturates at ±1, everything in between scales linearly. A smoother
    (tanh-based) squashing function is a plausible refinement, but adds a
    second free parameter (steepness) without a demonstrated benefit yet
    -- deliberately not introduced in this concept pass.

    NaN in -> NaN out (missing z-score stays missing, never silently
    becomes 0 -- same "no data != neutral" philosophy as the rest of this
    package, e.g. ``regime.py``).

    Parameters
    ----------
    zscore : pd.Series
        Output of `rolling_zscore` (or any other z-score-like series).
    clip : float
        Absolute z-score at which the soft factor saturates at ±1. Must be
        > 0.

    Returns
    -------
    pd.Series in [-1, 1] (or NaN where `zscore` is NaN), same index.
    """
    if clip <= 0:
        raise ValueError("clip must be > 0")
    return (zscore / clip).clip(lower=-1.0, upper=1.0)


def zscore_factor_matrix(
    raw_factors: pd.DataFrame,
    window: int = 60,
    min_periods: int | None = None,
    ddof: int = 0,
) -> pd.DataFrame:
    """Apply `rolling_zscore` column-wise to a DataFrame of raw, continuous
    factor readings (e.g. columns "rsi_14", "adx_14", "funding_rate", ...)
    -- the proposed continuous successor representation to the discretized
    {-1, 0, 1} factor matrix (`legacy_factors.py`'s output).

    Deliberately does NOT reimplement all 14 production factors here -- this
    concept demonstrates the transform mechanism on an arbitrary set of raw
    factor columns; wiring it to the exact 14 production factor extractions
    is a separate, later step (Model E, see module docstring) once/if this
    concept is approved for that.

    Parameters
    ----------
    raw_factors : pd.DataFrame
        Chronologically indexed, one column per raw (continuous, not yet
        discretized) factor reading.
    window, min_periods, ddof :
        Forwarded to `rolling_zscore` for every column.

    Returns
    -------
    pd.DataFrame, same shape/columns/index as `raw_factors`, each column
    replaced by its rolling z-score.
    """
    _assert_sorted_index(raw_factors.index.to_series(), "zscore_factor_matrix")
    return raw_factors.apply(
        lambda col: rolling_zscore(col, window=window, min_periods=min_periods, ddof=ddof)
    )


def soft_factor_matrix(
    raw_factors: pd.DataFrame,
    window: int = 60,
    clip: float = 3.0,
    min_periods: int | None = None,
    ddof: int = 0,
) -> pd.DataFrame:
    """`zscore_factor_matrix` followed by `soft_discretize` on every column
    -- the full proposed successor to the production {-1, 0, 1} factor
    matrix: continuous values in [-1, 1] instead of three discrete levels,
    still causal and still "no data stays no data".
    """
    z = zscore_factor_matrix(raw_factors, window=window, min_periods=min_periods, ddof=ddof)
    return z.apply(lambda col: soft_discretize(col, clip=clip))
