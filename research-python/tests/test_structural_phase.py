from __future__ import annotations

import numpy as np
import pandas as pd

from src.regime import REGIME_UNRESOLVED_NEUTRAL
from src.structural_phase import ALL_PHASES, PHASE_DOWN, PHASE_SIDEWAYS, PHASE_UP, classify_structural_phase
from src.swing_structure import STRUCTURE_BEARISH, STRUCTURE_BULLISH, STRUCTURE_MIXED
from tests.lookahead_utils import make_datetime_index


def _features_row(
    adx=15.0, plus_di=20.0, minus_di=20.0, slope=0.0, bandwidth=0.10, atr_ratio=1.0, dist_zscore_sma50=0.0
):
    return dict(
        adx=adx, plus_di=plus_di, minus_di=minus_di, slope=slope,
        bandwidth=bandwidth, atr_ratio=atr_ratio, dist_zscore_sma50=dist_zscore_sma50,
    )


def _constant_features(n: int, **overrides) -> pd.DataFrame:
    row = _features_row(**overrides)
    idx = make_datetime_index(n, freq="h")
    return pd.DataFrame([row] * n, index=idx)


def _flat_ohlc(n: int, price: float = 100.0, bar_range: float = 1.0) -> pd.DataFrame:
    idx = make_datetime_index(n, freq="h")
    return pd.DataFrame(
        {"open": price, "high": price + bar_range / 2, "low": price - bar_range / 2, "close": price},
        index=idx,
    )


