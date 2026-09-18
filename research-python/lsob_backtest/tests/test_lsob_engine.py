import pandas as pd

from config import LsobParams
from lsob_engine import run_lsob


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="1h", tz="UTC")
    df = pd.DataFrame(rows, index=idx)
    return df[["open", "high", "low", "close"]]


# pivot_len=1 haelt die Test-Reihen kurz und uebersichtlich; die anderen
# Toleranzen werden je Test bewusst gesetzt.
BASE_PARAMS = dict(pivot_len=1, box_invalid_tol_pc=0.0, retest_tol_pc=0.0, strict_wick_inval=False, max_wick_pen_pc=1000.0, max_history_bars=1000)


def test_long_entry_confirmed_on_later_bar():
    rows = [
        {"open": 100, "high": 101, "low": 99, "close": 100},   # 0
        {"open": 100, "high": 101, "low": 95, "close": 100},   # 1 -> Pivot-Low-Kandidat (low=95)
        {"open": 100, "high": 101, "low": 98, "close": 100},   # 2 -> bestaetigt Pivot bei Bar 1 (lastPL=95 ab hier)
        {"open": 96, "high": 97, "low": 90, "close": 96},      # 3 -> Sweep: low(90)<95, close(96)>95 -> Long-OB top=97 bottom=90
        {"open": 100, "high": 105, "low": 99, "close": 104},   # 4 -> weg von der Box, kein Retest (low=99 > top=97)
        {"open": 94, "high": 96, "low": 92, "close": 95},      # 5 -> Retest+Rejection+bullische Confirmation
    ]
    df = _make_df(rows)
    signals = run_lsob(df, LsobParams(**BASE_PARAMS))

    assert len(signals) == 1
    sig = signals[0]
    assert sig.direction == "long"
    assert sig.bar_index == 5
    assert sig.entry_price == 95
    assert sig.sl_price == 92
    assert sig.ob_top == 97
    assert sig.ob_bottom == 90


def test_short_entry_confirmed_on_later_bar():
    rows = [
        {"open": 100, "high": 101, "low": 99, "close": 100},   # 0
        {"open": 100, "high": 105, "low": 99, "close": 100},   # 1 -> Pivot-High-Kandidat (high=105)
        {"open": 100, "high": 102, "low": 99, "close": 100},   # 2 -> bestaetigt Pivot bei Bar 1 (lastPH=105 ab hier)
        {"open": 104, "high": 110, "low": 103, "close": 104},  # 3 -> Sweep: high(110)>105, close(104)<105 -> Short-OB top=110 bottom=103
        {"open": 100, "high": 101, "low": 95, "close": 96},    # 4 -> weg von der Box, kein Retest (high=101 < bottom=103)
        {"open": 106, "high": 108, "low": 104, "close": 105},  # 5 -> Retest+Rejection+baerische Confirmation
    ]
    df = _make_df(rows)
    signals = run_lsob(df, LsobParams(**BASE_PARAMS))

    assert len(signals) == 1
    sig = signals[0]
    assert sig.direction == "short"
    assert sig.bar_index == 5
    assert sig.entry_price == 105
    assert sig.sl_price == 108
    assert sig.ob_top == 110
    assert sig.ob_bottom == 103


def test_invalidated_order_block_never_confirms():
    rows = [
        {"open": 100, "high": 101, "low": 99, "close": 100},   # 0
        {"open": 100, "high": 101, "low": 95, "close": 100},   # 1 -> Pivot-Low-Kandidat
        {"open": 100, "high": 101, "low": 98, "close": 100},   # 2 -> bestaetigt Pivot (lastPL=95)
        {"open": 96, "high": 97, "low": 90, "close": 96},      # 3 -> Sweep -> Long-OB top=97 bottom=90
        {"open": 90, "high": 91, "low": 85, "close": 86},      # 4 -> Close(86) < bottom(90) -> INVALIDIERT
        {"open": 94, "high": 96, "low": 92, "close": 95},      # 5 -> waere Retest+Rejection+Confirm, OB existiert aber nicht mehr
    ]
    df = _make_df(rows)
    signals = run_lsob(df, LsobParams(**BASE_PARAMS))

    assert signals == []


def test_no_signal_without_any_sweep():
    rows = [
        {"open": 100, "high": 101, "low": 99, "close": 100},
        {"open": 100, "high": 101, "low": 99.5, "close": 100},
        {"open": 100, "high": 101, "low": 99, "close": 100},
        {"open": 100, "high": 101, "low": 99, "close": 100},
    ]
    df = _make_df(rows)
    signals = run_lsob(df, LsobParams(**BASE_PARAMS))
    assert signals == []
