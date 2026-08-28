"""Independent Python reimplementation of the 14 production
(``compute-market-state`` v8) factors, per the exact formulas documented in
``docs/research/phase6-ist-zustand-audit.md`` (Section 1/2) -- NOT
simplified stand-ins. This is the "legacy" side of the production-factor
benchmark (``benchmark_production.py``).

Every factor function is a pure, row-wise (vectorized) transformation of
already point-in-time-safe raw inputs -- the same ``market_features``
columns the production Supabase pipeline itself computes upstream. There is
no rolling window, no ``.shift()``, no cross-row computation anywhere in
this module, so there is structurally no way for it to look ahead; this is
verified (not just asserted) in ``tests/test_legacy_factors.py`` the same
way as the other feature modules (truncation + future-perturbation checks),
and separately cross-checked row-by-row against
``data/btc_1d_trainval_snapshot.csv``'s ``reference_factors_jsonb`` column
-- the production engine's own already-computed values for the exact same
201 rows, giving a real (not synthetic) 201x14 correctness sample.

Null handling: every function returns NaN when its required raw input(s)
are missing, matching the production rule "null wird nie als 0 (neutral)
gewertet" (Section 1 of the audit) -- a missing input is never silently
treated as "no signal" (0).

Coverage note: 8 of these 14 factors (oi_price, positioning, orderbook,
options, macro, funding, sentiment, basis) depend on raw data sources that
have ~0% coverage in the TRAIN+VALIDATION window (Section 7 of the audit;
confirmed again in ``data/btc_1d_trainval_snapshot.csv``) -- their
functions correctly return all-NaN for every row of that snapshot. This is
not a bug in this module; it faithfully reproduces the same missingness
the production engine has, rather than papering over it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = [
    "factor_structure",
    "factor_momentum",
    "factor_cvd",
    "factor_oi_price",
    "factor_positioning",
    "factor_orderbook",
    "factor_options",
    "factor_macro",
    "factor_funding",
    "factor_sentiment",
    "factor_trend_strength",
    "factor_trend_regime",
    "factor_vwap_position",
    "factor_basis",
    "compute_all_legacy_factors",
    "compute_model_a",
    "MIN_COVERAGE_PCT",
]

# Thresholds, named and pinned exactly as documented in
# docs/research/phase6-ist-zustand-audit.md -- not re-derived or tuned here.
MOMENTUM_RSI_BULL = 55.0
MOMENTUM_RSI_BEAR = 45.0
OI_DELTA_THRESHOLD_PCT = 0.3
POSITIONING_SCORE_THRESHOLD = 10.0
ORDERBOOK_IMBALANCE_THRESHOLD = 0.08
OPTIONS_PCR_BULL = 0.7  # put_call_oi_ratio < this -> bullish
OPTIONS_PCR_BEAR = 1.1  # put_call_oi_ratio > this -> bearish
FUNDING_THRESHOLD_PCT = 0.05  # contrarian: high funding -> bearish
TREND_STRENGTH_ADX_THRESHOLD = 20.0
VWAP_PCT_THRESHOLD = 0.15
BASIS_PCT_THRESHOLD = 0.15  # contrarian: high basis -> bearish
MIN_COVERAGE_PCT = 40.0  # Model A's INSUFFICIENT_DATA gate


def _select_with_null(conditions: list[pd.Series], choices: list[float], null_mask: pd.Series, index, name: str) -> pd.Series:
    """Shared helper: np.select for the -1/0/1 branches, then force NaN
    wherever any required raw input was missing (comparisons against NaN
    silently evaluate False in numpy, which would otherwise land a missing
    row in the "0/neutral" bucket instead of correctly being NaN)."""
    result = np.select(conditions, choices, default=0.0).astype(float)
    result = pd.Series(result, index=index, name=name)
    result[null_mask] = np.nan
    return result


def factor_structure(structure_trend: pd.Series) -> pd.Series:
    """structure_trend='bullish'->1 / 'bearish'->-1 / sonst 0."""
    null_mask = structure_trend.isna()
    return _select_with_null(
        [structure_trend == "bullish", structure_trend == "bearish"],
        [1.0, -1.0],
        null_mask,
        structure_trend.index,
        "structure",
    )


def factor_momentum(rsi_14: pd.Series, macd_histogram: pd.Series) -> pd.Series:
    """rsi_14>55 AND macd_histogram>0 -> 1; rsi_14<45 AND macd_histogram<0 -> -1; sonst 0."""
    null_mask = rsi_14.isna() | macd_histogram.isna()
    return _select_with_null(
        [(rsi_14 > MOMENTUM_RSI_BULL) & (macd_histogram > 0), (rsi_14 < MOMENTUM_RSI_BEAR) & (macd_histogram < 0)],
        [1.0, -1.0],
        null_mask,
        rsi_14.index,
        "momentum",
    )


def factor_cvd(cvd_trend: pd.Series) -> pd.Series:
    """cvd_trend='rising'->1 / 'falling'->-1 / sonst 0."""
    null_mask = cvd_trend.isna()
    return _select_with_null(
        [cvd_trend == "rising", cvd_trend == "falling"],
        [1.0, -1.0],
        null_mask,
        cvd_trend.index,
        "cvd",
    )


def factor_oi_price(oi_delta_pct: pd.Series, close_price: pd.Series, ema_20: pd.Series) -> pd.Series:
    """|oi_delta_pct| > 0.3 -> (close>ema_20 ? 1 : -1); sonst 0."""
    null_mask = oi_delta_pct.isna() | close_price.isna() | ema_20.isna()
    exceeds = oi_delta_pct.abs() > OI_DELTA_THRESHOLD_PCT
    return _select_with_null(
        [exceeds & (close_price > ema_20), exceeds & (close_price <= ema_20)],
        [1.0, -1.0],
        null_mask,
        oi_delta_pct.index,
        "oi_price",
    )


def factor_positioning(score: pd.Series) -> pd.Series:
    """score>10->1 / score<-10->-1 / sonst 0."""
    null_mask = score.isna()
    return _select_with_null(
        [score > POSITIONING_SCORE_THRESHOLD, score < -POSITIONING_SCORE_THRESHOLD],
        [1.0, -1.0],
        null_mask,
        score.index,
        "positioning",
    )


def factor_orderbook(avg_depth_imbalance: pd.Series) -> pd.Series:
    """avg_depth_imbalance>0.08->1 / <-0.08->-1 / sonst 0."""
    null_mask = avg_depth_imbalance.isna()
    return _select_with_null(
        [avg_depth_imbalance > ORDERBOOK_IMBALANCE_THRESHOLD, avg_depth_imbalance < -ORDERBOOK_IMBALANCE_THRESHOLD],
        [1.0, -1.0],
        null_mask,
        avg_depth_imbalance.index,
        "orderbook",
    )


def factor_options(put_call_oi_ratio: pd.Series) -> pd.Series:
    """put_call_oi_ratio<0.7->1 / >1.1->-1 / sonst 0."""
    null_mask = put_call_oi_ratio.isna()
    return _select_with_null(
        [put_call_oi_ratio < OPTIONS_PCR_BULL, put_call_oi_ratio > OPTIONS_PCR_BEAR],
        [1.0, -1.0],
        null_mask,
        put_call_oi_ratio.index,
        "options",
    )


def factor_macro(regime: pd.Series) -> pd.Series:
    """get_macro_regime(): Risk-On->1 / Risk-Off->-1 / Neutral/Mixed->0."""
    null_mask = regime.isna()
    return _select_with_null(
        [regime == "Risk-On", regime == "Risk-Off"],
        [1.0, -1.0],
        null_mask,
        regime.index,
        "macro",
    )


def factor_funding(avg_funding_rate_pct: pd.Series) -> pd.Series:
    """Kontrafaktisch: avg_funding_rate>0.05%->-1 / <-0.05%->1 / sonst 0.

    Parameter name makes the assumed unit explicit: percentage points
    (e.g. 0.05 means 0.05%), matching the "_pct" convention used
    consistently for basis_pct/oi_delta_pct/vwap-pct-diff in the audit.
    """
    null_mask = avg_funding_rate_pct.isna()
    return _select_with_null(
        [avg_funding_rate_pct > FUNDING_THRESHOLD_PCT, avg_funding_rate_pct < -FUNDING_THRESHOLD_PCT],
        [-1.0, 1.0],
        null_mask,
        avg_funding_rate_pct.index,
        "funding",
    )


def factor_sentiment(classification: pd.Series) -> pd.Series:
    """Kontrafaktisch: 'Extreme Fear'->1 / 'Extreme Greed'->-1 / sonst 0."""
    null_mask = classification.isna()
    return _select_with_null(
        [classification == "Extreme Fear", classification == "Extreme Greed"],
        [1.0, -1.0],
        null_mask,
        classification.index,
        "sentiment",
    )


def factor_trend_strength(adx_14: pd.Series, plus_di: pd.Series, minus_di: pd.Series) -> pd.Series:
    """adx_14<20->0; sonst plus_di>minus_di->1 / minus_di>plus_di->-1."""
    null_mask = adx_14.isna() | plus_di.isna() | minus_di.isna()
    trending = adx_14 >= TREND_STRENGTH_ADX_THRESHOLD
    return _select_with_null(
        [trending & (plus_di > minus_di), trending & (minus_di > plus_di)],
        [1.0, -1.0],
        null_mask,
        adx_14.index,
        "trend_strength",
    )


def factor_trend_regime(close_price: pd.Series, ema_50: pd.Series, ema_200: pd.Series) -> pd.Series:
    """close>ema_50>ema_200->1; close<ema_50<ema_200->-1; sonst 0."""
    null_mask = close_price.isna() | ema_50.isna() | ema_200.isna()
    return _select_with_null(
        [(close_price > ema_50) & (ema_50 > ema_200), (close_price < ema_50) & (ema_50 < ema_200)],
        [1.0, -1.0],
        null_mask,
        close_price.index,
        "trend_regime",
    )


def factor_vwap_position(close_price: pd.Series, vwap: pd.Series) -> pd.Series:
    """pct_diff=(close-vwap)/vwap*100; >0.15->1 / <-0.15->-1 / sonst 0."""
    null_mask = close_price.isna() | vwap.isna()
    pct_diff = (close_price - vwap) / vwap * 100.0
    return _select_with_null(
        [pct_diff > VWAP_PCT_THRESHOLD, pct_diff < -VWAP_PCT_THRESHOLD],
        [1.0, -1.0],
        null_mask,
        close_price.index,
        "vwap_position",
    )


def factor_basis(basis_pct: pd.Series) -> pd.Series:
    """Kontrafaktisch: basis_pct>0.15->-1 / <-0.15->1 / sonst 0."""
    null_mask = basis_pct.isna()
    return _select_with_null(
        [basis_pct > BASIS_PCT_THRESHOLD, basis_pct < -BASIS_PCT_THRESHOLD],
        [-1.0, 1.0],
        null_mask,
        basis_pct.index,
        "basis",
    )


def compute_all_legacy_factors(raw: pd.DataFrame) -> pd.DataFrame:
    """Compute all 14 legacy factors from a raw-input DataFrame.

    ``raw`` must contain the following columns (any that are entirely
    missing from the caller's data source should still be present as
    all-NaN columns, e.g. ``pd.Series(np.nan, index=...)`` -- this function
    does not silently substitute defaults for a genuinely missing column,
    it raises ``KeyError`` via normal pandas column access):

    structure_trend, rsi_14, macd_histogram, cvd_trend, oi_delta_pct,
    close_price, ema_20, ema_50, ema_200, positioning_score,
    avg_depth_imbalance, put_call_oi_ratio, macro_regime,
    avg_funding_rate_pct, sentiment_classification, adx_14, plus_di,
    minus_di, vwap, basis_pct

    Returns
    -------
    pd.DataFrame with one column per factor (14 total), same index as ``raw``.
    """
    return pd.DataFrame(
        {
            "structure": factor_structure(raw["structure_trend"]),
            "momentum": factor_momentum(raw["rsi_14"], raw["macd_histogram"]),
            "cvd": factor_cvd(raw["cvd_trend"]),
            "oi_price": factor_oi_price(raw["oi_delta_pct"], raw["close_price"], raw["ema_20"]),
            "positioning": factor_positioning(raw["positioning_score"]),
            "orderbook": factor_orderbook(raw["avg_depth_imbalance"]),
            "options": factor_options(raw["put_call_oi_ratio"]),
            "macro": factor_macro(raw["macro_regime"]),
            "funding": factor_funding(raw["avg_funding_rate_pct"]),
            "sentiment": factor_sentiment(raw["sentiment_classification"]),
            "trend_strength": factor_trend_strength(raw["adx_14"], raw["plus_di"], raw["minus_di"]),
            "trend_regime": factor_trend_regime(raw["close_price"], raw["ema_50"], raw["ema_200"]),
            "vwap_position": factor_vwap_position(raw["close_price"], raw["vwap"]),
            "basis": factor_basis(raw["basis_pct"]),
        },
        index=raw.index,
    )


def compute_model_a(factors: pd.DataFrame) -> pd.DataFrame:
    """Model A aggregation, exactly per docs/research/phase6-ist-zustand-audit.md Section 2:

        withData        = factors with value != null
        dataCoveragePct = count(withData) / 14 * 100
        score           = sum(value) over withData
        insufficientData = dataCoveragePct < 40 OR count(withData) == 0
        overall_state   = INSUFFICIENT_DATA if insufficientData
                         else BULLISH  if score >= 3
                         else BEARISH  if score <= -3
                         else MIXED    if positiveCount>0 AND negativeCount>0
                         else NEUTRAL
        confidence      = 0 if insufficientData
                         else round((dataCoveragePct/100) * (|score|/count(withData)) * 100)

    ``factors`` must have exactly 14 columns (one per factor, as returned by
    ``compute_all_legacy_factors``).

    Returns
    -------
    pd.DataFrame with columns: data_coverage_pct, score, positive_count,
    negative_count, overall_state, confidence -- same index as ``factors``.
    """
    n_factors = factors.shape[1]
    if n_factors != 14:
        raise ValueError(f"compute_model_a expects exactly 14 factor columns, got {n_factors}")

    with_data = factors.notna()
    n_with_data = with_data.sum(axis=1)
    data_coverage_pct = n_with_data / 14.0 * 100.0
    score = factors.sum(axis=1, skipna=True)
    positive_count = (factors == 1.0).sum(axis=1)
    negative_count = (factors == -1.0).sum(axis=1)

    insufficient_data = (data_coverage_pct < MIN_COVERAGE_PCT) | (n_with_data == 0)

    overall_state = pd.Series("NEUTRAL", index=factors.index, dtype=object)
    overall_state[(positive_count > 0) & (negative_count > 0)] = "MIXED"
    overall_state[score <= -3] = "BEARISH"
    overall_state[score >= 3] = "BULLISH"
    overall_state[insufficient_data] = "INSUFFICIENT_DATA"

    confidence = ((data_coverage_pct / 100.0) * (score.abs() / n_with_data.replace(0, np.nan)) * 100.0).round()
    confidence[insufficient_data] = 0.0

    return pd.DataFrame(
        {
            "data_coverage_pct": data_coverage_pct,
            "score": score,
            "positive_count": positive_count,
            "negative_count": negative_count,
            "overall_state": overall_state,
            "confidence": confidence,
        },
        index=factors.index,
    )