class TestClassifyStructuralPhase:
    def test_requires_matching_index(self):
        features = _constant_features(5)
        ohlc = _flat_ohlc(5)
        ohlc.index = make_datetime_index(5, freq="4h")
        try:
            classify_structural_phase(features, ohlc)
            assert False, "expected ValueError"
        except ValueError:
            pass

    def test_output_always_valid_phase(self):
        rng = np.random.default_rng(5)
        n = 300
        idx = make_datetime_index(n, freq="h")
        features = pd.DataFrame(
            {
                "adx": rng.uniform(0, 60, n),
                "plus_di": rng.uniform(0, 50, n),
                "minus_di": rng.uniform(0, 50, n),
                "slope": rng.normal(0, 10, n),
                "bandwidth": rng.uniform(0, 0.3, n),
                "atr_ratio": rng.uniform(0.2, 3, n),
                "dist_zscore_sma50": rng.normal(0, 2, n),
            },
            index=idx,
        )
        walk = 100 + np.cumsum(rng.normal(0, 2.0, n))
        ohlc = pd.DataFrame({"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk}, index=idx)

        result = classify_structural_phase(features, ohlc)
        assert set(result["phase"].unique()).issubset(set(ALL_PHASES))
        assert result["phase"].notna().all()

    def test_bullish_regime_without_structure_confirmation_falls_to_sideways(self):
        # Starker bullischer Indikator-Regime-Wert, aber die (flache) OHLC-
        # Reihe erzeugt gar keine Swing-Struktur (STRUCTURE_UNKNOWN) --
        # ohne Bestaetigung durch den Knickpunkt-Check muss die Phase
        # Seitwaerts bleiben, nicht Aufwaerts.
        n = 60
        features = _constant_features(n, adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)
        ohlc = _flat_ohlc(n)
        result = classify_structural_phase(features, ohlc)
        assert result["swing_structure"].iloc[-1] != STRUCTURE_BULLISH
        assert (result["phase"] == PHASE_SIDEWAYS).all()

    def test_unresolved_neutral_with_weak_up_lean_maps_to_sideways_without_structure(self):
        # UNRESOLVED_NEUTRAL (ADX in der 20-25-Luecke) mit schwachem Aufwaerts-
        # Lean (slope>0, +DI>-DI) -- ohne Swing-Struktur-Bestaetigung bleibt
        # es trotzdem Seitwaerts (Edge-Case-Mapping betrifft nur den Lean-
        # Schritt, nicht die Endklassifikation ohne Struktur-Bestaetigung).
        n = 60
        features = _constant_features(n, adx=22.0, plus_di=25.0, minus_di=10.0, slope=5.0)
        ohlc = _flat_ohlc(n)
        result = classify_structural_phase(features, ohlc)
        assert (result["regime"] == REGIME_UNRESOLVED_NEUTRAL).all()
        assert (result["phase"] == PHASE_SIDEWAYS).all()

    def test_aligned_bullish_regime_and_structure_gives_up_phase(self):
        # Konstruiert eine OHLC-Reihe mit klarer HH/HL-Struktur (wie in
        # test_swing_structure.py verifiziert) UND setzt die Feature-Zeile
        # passend auf TREND_EXPANSION_BULLISH -- beide Signale stimmen
        # ueberein -> Phase muss AUFWAERTS sein.
        flat_bars = 30
        waypoints = [(150.0, 20), (90.0, 20), (170.0, 20), (110.0, 20), (200.0, 20), (130.0, 20)]
        closes = [100.0] * flat_bars
        prev = 100.0
        for target, n_bars in waypoints:
            closes.extend(np.linspace(prev, target, n_bars).tolist())
            prev = target
        closes = np.array(closes)
        idx = make_datetime_index(len(closes), freq="h")
        ohlc = pd.DataFrame(
            {"open": closes, "high": closes + 0.5, "low": closes - 0.5, "close": closes}, index=idx
        )
        features = pd.DataFrame(
            [_features_row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)] * len(closes), index=idx
        )
        result = classify_structural_phase(features, ohlc)
        assert result["swing_structure"].iloc[-1] == STRUCTURE_BULLISH
        assert result["phase"].iloc[-1] == PHASE_UP

    def test_aligned_bearish_regime_and_structure_gives_down_phase(self):
        flat_bars = 30
        waypoints = [(50.0, 20), (110.0, 20), (30.0, 20), (90.0, 20), (10.0, 20), (70.0, 20)]
        closes = [100.0] * flat_bars
        prev = 100.0
        for target, n_bars in waypoints:
            closes.extend(np.linspace(prev, target, n_bars).tolist())
            prev = target
        closes = np.array(closes)
        idx = make_datetime_index(len(closes), freq="h")
        ohlc = pd.DataFrame(
            {"open": closes, "high": closes + 0.5, "low": closes - 0.5, "close": closes}, index=idx
        )
        features = pd.DataFrame(
            [_features_row(adx=30.0, plus_di=10.0, minus_di=25.0, slope=-5.0)] * len(closes), index=idx
        )
        result = classify_structural_phase(features, ohlc)
        assert result["swing_structure"].iloc[-1] == STRUCTURE_BEARISH
        assert result["phase"].iloc[-1] == PHASE_DOWN

    def test_bullish_regime_but_mixed_structure_falls_to_sideways(self):
        # Indikator sagt bullisch, aber die Swing-Struktur ist MIXED (HH,
        # aber LL) -- Widerspruch -> Seitwaerts (konservativer Default).
        flat_bars = 30
        waypoints = [(150.0, 20), (90.0, 20), (170.0, 20), (50.0, 20), (200.0, 20), (130.0, 20)]
        closes = [100.0] * flat_bars
        prev = 100.0
        for target, n_bars in waypoints:
            closes.extend(np.linspace(prev, target, n_bars).tolist())
            prev = target
        closes = np.array(closes)
        idx = make_datetime_index(len(closes), freq="h")
        ohlc = pd.DataFrame(
            {"open": closes, "high": closes + 0.5, "low": closes - 0.5, "close": closes}, index=idx
        )
        features = pd.DataFrame(
            [_features_row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)] * len(closes), index=idx
        )
        result = classify_structural_phase(features, ohlc)
        assert result["swing_structure"].iloc[-1] == STRUCTURE_MIXED
        assert result["phase"].iloc[-1] == PHASE_SIDEWAYS


class TestStructuralPhaseNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(31)
        n = 250
        idx = make_datetime_index(n, freq="h")
        features = pd.DataFrame(
            {
                "adx": rng.uniform(0, 60, n),
                "plus_di": rng.uniform(0, 50, n),
                "minus_di": rng.uniform(0, 50, n),
                "slope": rng.normal(0, 10, n),
                "bandwidth": rng.uniform(0, 0.3, n),
                "atr_ratio": rng.uniform(0.2, 3, n),
                "dist_zscore_sma50": rng.normal(0, 2, n),
            },
            index=idx,
        )
        walk = 100 + np.cumsum(rng.normal(0, 2.0, n))
        ohlc = pd.DataFrame({"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk}, index=idx)

        cutoff_pos = 180
        full_result = classify_structural_phase(features, ohlc)
        truncated_result = classify_structural_phase(features.iloc[: cutoff_pos + 1], ohlc.iloc[: cutoff_pos + 1])
        pd.testing.assert_frame_equal(
            full_result.iloc[: cutoff_pos + 1].reset_index(drop=True),
            truncated_result.reset_index(drop=True),
            check_dtype=False,
        )
