import pandas as pd
import pytest

from backtest import _resolve_exit_cache, _resolve_exit_with_be, clear_resolve_exit_cache, simulate_bucket
from config import BacktestParams
from oms_engine import Signal


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="1min", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def test_resolve_exit_long_sl_hit_first_no_breakeven():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},  # Entry-Bar (Index 0)
            {"open": 96, "high": 101, "low": 94, "close": 95},     # SL(95) beruehrt, TP(110) nicht, BE(103) nie erreicht
        ]
    )
    price, reason, time, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 95
    assert reason == "sl"
    assert moved_to_be is False
    assert pd.Timestamp(time) == df.index[1]


def test_resolve_exit_long_tp_hit_first():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 105, "high": 111, "low": 99, "close": 110},  # TP(110) beruehrt
        ]
    )
    price, reason, _, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 110
    assert reason == "tp"
    assert moved_to_be is False


def test_resolve_exit_both_sl_and_tp_touched_same_bar_prefers_stop():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 112, "low": 93, "close": 100},  # beide Level in derselben Bar beruehrt
        ]
    )
    price, reason, _, _ = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 95
    assert reason == "sl"


def test_resolve_exit_moves_to_breakeven_and_then_exits_there():
    # entry=100, sl=95 (risk=5), tp=110 (reward=10), BE-Trigger bei 30% -> 103.
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},  # Entry-Bar (Index 0)
            {"open": 101, "high": 104, "low": 100.5, "close": 103.5},  # Index 1: erreicht BE-Trigger(103), kein SL/TP-Treffer
            {"open": 102, "high": 102.5, "low": 97, "close": 98},      # Index 2: faellt auf den nachgezogenen SL (100) zurueck
        ]
    )
    price, reason, exit_time, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 100
    assert reason == "breakeven"
    assert moved_to_be is True
    assert pd.Timestamp(exit_time) == df.index[2]


def test_breakeven_stop_update_is_lagged_by_one_bar():
    # Bar 1 erreicht sowohl den BE-Trigger (103) als auch (haette der neue
    # Stop SOFORT gegolten) den neuen Break-Even-Level (100) -- low=99 liegt
    # unter 100, aber ueber dem noch gueltigen alten SL(95). Da die
    # Aktualisierung erst NACH dieser Bar wirkt, darf Bar 1 NICHT ausloesen.
    # Erst Bar 2 (low=99, jetzt gegen den bereits nachgezogenen Stop 100)
    # loest den Break-Even-Exit aus.
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},        # Entry-Bar (Index 0)
            {"open": 101, "high": 104, "low": 99, "close": 101},          # Index 1: BE-Trigger erreicht, kein Exit
            {"open": 100.5, "high": 101, "low": 99, "close": 100},        # Index 2: jetzt gegen den neuen Stop(100)
        ]
    )
    price, reason, exit_time, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 100
    assert reason == "breakeven"
    assert moved_to_be is True
    assert pd.Timestamp(exit_time) == df.index[2]  # nicht Index 1


def test_resolve_exit_end_of_data():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 102, "low": 98, "close": 101},  # weder SL noch TP noch BE-Trigger erreicht
        ]
    )
    price, reason, _, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30
    )
    assert price == 101
    assert reason == "end_of_data"
    assert moved_to_be is False


def test_resolve_exit_short_symmetric_breakeven():
    # entry=100, sl=105 (risk=5), tp=90 (reward=10), BE-Trigger bei 30% -> 97.
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 99, "high": 99.5, "low": 96, "close": 97},       # Index 1: BE-Trigger(97) erreicht
            {"open": 98, "high": 103, "low": 97.5, "close": 102},     # Index 2: steigt zurueck auf den Stop(100)
        ]
    )
    price, reason, _, moved_to_be = _resolve_exit_with_be(
        df, entry_idx=0, is_long=False, entry=100, sl=105, tp=90, be_threshold_pct=0.30
    )
    assert price == 100
    assert reason == "breakeven"
    assert moved_to_be is True


