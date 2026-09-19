from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.swing_structure import (
    STRUCTURE_BEARISH,
    STRUCTURE_BULLISH,
    STRUCTURE_MIXED,
    STRUCTURE_UNKNOWN,
    classify_swing_structure,
    compute_zigzag_pivots,
)
from tests.lookahead_utils import assert_no_lookahead_on_truncation, make_datetime_index

ATR_PERIOD = 14
ATR_MULTIPLE = 2.0
FLAT_BARS = 30  # genug Bars, damit sich ATR(14) auf ~bar_range einschwingt


def _leg(start: float, end: float, n_bars: int, bar_range: float = 1.0) -> np.ndarray:
    return np.linspace(start, end, n_bars)


def _build_ohlc(waypoints: list[tuple[float, int]], start_price: float = 100.0, bar_range: float = 1.0) -> pd.DataFrame:
    """waypoints: Liste von (Zielpreis, Anzahl_Bars) -- linear vom jeweils
    vorherigen Preis dorthin interpoliert. Vorangestellt: FLAT_BARS Bars um
    start_price (fuer ATR-Einschwingzeit), Range pro Bar = bar_range."""
    closes = [start_price] * FLAT_BARS
    prev = start_price
    for target, n_bars in waypoints:
        closes.extend(_leg(prev, target, n_bars, bar_range).tolist())
        prev = target
    closes = np.array(closes)
    highs = closes + bar_range / 2
    lows = closes - bar_range / 2
    idx = make_datetime_index(len(closes), freq="h")
    return pd.DataFrame({"open": closes, "high": highs, "low": lows, "close": closes}, index=idx)


class TestComputeZigzagPivots:
    def test_confirms_initial_low_then_high_on_clear_reversal(self):
        # Flat-Start -> Ramp hoch (100 -> 130) -> Ramp runter (130 -> 100).
        # Der erste bestaetigte Pivot ist das Flat-Startniveau als LOW (der
        # Kurs hat sich davon um mehr als die Schwelle nach oben entfernt,
        # bevor irgendeine Umkehr stattfand) -- danach erst HIGH bei 130
        # (Rueckschlag von 30 ist bei ATR~1.0 weit ueber 2*ATR=2).
        df = _build_ohlc([(130.0, 20), (100.0, 20)])
        pivots = compute_zigzag_pivots(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert len(pivots) >= 2
        assert pivots[0].pivot_type == "LOW"
        assert pivots[1].pivot_type == "HIGH"
        assert pivots[1].price == pytest.approx(130.5)

    def test_no_pivot_within_flat_noise(self):
        # Reine Flat-Phase (keine Bewegung über die Range hinaus) -> keine Pivots.
        df = _build_ohlc([])
        pivots = compute_zigzag_pivots(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert pivots == []

    def test_confirm_idx_always_at_or_after_pivot_idx(self):
        df = _build_ohlc([(130.0, 20), (100.0, 20), (150.0, 20), (110.0, 20)])
        pivots = compute_zigzag_pivots(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        for p in pivots:
            assert p.confirm_idx >= p.pivot_idx


class TestClassifySwingStructure:
    def test_unknown_before_two_pivots_of_each_type(self):
        df = _build_ohlc([(130.0, 20)])
        state = classify_swing_structure(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert state.iloc[0] == STRUCTURE_UNKNOWN

    def test_higher_high_and_higher_low_is_bullish(self):
        # 6 Beine (verifiziert per Debug-Skript): letzte 2 bestaetigte Hochs
        # 170.5 -> 200.5 (steigend, HH), letzte 2 bestaetigte Tiefs 89.5 ->
        # 109.5 (steigend, HL) -> HH+HL.
        df = _build_ohlc([(150.0, 20), (90.0, 20), (170.0, 20), (110.0, 20), (200.0, 20), (130.0, 20)])
        state = classify_swing_structure(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert state.iloc[-1] == STRUCTURE_BULLISH

    def test_lower_high_and_lower_low_is_bearish(self):
        # Spiegelbild: letzte 2 bestaetigte Hochs 110.5 -> 90.5 (fallend, LH),
        # letzte 2 bestaetigte Tiefs 49.5 -> 9.5 (fallend, LL) -> LH+LL.
        df = _build_ohlc([(50.0, 20), (110.0, 20), (30.0, 20), (90.0, 20), (10.0, 20), (70.0, 20)])
        state = classify_swing_structure(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert state.iloc[-1] == STRUCTURE_BEARISH

    def test_higher_high_but_lower_low_is_mixed(self):
        # Letzte 2 Hochs 170.5 -> 200.5 (steigend, HH), letzte 2 Tiefs
        # 89.5 -> 49.5 (fallend, LL) -> widerspruechlich.
        df = _build_ohlc([(150.0, 20), (90.0, 20), (170.0, 20), (50.0, 20), (200.0, 20), (130.0, 20)])
        state = classify_swing_structure(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert state.iloc[-1] == STRUCTURE_MIXED

    def test_state_never_nan_and_always_valid_label(self):
        rng = np.random.default_rng(11)
        n = 400
        walk = 100 + np.cumsum(rng.normal(0, 2.0, n))
        idx = make_datetime_index(n, freq="h")
        df = pd.DataFrame(
            {"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk}, index=idx
        )
        state = classify_swing_structure(df, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)
        assert state.notna().all()
        assert set(state.unique()).issubset(
            {STRUCTURE_BULLISH, STRUCTURE_BEARISH, STRUCTURE_MIXED, STRUCTURE_UNKNOWN}
        )


class TestSwingStructureNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(23)
        n = 300
        walk = 100 + np.cumsum(rng.normal(0, 2.0, n))
        idx = make_datetime_index(n, freq="h")
        df = pd.DataFrame(
            {"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk}, index=idx
        )

        def compute_fn(ohlc):
            return classify_swing_structure(ohlc, atr_period=ATR_PERIOD, atr_multiple=ATR_MULTIPLE)

        assert_no_lookahead_on_truncation(compute_fn, df, cutoff_pos=200)
