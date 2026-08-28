"""Tests for src/features/legacy_factors.py.

Two kinds of evidence, not just synthetic unit tests:

1. Look-ahead checks (same truncation/future-perturbation methodology as
   the other feature modules) -- structurally these functions are pure
   row-wise transforms, so this mostly documents/confirms that, rather than
   catching a subtle bug, but it is run the same way as everywhere else in
   this project rather than skipped because "it's obviously fine".
2. A real, 201-row x 14-factor golden-value comparison against
   data/btc_1d_trainval_snapshot.csv's reference_factors_jsonb column --
   the production engine's own already-computed values for the exact same
   historical rows. This is a much stronger correctness check than any
   hand-constructed synthetic example.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.features.legacy_factors import (
    compute_all_legacy_factors,
    compute_model_a,
    factor_basis,
    factor_cvd,
    factor_funding,
    factor_macro,
    factor_momentum,
    factor_oi_price,
    factor_options,
    factor_orderbook,
    factor_positioning,
    factor_sentiment,
    factor_structure,
    factor_trend_regime,
    factor_trend_strength,
    factor_vwap_position,
)
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "btc_1d_trainval_snapshot.csv"


# ---------------------------------------------------------------------------
# Per-factor formula unit tests (small, hand-checkable cases)
# ---------------------------------------------------------------------------


class TestIndividualFormulas:
    def test_structure(self):
        s = pd.Series(["bullish", "bearish", "sideways", None])
        result = factor_structure(s)
        assert result.tolist()[:3] == [1.0, -1.0, 0.0]
        assert np.isnan(result.iloc[3])

    def test_momentum(self):
        rsi = pd.Series([60.0, 40.0, 50.0, 60.0, np.nan])
        macd = pd.Series([10.0, -10.0, 5.0, -5.0, 1.0])
        result = factor_momentum(rsi, macd)
        # row0: rsi>55 & macd>0 -> 1 ; row1: rsi<45 & macd<0 -> -1
        # row2: neither condition -> 0 ; row3: rsi>55 but macd<0 -> 0
        assert result.tolist()[:4] == [1.0, -1.0, 0.0, 0.0]
        assert np.isnan(result.iloc[4])

    def test_cvd(self):
        s = pd.Series(["rising", "falling", "flat", None])
        result = factor_cvd(s)
        assert result.tolist()[:3] == [1.0, -1.0, 0.0]
        assert np.isnan(result.iloc[3])

    def test_oi_price(self):
        oi_delta = pd.Series([0.5, -0.5, 0.1, np.nan])
        close = pd.Series([110.0, 90.0, 100.0, 100.0])
        ema20 = pd.Series([100.0, 100.0, 100.0, 100.0])
        result = factor_oi_price(oi_delta, close, ema20)
        assert result.tolist()[:3] == [1.0, -1.0, 0.0]
        assert np.isnan(result.iloc[3])

    def test_positioning(self):
        s = pd.Series([15.0, -15.0, 5.0, None])
        result = factor_positioning(s)
        assert result.tolist()[:3] == [1.0, -1.0, 0.0]
        assert np.isnan(result.iloc[3])

    def test_orderbook(self):
        s = pd.Series([0.10, -0.10, 0.02])
        result = factor_orderbook(s)
        assert result.tolist() == [1.0, -1.0, 0.0]

    def test_options(self):
        s = pd.Series([0.5, 1.5, 0.9])
        result = factor_options(s)
        assert result.tolist() == [1.0, -1.0, 0.0]

    def test_macro(self):
        s = pd.Series(["Risk-On", "Risk-Off", "Mixed", None])
        result = factor_macro(s)
        assert result.tolist()[:3] == [1.0, -1.0, 0.0]
        assert np.isnan(result.iloc[3])

    def test_funding_is_contrarian(self):
        s = pd.Series([0.10, -0.10, 0.0])
        result = factor_funding(s)
        assert result.tolist() == [-1.0, 1.0, 0.0]  # high funding -> bearish (-1)

    def test_sentiment(self):
        s = pd.Series(["Extreme Fear", "Extreme Greed", "Neutral"])
        result = factor_sentiment(s)
        assert result.tolist() == [1.0, -1.0, 0.0]

    def test_trend_strength(self):
        adx = pd.Series([25.0, 25.0, 15.0])
        plus_di = pd.Series([30.0, 10.0, 30.0])
        minus_di = pd.Series([10.0, 30.0, 10.0])
        result = factor_trend_strength(adx, plus_di, minus_di)
        assert result.tolist() == [1.0, -1.0, 0.0]  # row2: adx<20 -> 0 regardless of DI

    def test_trend_regime(self):
        close = pd.Series([110.0, 90.0, 100.0])
        ema50 = pd.Series([105.0, 95.0, 100.0])
        ema200 = pd.Series([100.0, 100.0, 100.0])
        result = factor_trend_regime(close, ema50, ema200)
        assert result.tolist() == [1.0, -1.0, 0.0]

    def test_vwap_position(self):
        close = pd.Series([100.2, 99.8, 100.0])
        vwap = pd.Series([100.0, 100.0, 100.0])
        result = factor_vwap_position(close, vwap)
        assert result.tolist() == [1.0, -1.0, 0.0]

    def test_basis_is_contrarian(self):
        s = pd.Series([0.2, -0.2, 0.0])
        result = factor_basis(s)
        assert result.tolist() == [-1.0, 1.0, 0.0]  # high basis -> bearish (-1)


# ---------------------------------------------------------------------------
# Look-ahead: same methodology as derivatives/volatility/momentum
# ---------------------------------------------------------------------------


class TestNoLookahead:
    def test_momentum_truncation(self):
        idx = make_datetime_index(100, freq="D")
        rsi = pd.Series(np.linspace(30, 70, 100), index=idx)
        macd = pd.Series(np.linspace(-50, 50, 100), index=idx)
        combined = pd.DataFrame({"rsi": rsi, "macd": macd})
        assert_no_lookahead_on_truncation(
            lambda df: factor_momentum(df["rsi"], df["macd"]), combined, cutoff_pos=50
        )

    def test_momentum_future_perturbation(self):
        idx = make_datetime_index(100, freq="D")
        rsi = pd.Series(np.linspace(30, 70, 100), index=idx)
        macd = pd.Series(np.linspace(-50, 50, 100), index=idx)
        combined = pd.DataFrame({"rsi": rsi, "macd": macd})
        assert_no_lookahead_on_future_perturbation(
            lambda df: factor_momentum(df["rsi"], df["macd"]), combined, cutoff_pos=50
        )

    def test_trend_regime_truncation(self):
        idx = make_datetime_index(100, freq="D")
        rng = np.random.default_rng(0)
        close = pd.Series(100 + np.cumsum(rng.normal(size=100)), index=idx)
        ema50 = close.rolling(5).mean().bfill()
        ema200 = close.rolling(20).mean().bfill()
        combined = pd.DataFrame({"close": close, "ema50": ema50, "ema200": ema200})
        assert_no_lookahead_on_truncation(
            lambda df: factor_trend_regime(df["close"], df["ema50"], df["ema200"]), combined, cutoff_pos=50
        )

    def test_trend_regime_future_perturbation(self):
        idx = make_datetime_index(100, freq="D")
        rng = np.random.default_rng(1)
        close = pd.Series(100 + np.cumsum(rng.normal(size=100)), index=idx)
        ema50 = close.rolling(5).mean().bfill()
        ema200 = close.rolling(20).mean().bfill()
        combined = pd.DataFrame({"close": close, "ema50": ema50, "ema200": ema200})
        assert_no_lookahead_on_future_perturbation(
            lambda df: factor_trend_regime(df["close"], df["ema50"], df["ema200"]), combined, cutoff_pos=50
        )


# ---------------------------------------------------------------------------
# compute_model_a: aggregation logic
# ---------------------------------------------------------------------------


class TestComputeModelA:
    def test_insufficient_data_below_coverage_gate(self):
        # only 5 of 14 factors have data (5/14 = 35.7% < 40%)
        factors = pd.DataFrame(
            {f"f{i}": [1.0] for i in range(5)} | {f"g{i}": [np.nan] for i in range(9)}
        )
        result = compute_model_a(factors)
        assert result["overall_state"].iloc[0] == "INSUFFICIENT_DATA"
        assert result["confidence"].iloc[0] == 0.0

    def test_zero_factors_is_insufficient_not_neutral(self):
        factors = pd.DataFrame({f"f{i}": [np.nan] for i in range(14)})
        result = compute_model_a(factors)
        assert result["overall_state"].iloc[0] == "INSUFFICIENT_DATA"

    def test_bullish_above_threshold(self):
        values = [1.0] * 6 + [np.nan] * 8  # 6/14=42.9% coverage, score=6 >= 3
        factors = pd.DataFrame({f"f{i}": [v] for i, v in enumerate(values)})
        result = compute_model_a(factors)
        assert result["overall_state"].iloc[0] == "BULLISH"

    def test_mixed_when_both_signs_present_and_score_between(self):
        values = [1.0, 1.0, -1.0, -1.0, 0.0, 0.0] + [np.nan] * 8  # score=0, coverage 42.9%
        factors = pd.DataFrame({f"f{i}": [v] for i, v in enumerate(values)})
        result = compute_model_a(factors)
        assert result["overall_state"].iloc[0] == "MIXED"

    def test_wrong_column_count_raises(self):
        factors = pd.DataFrame({"a": [1.0], "b": [1.0]})
        with pytest.raises(ValueError):
            compute_model_a(factors)


# ---------------------------------------------------------------------------
# Golden-value validation against the real production snapshot
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not DATA_PATH.exists(), reason="btc_1d_trainval_snapshot.csv not present")
class TestGoldenValuesAgainstProductionSnapshot:
    """Cross-checks compute_all_legacy_factors() against
    reference_factors_jsonb -- the production engine's own already-computed
    per-factor values for the same 201 historical rows -- not a synthetic
    approximation."""

    @classmethod
    @pytest.fixture(scope="class")
    def snapshot(cls):
        df = pd.read_csv(DATA_PATH)
        raw = pd.DataFrame(
            {
                "structure_trend": df["structure_trend"],
                "rsi_14": df["rsi_14"],
                "macd_histogram": df["macd_histogram"],
                "cvd_trend": df["cvd_trend"],
                "oi_delta_pct": df["oi_delta_pct"],
                "close_price": df["close_price"],
                "ema_20": df["ema_20"],
                "ema_50": df["ema_50"],
                "ema_200": df["ema_200"],
                "positioning_score": np.nan,  # not present in this export (0% coverage anyway)
                "avg_depth_imbalance": np.nan,
                "put_call_oi_ratio": np.nan,
                "macro_regime": np.nan,
                "avg_funding_rate_pct": np.nan,
                "sentiment_classification": np.nan,
                "adx_14": df["adx_14"],
                "plus_di": df["plus_di"],
                "minus_di": df["minus_di"],
                "vwap": df["vwap"],
                "basis_pct": df["basis_pct"],
            }
        )
        computed = compute_all_legacy_factors(raw)
        reference = df["reference_factors_jsonb"].apply(json.loads)
        return computed, reference

    @pytest.mark.parametrize(
        "factor",
        [
            "structure",
            "momentum",
            "cvd",
            "oi_price",
            "positioning",
            "orderbook",
            "options",
            "macro",
            "funding",
            "sentiment",
            "trend_strength",
            "trend_regime",
            "vwap_position",
            "basis",
        ],
    )
    def test_factor_matches_production_reference_exactly(self, snapshot, factor):
        computed, reference = snapshot
        ref_values = reference.apply(lambda d: d[factor]["value"])

        computed_col = computed[factor]
        # Compare treating both None/NaN as equal, everything else exactly.
        both_nan = computed_col.isna() & ref_values.isna()
        mismatches = ~both_nan & (computed_col != ref_values)
        n_mismatches = int(mismatches.sum())
        assert n_mismatches == 0, (
            f"{factor}: {n_mismatches}/{len(computed_col)} rows disagree with the "
            f"production reference (row indices: {computed.index[mismatches].tolist()[:10]})"
        )

    def test_available_factors_have_full_coverage(self, snapshot):
        computed, _ = snapshot
        fully_available = ["structure", "momentum", "cvd", "trend_strength", "trend_regime", "vwap_position"]
        for factor in fully_available:
            assert computed[factor].notna().all(), f"{factor} should be 100% covered in this snapshot"

    def test_low_coverage_factors_are_entirely_nan(self, snapshot):
        computed, _ = snapshot
        zero_coverage = ["oi_price", "positioning", "orderbook", "options", "macro", "funding", "sentiment", "basis"]
        for factor in zero_coverage:
            assert computed[factor].isna().all(), f"{factor} should be 0% covered in this snapshot"

    def test_model_a_matches_expected_coverage_and_no_insufficient_data(self, snapshot):
        computed, _ = snapshot
        model_a = compute_model_a(computed)
        # 6/14 = 42.857...% -- above the 40% gate, so never INSUFFICIENT_DATA here,
        # matching the Phase 0/1 finding that the coverage bug (and this gate) is
        # structurally inert on the current data.
        assert np.allclose(model_a["data_coverage_pct"], 6 / 14 * 100)
        assert (model_a["overall_state"] != "INSUFFICIENT_DATA").all()