def test_resolve_exit_cache_returns_consistent_result_and_can_be_cleared():
    clear_resolve_exit_cache()
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 96, "high": 101, "low": 94, "close": 95},
        ]
    )
    first = _resolve_exit_with_be(df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30)
    assert len(_resolve_exit_cache) == 1
    second = _resolve_exit_with_be(df, entry_idx=0, is_long=True, entry=100, sl=95, tp=110, be_threshold_pct=0.30)
    assert first == second

    clear_resolve_exit_cache()
    assert len(_resolve_exit_cache) == 0


def test_simulate_bucket_long_sl_pnl_and_fees():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},  # Entry-Bar
            {"open": 96, "high": 101, "low": 94, "close": 95},     # SL(95) getroffen, kein BE erreicht
        ]
    )
    signal = Signal(time=df.index[0], bar_index=0, direction="long", entry_price=100, sl_price=95, level=101.5)
    params = BacktestParams(crv=2.0, be_threshold_pct=0.30, fee_pct_per_side=0.0006, risk_per_trade_pct=1.0, initial_equity=10_000.0)

    trades = simulate_bucket(df, [signal], params)
    assert len(trades) == 1
    t = trades[0]

    # Handrechnung wie im LSOB-Projekt: risk=5, position_size=100/5=20, gross=-100, fees=1.2+1.14=2.34
    assert t.exit_reason == "sl"
    assert t.moved_to_breakeven is False
    assert t.exit_price == 95
    assert t.risk_price_distance == pytest.approx(5.0)
    assert t.net_pnl == pytest.approx(-102.34, abs=0.01)
    assert t.equity_after == pytest.approx(9897.66, abs=0.01)
    assert t.tp_price == pytest.approx(110.0)


def test_simulate_bucket_long_breakeven_exit_small_net_loss_from_fees():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},        # Entry-Bar
            {"open": 101, "high": 104, "low": 100.5, "close": 103.5},    # BE-Trigger(103) erreicht
            {"open": 102, "high": 102.5, "low": 97, "close": 98},        # faellt auf Break-Even(100) zurueck
        ]
    )
    signal = Signal(time=df.index[0], bar_index=0, direction="long", entry_price=100, sl_price=95, level=101.5)
    params = BacktestParams(crv=2.0, be_threshold_pct=0.30, fee_pct_per_side=0.0006, risk_per_trade_pct=1.0, initial_equity=10_000.0)

    trades = simulate_bucket(df, [signal], params)
    assert len(trades) == 1
    t = trades[0]

    assert t.exit_reason == "breakeven"
    assert t.moved_to_breakeven is True
    assert t.exit_price == 100
    # Exit exakt am Entry -> Brutto-PnL 0, Netto leicht negativ nur durch Fees.
    assert t.net_pnl < 0
    # Brutto-PnL 0 (Exit exakt am Entry), Fees: position_size=100/5=20,
    # entry_fee=20*100*0.0006=1.2, exit_fee=20*100*0.0006=1.2 -> netto -2.4.
    assert t.net_pnl == pytest.approx(-2.4, abs=0.01)
    assert t.r_multiple_gross == pytest.approx(0.0, abs=1e-9)


def test_simulate_bucket_short_tp_pnl():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 96, "high": 101, "low": 90, "close": 90},  # TP(90) fuer Short beruehrt (sl=105 nicht)
        ]
    )
    signal = Signal(time=df.index[0], bar_index=0, direction="short", entry_price=100, sl_price=105, level=98.5)
    params = BacktestParams(crv=2.0, be_threshold_pct=0.30, fee_pct_per_side=0.0006, risk_per_trade_pct=1.0, initial_equity=10_000.0)

    trades = simulate_bucket(df, [signal], params)
    assert len(trades) == 1
    t = trades[0]

    assert t.exit_reason == "tp"
    assert t.exit_price == 90
    assert t.net_pnl == pytest.approx(197.72, abs=0.01)
    assert t.equity_after == pytest.approx(10_197.72, abs=0.01)


def test_simulate_bucket_skips_degenerate_zero_risk_signal():
    df = _make_df(
        [
            {"open": 100, "high": 100, "low": 100, "close": 100},
            {"open": 100, "high": 101, "low": 99, "close": 100},
        ]
    )
    signal = Signal(time=df.index[0], bar_index=0, direction="long", entry_price=100, sl_price=100, level=101.5)
    params = BacktestParams()
    trades = simulate_bucket(df, [signal], params)
    assert trades == []
