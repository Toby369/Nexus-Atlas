import numpy as np
import pandas as pd
import pytest

from orderflow_4step import config as C
from orderflow_4step.simulate import COST_PER_SIDE, Bars, daily_r, pick_targets, run_chain, simulate_trade

NO_FUNDING = pd.Series(0.0, index=pd.date_range("2023-12-01", "2024-02-01", freq="8h", tz="UTC"))


def make_bars(rows, start="2024-01-01 01:00"):
    """rows: Liste von (open, high, low, close)."""
    idx = pd.date_range(start, periods=len(rows), freq="15min", tz="UTC")
    arr = np.array(rows, dtype=float)
    return Bars(idx, arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3])


def flat(n, price=100.0):
    return [(price, price + 0.1, price - 0.1, price)] * n


def half(entry, exit_price):
    return (exit_price - entry) / entry - COST_PER_SIDE * (1 + exit_price / entry)


def test_stop_wins_when_stop_and_target_in_same_bar():
    bars = make_bars([(100, 100.5, 99.5, 100), (100, 104, 97, 100)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=np.nan)
    assert trade.exit_reason == "stop"
    assert trade.is_loss
    assert trade.r == pytest.approx(half(100, 98) / 0.02)


def test_stop_fills_at_open_on_gap():
    bars = make_bars([(100, 100.5, 99.5, 100), (97, 97.5, 96, 97)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=np.nan)
    assert trade.r == pytest.approx(half(100, 97) / 0.02)


def test_partial_then_breakeven():
    bars = make_bars([(100, 100.5, 99.5, 100), (100, 103.5, 100, 103), (103, 103, 99.9, 100)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=110.0)
    assert trade.exit_reason == "t1_then_breakeven"
    assert not trade.is_loss
    expected = 0.5 * half(100, 103) / 0.02 + 0.5 * half(100, 100) / 0.02
    assert trade.r == pytest.approx(expected)
    assert trade.exit_pos == 2


def test_remainder_checked_from_next_bar():
    # Kerze 1 erreicht Ziel 1 UND faellt unter den Einstand -> Rest wird erst ab Kerze 2 geprueft
    bars = make_bars([(100, 100.5, 99.5, 100), (100, 103.5, 99.5, 103), (103, 111, 103, 110)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=110.0)
    assert trade.exit_reason == "t1_then_t2"


def test_partial_then_t2():
    bars = make_bars([(100, 100.5, 99.5, 100), (100, 103.5, 100, 103), (103, 110.5, 102, 110)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=110.0)
    expected = 0.5 * half(100, 103) / 0.02 + 0.5 * half(100, 110) / 0.02
    assert trade.exit_reason == "t1_then_t2"
    assert trade.r == pytest.approx(expected)


def test_full_exit_at_t1_without_t2():
    bars = make_bars([(100, 100.5, 99.5, 100), (100, 103.5, 100, 103)] + flat(5))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=np.nan)
    assert trade.exit_reason == "t1_full"
    assert trade.r == pytest.approx(half(100, 103) / 0.02)


def test_timeout_after_24h():
    bars = make_bars([(100, 100.5, 99.5, 100)] + flat(150, 101.0))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=110.0, t2=np.nan)
    assert trade.exit_reason == "timeout"
    assert trade.exit_pos == 95  # 96 Kerzen = 24h ab Einstieg
    assert trade.exit_time - trade.entry_time == pd.Timedelta(hours=24)


def test_entry_rules_reject():
    bars = make_bars(flat(10))
    assert simulate_trade(bars, NO_FUNDING, 0, stop=101.0, t1=105.0, t2=np.nan) is None  # Einstieg <= Stop
    assert simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=102.9, t2=np.nan) is None  # CRV < 1,5
    assert simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=np.nan, t2=np.nan) is None
    assert simulate_trade(bars, NO_FUNDING, 0, stop=98.0, t1=103.0, t2=np.nan) is not None  # genau 1,5


def test_funding_charged_and_fallback():
    # Einstieg 07:00, Ausstieg nach 08:00 -> ein Funding-Zeitpunkt (08:00)
    bars = make_bars([(100, 100.5, 99.5, 100)] + flat(4) + [(100, 103.5, 100, 103)] + flat(3), start="2024-01-01 07:00")
    funding = pd.Series([0.001], index=[pd.Timestamp("2024-01-01 08:00", tz="UTC")])
    trade = simulate_trade(bars, funding, 0, stop=98.0, t1=103.0, t2=np.nan)
    assert trade.r == pytest.approx((half(100, 103) - 0.001) / 0.02)
    trade_fallback = simulate_trade(bars, pd.Series(dtype=float), 0, stop=98.0, t1=103.0, t2=np.nan)
    assert trade_fallback.r == pytest.approx((half(100, 103) - C.FUNDING_FALLBACK) / 0.02)


def test_pick_targets():
    swings = np.array([120.0, 108.0, 111.0])  # nach Pivot-Zeit sortiert
    assert pick_targets(100, vwap=104, poc=103, swing_prices=swings) == (103, 111.0)
    assert pick_targets(100, vwap=99, poc=104, swing_prices=swings) == (104, 111.0)
    t1, t2 = pick_targets(100, vwap=99, poc=98, swing_prices=swings)
    assert np.isnan(t1) and np.isnan(t2)
    t1, t2 = pick_targets(100, vwap=125, poc=99, swing_prices=swings)
    assert t1 == 125 and np.isnan(t2)


def _losing_chain_bars():
    rows = []
    for _ in range(6):  # 6 Trades, die jeweils in der Folgekerze am Stop enden
        rows += [(100, 100.5, 99.5, 100), (100, 100.2, 97, 97.5)]
    return make_bars(rows + flat(10), start="2024-01-02 00:00")  # Dienstag 00:00 UTC


def _setups(positions):
    return pd.DataFrame({"entry_pos": positions, "stop": 98.0, "target_a": 103.0, "target_b": np.nan})


NO_SWINGS = pd.DataFrame({"pivot_time": pd.DatetimeIndex([], tz="UTC"),
                          "confirm_time": pd.DatetimeIndex([], tz="UTC"), "price": []})


def test_daily_rule_locks_until_next_us_anchor():
    bars = _losing_chain_bars()
    setups = _setups([0, 2, 4, 6, 8, 10])
    without = run_chain(bars, NO_FUNDING, setups, NO_SWINGS, daily_rule=False)
    with_rule = run_chain(bars, NO_FUNDING, setups, NO_SWINGS, daily_rule=True)
    assert len(without) == 6
    assert len(with_rule) == 2  # nach 2 Verlusten gesperrt bis Dienstag 14:30 UTC


def test_chain_allows_only_one_open_trade():
    bars = make_bars([(100, 100.5, 99.5, 100)] + flat(10) + [(100, 103.5, 100, 103)] + flat(5))
    setups = _setups([0, 3, 5, 12])
    trades = run_chain(bars, NO_FUNDING, setups, NO_SWINGS, daily_rule=False)
    assert [t.entry_pos for t in trades] == [0, 12]


def test_daily_r_fills_zero_days_and_keeps_overrun():
    trades = pd.DataFrame({"exit_time": [pd.Timestamp("2024-01-02 05:00", tz="UTC"),
                                         pd.Timestamp("2024-01-04 01:00", tz="UTC")], "r": [1.0, -0.5]})
    days = daily_r(trades, pd.Timestamp("2024-01-01", tz="UTC"), pd.Timestamp("2024-01-04", tz="UTC"))
    assert days.tolist() == [0.0, 1.0, 0.0, -0.5]
