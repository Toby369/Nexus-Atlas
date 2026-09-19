import numpy as np
import pandas as pd
import pytest

from config import ElliottWaveParams
from elliott_wave_engine import run_elliott_wave_signals
from pivots import pivot_high, pivot_low


def _build(lows: list[float], highs: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(lows), freq="15min", tz="UTC")
    return pd.DataFrame({"open": highs, "high": highs, "low": lows, "close": highs}, index=idx)


# Handverifizierte bullische 5-Wellen-Sequenz (pivot_depth=1), per Probe-Skript
# gegen pivot_high/pivot_low bestaetigt: GENAU 3 Pivot-Highs (110@3, 130@7,
# 140@11) und GENAU 3 Pivot-Lows (100@1, 104@5, 120@9), keine Nebenpivots.
# Start=100(L), P1=110(H), P2=104(L), P3=130(H), P4=120(L), P5=140(H).
# Retrace2=(110-104)/10=0.6, Ext3=(130-104)/10=2.6, Retrace4=(130-120)/26=0.385
# -- alle innerhalb der Default-Toleranzen.
BASE_LOWS = [103, 100, 103, 108, 108, 104, 108, 108, 125, 120, 125, 123, 123]
BASE_HIGHS = [95, 96, 96, 110, 97, 98, 99, 130, 99, 100, 101, 140, 101]

# Symmetrische baerische Sequenz: Start=100(H), P1=90(L), P2=94(H), P3=70(L),
# P4=80(H), P5=60(L). Retrace2=0.4, Ext3=2.4, Retrace4=0.417.
BEAR_HIGHS = [97, 100, 97, 92, 92, 94, 92, 92, 75, 80, 75, 77, 77]
BEAR_LOWS = [99, 99, 99, 90, 99, 99, 99, 70, 99, 99, 99, 60, 99]


def test_pivot_sequence_has_no_spurious_extra_pivots():
    ph = pivot_high(np.array(BASE_HIGHS, dtype=float), 1, 1)
    pl = pivot_low(np.array(BASE_LOWS, dtype=float), 1, 1)
    ph_bars = [i - 1 for i, v in enumerate(ph) if not np.isnan(v)]
    pl_bars = [i - 1 for i, v in enumerate(pl) if not np.isnan(v)]
    assert ph_bars == [3, 7, 11]
    assert pl_bars == [1, 5, 9]


def test_valid_bullish_impulse_produces_short_reversal_signal():
    df = _build(BASE_LOWS, BASE_HIGHS)
    signals = run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1))

    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "SHORT"
    assert s.bar_index == 12  # Enthuellungs-Bar von P5 (actual_bar=11, +depth=1)
    assert s.wave5_price == 140.0
    assert s.wave2_retrace == pytest.approx(0.6)
    assert s.wave3_extension == pytest.approx(2.6)
    assert s.wave4_retrace == pytest.approx(0.3846, abs=0.001)


def test_valid_bearish_impulse_produces_long_reversal_signal_symmetric():
    df = _build(BEAR_LOWS, BEAR_HIGHS)
    signals = run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1))

    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "LONG"
    assert s.wave5_price == 60.0
    assert s.wave2_retrace == pytest.approx(0.4)
    assert s.wave3_extension == pytest.approx(2.4)
    assert s.wave4_retrace == pytest.approx(0.4167, abs=0.001)


def test_rule1_wave2_breaks_start_rejects_pattern():
    # P2 (idx5 low) auf 95 gesetzt -- unterschreitet Start (100), bleibt aber
    # ein gueltiger Pivot (< Nachbarn 108,108).
    lows = list(BASE_LOWS)
    lows[5] = 95
    df = _build(lows, BASE_HIGHS)
    assert run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1)) == []


def test_rule3_wave4_overlaps_wave1_rejects_pattern():
    # P4 (idx9 low) auf 105 gesetzt -- faellt unter P1 (110), bleibt aber
    # ein gueltiger Pivot (< Nachbarn 125,125).
    lows = list(BASE_LOWS)
    lows[9] = 105
    df = _build(lows, BASE_HIGHS)
    assert run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1)) == []


def test_fib_wave3_extension_too_small_rejects_pattern():
    # P3 (idx7 high) auf 108 gesetzt -- Length3 sinkt auf 4 (statt 26),
    # weit unter das 1.618-fache von Length1=10.
    highs = list(BASE_HIGHS)
    highs[7] = 108
    df = _build(BASE_LOWS, highs)
    assert run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1)) == []


def test_fib_wave2_retrace_too_small_rejects_pattern():
    # P2 (idx5 low) auf 108 gesetzt (Nachbarn auf 111 angehoben, damit P2
    # weiterhin ein gueltiger Pivot bleibt) -- Retrace sinkt auf 0.2, unter
    # die Mindestschwelle 0.382.
    lows = list(BASE_LOWS)
    lows[4] = 111
    lows[5] = 108
    lows[6] = 111
    df = _build(lows, BASE_HIGHS)
    assert run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1)) == []


def test_fib_wave4_retrace_too_large_rejects_pattern():
    # P4 (idx9 low) auf 112 gesetzt -- bleibt > P1=110 (Regel 3 weiterhin
    # erfuellt), aber Retrace4 steigt auf 0.692, ueber die Obergrenze 0.50.
    lows = list(BASE_LOWS)
    lows[9] = 112
    df = _build(lows, BASE_HIGHS)
    assert run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1)) == []


def test_no_signal_fires_before_wave5_reveal_bar():
    df = _build(BASE_LOWS, BASE_HIGHS)
    signals = run_elliott_wave_signals(df, ElliottWaveParams(pivot_depth=1))
    assert all(s.bar_index >= 12 for s in signals)
