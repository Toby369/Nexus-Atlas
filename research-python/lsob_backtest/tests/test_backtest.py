import pandas as pd
import pytest

from backtest import _resolve_exit, _resolve_exit_cache, clear_resolve_exit_cache, simulate_bucket
from config import BacktestParams
from lsob_engine import Signal


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="1h", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def test_resolve_exit_long_sl_hit_first():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},  # Entry-Bar (Index 0)
            {"open": 96, "high": 101, "low": 94, "close": 95},     # SL(95) beruehrt, TP(110) nicht
        ]
    )
    price, reason, time = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert price == 95
    assert reason == "sl"
    assert pd.Timestamp(time) == df.index[1]


def test_resolve_exit_long_tp_hit_first():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 105, "high": 111, "low": 99, "close": 110},  # TP(110) beruehrt, SL(95) nicht
        ]
    )
    price, reason, _ = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert price == 110
    assert reason == "tp"


def test_resolve_exit_both_touched_same_bar_prefers_sl():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 112, "low": 93, "close": 100},  # beide Level in derselben Bar beruehrt
        ]
    )
    price, reason, _ = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert price == 95
    assert reason == "sl"


def test_resolve_exit_end_of_data():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 102, "low": 98, "close": 101},  # weder SL(95) noch TP(110) beruehrt
        ]
    )
    price, reason, _ = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert price == 101  # letzter Close
    assert reason == "end_of_data"


def test_simulate_bucket_long_sl_pnl_and_fees():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},  # Entry-Bar
            {"open": 96, "high": 101, "low": 94, "close": 95},     # SL(95) getroffen
        ]
    )
    signal = Signal(
        time=df.index[0], bar_index=0, direction="long", entry_price=100, sl_price=95,
        ob_created_time=df.index[0], ob_top=101, ob_bottom=95,
    )
    params = BacktestParams(crv=2.0, sl_buffer_pc=0.0, fee_pct_per_side=0.0006, risk_per_trade_pct=1.0, initial_equity=10_000.0)

    trades = simulate_bucket(df, [signal], params)
    assert len(trades) == 1
    t = trades[0]

    # Handrechnung: risk=5, position_size=100/5=20, gross=-100, fees=1.2+1.14=2.34
    assert t.exit_reason == "sl"
    assert t.exit_price == 95
    assert t.risk_price_distance == pytest.approx(5.0)
    assert t.net_pnl == pytest.approx(-102.34, abs=0.01)
    assert t.equity_after == pytest.approx(9897.66, abs=0.01)
    assert t.net_return_pct == pytest.approx(-0.010234, abs=1e-5)
    assert t.tp_price == pytest.approx(110.0)


def test_simulate_bucket_short_tp_pnl():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 96, "high": 101, "low": 90, "close": 90},  # TP(90) fuer Short beruehrt (sl=105 nicht)
        ]
    )
    signal = Signal(
        time=df.index[0], bar_index=0, direction="short", entry_price=100, sl_price=105,
        ob_created_time=df.index[0], ob_top=105, ob_bottom=90,
    )
    params = BacktestParams(crv=2.0, sl_buffer_pc=0.0, fee_pct_per_side=0.0006, risk_per_trade_pct=1.0, initial_equity=10_000.0)

    trades = simulate_bucket(df, [signal], params)
    assert len(trades) == 1
    t = trades[0]

    # risk=5, tp=100-10=90, position_size=20, gross=20*(100-90)=200, fees=20*100*0.0006+20*90*0.0006=1.2+1.08=2.28
    assert t.exit_reason == "tp"
    assert t.exit_price == 90
    assert t.net_pnl == pytest.approx(197.72, abs=0.01)
    assert t.equity_after == pytest.approx(10_197.72, abs=0.01)


def test_resolve_exit_cache_returns_consistent_result_and_can_be_cleared():
    clear_resolve_exit_cache()
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 96, "high": 101, "low": 94, "close": 95},
        ]
    )
    first = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert len(_resolve_exit_cache) == 1
    second = _resolve_exit(df, entry_idx=0, is_long=True, sl=95, tp=110)
    assert first == second  # Cache-Hit liefert exakt denselben Wert, kein Neu-Scan

    clear_resolve_exit_cache()
    assert len(_resolve_exit_cache) == 0


def test_simulate_bucket_skips_degenerate_zero_risk_signal():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 101, "low": 99, "close": 100},
        ]
    )
    signal = Signal(
        time=df.index[0], bar_index=0, direction="long", entry_price=100, sl_price=100,  # SL == Entry
        ob_created_time=df.index[0], ob_top=101, ob_bottom=100,
    )
    params = BacktestParams()
    trades = simulate_bucket(df, [signal], params)
    assert trades == []
