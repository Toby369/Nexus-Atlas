import pandas as pd
import pytest

from avwap_engine import Signal
from backtest import resolve_trade_exit, simulate_signals, _vertical_bars_for_timeframe
from config import BacktestParams


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="15min", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def test_resolve_trade_exit_long_sl_hit_uses_realistic_candle_low():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},  # Index 0: Signal-Kerze (nicht gescannt)
        {"open": 99.8, "high": 100, "low": 99.0, "close": 99.2},  # Index 1: SL(99.5) beruehrt
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.5, sl_pct=0.5, retrace_pct=0.5, vertical_bars=10
    )
    assert reason == "sl"
    assert exit_price == 99.0  # tatsaechliches Kerzentief, nicht der nominelle SL-Preis (99.5)
    assert r == pytest.approx(-1.0)
    assert moved_be is False
    assert pd.Timestamp(exit_time) == df.index[1]


def test_resolve_trade_exit_long_tp_then_trail_exit_on_later_bar():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},        # Index 0: Signal
        {"open": 100, "high": 101.6, "low": 101.3, "close": 101.5},  # Index 1: TP(101.5) beruehrt, kein Ruecksetzer noch
        {"open": 101.5, "high": 103, "low": 101.5, "close": 102},    # Index 2: neuer Peak(103), dann Ruecksetzer (0.5% davon)
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.5, sl_pct=0.5, retrace_pct=0.5, vertical_bars=10
    )
    assert reason == "trail_exit"
    assert exit_price == pytest.approx(103 * 0.995)
    assert r == pytest.approx((103 * 0.995 / 100 - 1) * 100)
    assert moved_be is True
    assert pd.Timestamp(exit_time) == df.index[2]


def test_resolve_trade_exit_open_at_horizon_when_no_retrace_in_window():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 100, "high": 102, "low": 101.9, "close": 101.9},   # Index 1: TP beruehrt
        {"open": 101.9, "high": 102.5, "low": 102.1, "close": 102.3},  # Index 2: neuer Peak, kein Ruecksetzer
        {"open": 102.3, "high": 102.6, "low": 102.4, "close": 102.5},  # Index 3: neuer Peak, kein Ruecksetzer, Fensterende
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.5, sl_pct=0.5, retrace_pct=0.5, vertical_bars=3
    )
    assert reason == "open_at_horizon"
    assert exit_price == pytest.approx(102.6)
    assert moved_be is True
    assert pd.Timestamp(exit_time) == df.index[3]


def test_resolve_trade_exit_end_of_data_when_neither_barrier_touched():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 100, "high": 101, "low": 99.7, "close": 100.2},
        {"open": 100.2, "high": 101, "low": 99.7, "close": 100.1},
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.5, sl_pct=0.5, retrace_pct=0.5, vertical_bars=2
    )
    assert reason == "end_of_data"
    assert exit_price == 100.1
    assert moved_be is False
    assert r == 0.0


def test_vertical_bars_for_timeframe_matches_hours():
    assert _vertical_bars_for_timeframe(15, 48.0) == 192
    assert _vertical_bars_for_timeframe(5, 48.0) == 576
    assert _vertical_bars_for_timeframe(60, 48.0) == 48


def test_simulate_signals_computes_correct_usdt_pnl_for_sl_trade():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 99.8, "high": 100, "low": 99.0, "close": 99.2},  # SL(99.5) getroffen, real fill 99.0 -> r=-1.0%
    ]
    df = _make_df(rows)
    signal = Signal(time=df.index[0], bar_index=0, direction="LONG", entry_price=100, level=98, confluence_count=1)
    params = BacktestParams(
        tp_pct=1.5, sl_pct=0.5, retrace_pct=0.5, max_hold_hours=48.0,
        fee_pct_per_side=0.0006, initial_equity=1000.0,
    )
    trades = simulate_signals(df, [signal], params, tf_minutes=15)

    assert len(trades) == 1
    t = trades[0]
    # notional = 10 USDT * 20x = 200. gross = 200*(-1.0/100) = -2.0.
    # fee = 200*0.0006*2 = 0.24. net = -2.24.
    assert t.exit_reason == "sl"
    assert t.net_pnl_usdt == pytest.approx(-2.24)
    assert t.equity_after_usdt == pytest.approx(1000.0 - 2.24)
    assert t.r_multiple_gross == pytest.approx(-1.0 / 0.5)
    assert t.confluence_count == 1
