import pandas as pd
import pytest

from backtest import resolve_trade_exit, simulate_signals, _vertical_bars_for_timeframe
from config import BacktestParams, TobyStandard
from elliott_wave_engine import Signal


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="15min", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def test_resolve_trade_exit_long_sl_hit_uses_realistic_candle_low():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 99.8, "high": 100, "low": 99.0, "close": 99.2},  # SL(99.5) beruehrt
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.75, sl_pct=0.5, retrace_pct=0.5, vertical_bars=10
    )
    assert reason == "sl"
    assert exit_price == 99.0
    assert r == pytest.approx(-1.0)
    assert moved_be is False
    assert pd.Timestamp(exit_time) == df.index[1]


def test_resolve_trade_exit_tp_then_trail_exit_on_later_bar():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 100, "high": 101.8, "low": 101.5, "close": 101.75},  # Index 1: TP(101.75) beruehrt
        {"open": 101.75, "high": 103, "low": 101.75, "close": 102},   # Index 2: neuer Peak(103), Ruecksetzer
    ]
    df = _make_df(rows)
    exit_price, reason, exit_time, moved_be, r = resolve_trade_exit(
        df, entry_idx=0, is_long=True, entry_price=100, tp_pct=1.75, sl_pct=0.5, retrace_pct=0.5, vertical_bars=10
    )
    assert reason == "trail_exit"
    assert exit_price == pytest.approx(103 * 0.995)
    assert moved_be is True
    assert pd.Timestamp(exit_time) == df.index[2]


def test_vertical_bars_for_timeframe_matches_hours():
    assert _vertical_bars_for_timeframe(15, 48.0) == 192
    assert _vertical_bars_for_timeframe(5, 48.0) == 576
    assert _vertical_bars_for_timeframe(60, 48.0) == 48


def test_simulate_signals_computes_correct_usdt_pnl_for_sl_trade_standard1():
    rows = [
        {"open": 100, "high": 100, "low": 100, "close": 100},
        {"open": 99.8, "high": 100, "low": 99.0, "close": 99.2},  # SL(99.5) getroffen, real fill 99.0 -> r=-1.0%
    ]
    df = _make_df(rows)
    signal = Signal(
        time=df.index[0], bar_index=0, direction="LONG", entry_price=100,
        wave5_price=90, wave2_retrace=0.5, wave3_extension=2.0, wave4_retrace=0.3,
    )
    params = BacktestParams(max_hold_hours=48.0, fee_pct_per_side=0.0006, initial_equity=1000.0)
    standard = TobyStandard(1, "Standard 1 (Referenz/Default)", 1.75, 0.5, 0.5)
    trades = simulate_signals(df, [signal], params, standard, tf_minutes=15)

    assert len(trades) == 1
    t = trades[0]
    # notional = 10 USDT * 20x = 200. gross = 200*(-1.0/100) = -2.0.
    # fee = 200*0.0006*2 = 0.24. net = -2.24.
    assert t.exit_reason == "sl"
    assert t.net_pnl_usdt == pytest.approx(-2.24)
    assert t.equity_after_usdt == pytest.approx(1000.0 - 2.24)
    assert t.r_multiple_gross == pytest.approx(-1.0 / 0.5)
    assert t.wave3_extension == pytest.approx(2.0)
