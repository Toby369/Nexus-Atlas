import numpy as np
import pandas as pd
import pytest

from orderflow_4step import config as C
from orderflow_4step import features as F
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
)


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def synthetic_15m(n: int = 600, seed: int = 1, start: str = "2024-03-01") -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq="15min", tz="UTC")
    close = 60000 + np.cumsum(rng.normal(0, 60, n))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + rng.uniform(0, 40, n)
    low = np.minimum(open_, close) - rng.uniform(0, 40, n)
    volume = rng.uniform(50, 500, n)
    taker = volume * rng.uniform(0.2, 0.8, n)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume,
                         "taker_buy_base_vol": taker}, index=idx)


# --- US-Anker ---------------------------------------------------------------


@pytest.mark.parametrize(
    "bar, anchor",
    [
        ("2024-07-10 13:30", "2024-07-10 13:30"),  # Sommerzeit: 09:30 EDT = 13:30 UTC
        ("2024-07-10 13:15", "2024-07-09 13:30"),  # kurz vor Eroeffnung -> Vortag
        ("2024-01-10 14:30", "2024-01-10 14:30"),  # Winterzeit: 09:30 EST = 14:30 UTC
        ("2024-01-10 14:15", "2024-01-09 14:30"),
        ("2024-03-08 20:00", "2024-03-08 14:30"),  # Freitag vor DST-Beginn
        ("2024-03-10 20:00", "2024-03-08 14:30"),  # Sonntag (DST-Wechseltag) -> Freitag
        ("2024-03-11 10:00", "2024-03-08 14:30"),  # Montag vor Eroeffnung -> Freitag
        ("2024-03-11 13:30", "2024-03-11 13:30"),  # Montag nach DST-Beginn: schon 13:30 UTC
        ("2024-11-01 13:30", "2024-11-01 13:30"),  # Freitag vor DST-Ende
        ("2024-11-04 14:30", "2024-11-04 14:30"),  # Montag nach DST-Ende: wieder 14:30 UTC
        ("2024-11-04 14:00", "2024-11-01 13:30"),
    ],
)
def test_us_session_anchor(bar, anchor):
    assert F.us_session_anchor(pd.DatetimeIndex([ts(bar)]))[0] == ts(anchor)


@pytest.mark.parametrize(
    "after, expected",
    [
        ("2024-03-08 20:00", "2024-03-11 13:30"),  # Freitag -> Montag, ueber DST-Beginn
        ("2024-07-10 13:30", "2024-07-11 13:30"),  # genau auf dem Anker -> naechster
        ("2024-07-10 13:29", "2024-07-10 13:30"),
    ],
)
def test_next_us_anchor_after(after, expected):
    assert F.next_us_anchor_after(ts(after)) == ts(expected)


# --- VWAP -------------------------------------------------------------------


def test_session_vwap_hand_example():
    idx = pd.DatetimeIndex([ts("2024-07-10 13:15"), ts("2024-07-10 13:30"), ts("2024-07-10 13:45")])
    df = pd.DataFrame({"high": [11.0, 12.0, 15.0], "low": [9.0, 9.0, 12.0], "close": [10.0, 12.0, 12.0],
                       "volume": [5.0, 1.0, 3.0]}, index=idx)
    out = F.session_vwap(df)
    # Kerze 13:15 gehoert zur Session vom Vortag (allein)
    assert out["vwap"].iloc[0] == pytest.approx(10.0)
    assert out["vwap_bars"].iloc[0] == 1
    # Neue Session ab 13:30: tp = 11 (v=1), 13 (v=3)
    assert out["vwap"].iloc[1] == pytest.approx(11.0)
    assert out["vwap_sigma"].iloc[1] == pytest.approx(0.0)
    assert out["vwap"].iloc[2] == pytest.approx((11 * 1 + 13 * 3) / 4)
    expected_var = (1 * (11 - 12.5) ** 2 + 3 * (13 - 12.5) ** 2) / 4
    assert out["vwap_sigma"].iloc[2] == pytest.approx(np.sqrt(expected_var))
    assert out["vwap_bars"].iloc[2] == 2


# --- Volumenprofil -----------------------------------------------------------


def test_profile_from_window_hand_example():
    # Bucket 1.0. Kerze A: 10.2-12.8 -> Buckets 10,11,12 je 3; Kerze B: 11.1-11.9 -> Bucket 11 +6
    # Profil: 10:3, 11:9, 12:3 -> POC 11 (Mitte 11.5). VA: 9/15=60 % < 70 %,
    # Nachbarn gleich gross -> oberer zuerst -> 12 dazu (80 %). VAL=11, VAH=13.
    poc, val, vah = F.profile_from_window(np.array([12.8, 11.9]), np.array([10.2, 11.1]), np.array([9.0, 6.0]), 1.0)
    assert poc == pytest.approx(11.5)
    assert val == pytest.approx(11.0)
    assert vah == pytest.approx(13.0)


def test_profile_value_area_prefers_bigger_neighbour():
    # Buckets 10:4, 11:10, 12:1 -> POC 11 (10/15=67 %), unten groesser -> VAL=10, VAH=12
    highs = np.array([10.5, 11.5, 12.5])
    lows = np.array([10.1, 11.1, 12.1])
    poc, val, vah = F.profile_from_window(highs, lows, np.array([4.0, 10.0, 1.0]), 1.0)
    assert (poc, val, vah) == pytest.approx((11.5, 10.0, 12.0))


def test_volume_profile_excludes_current_bar():
    df = synthetic_15m(200)
    base = F.volume_profile(df)
    changed = df.copy()
    changed.iloc[150, changed.columns.get_loc("volume")] *= 1000
    out = F.volume_profile(changed)
    pd.testing.assert_series_equal(base["poc"].iloc[:151], out["poc"].iloc[:151])
    assert not np.isclose(base["poc"].iloc[151], out["poc"].iloc[151])


# --- Delta und Absorption ---------------------------------------------------


def test_delta_zscore_uses_only_previous_bars():
    delta = pd.Series(np.arange(10, dtype=float))
    z = F.delta_zscore(delta, window=3)
    prev = np.array([2.0, 3.0, 4.0])
    assert z.iloc[5] == pytest.approx((5 - prev.mean()) / prev.std(ddof=1))
    assert z.iloc[:3].isna().all()


def test_absorption_conditions():
    idx = pd.date_range("2024-01-01", periods=12, freq="15min", tz="UTC")
    low = np.full(12, 100.0)
    high = np.full(12, 102.0)
    close = np.full(12, 101.0)
    low[10], high[10], close[10] = 98.0, 101.0, 100.0  # neues Tief, Schluss bei 2/3 der Spanne
    df = pd.DataFrame({"low": low, "high": high, "close": close}, index=idx)
    z = pd.Series(0.0, index=idx)
    z.iloc[10] = -2.0
    assert F.absorption_bars(df, z, -1.5, 8).iloc[10]
    z.iloc[10] = -1.0  # Delta nicht extrem genug
    assert not F.absorption_bars(df, z, -1.5, 8).iloc[10]
    z.iloc[10] = -2.0
    df.iloc[10, df.columns.get_loc("close")] = 99.0  # Schluss im unteren Drittel
    assert not F.absorption_bars(df, z, -1.5, 8).iloc[10]


def test_find_confirmations_invalidates_on_lower_low():
    idx = pd.date_range("2024-01-01", periods=6, freq="15min", tz="UTC")
    df = pd.DataFrame({"high": [10, 10, 9, 12, 9, 13.0], "low": [8, 8, 7.5, 8, 8, 8.0],
                       "close": [9, 9, 9, 11, 9, 12.0]}, index=idx)
    delta = pd.Series([0, 0, 0, 5, 0, 5.0], index=idx)
    absorption = pd.Series([True, False, False, False, False, False], index=idx)
    # Kerze 2 faellt unter das Absorptionstief 8 -> verfaellt, obwohl Kerze 3 bestaetigen wuerde
    assert F.find_confirmations(df, delta, absorption).empty
    absorption = pd.Series([False, False, True, False, False, False], index=idx)
    out = F.find_confirmations(df, delta, absorption)
    assert out.values.tolist() == [[2, 3]]


def test_find_confirmations_needs_positive_delta_and_window():
    idx = pd.date_range("2024-01-01", periods=6, freq="15min", tz="UTC")
    df = pd.DataFrame({"high": [10, 9, 9, 9, 11, 11.0], "low": [8, 8.5, 8.5, 8.5, 8.5, 8.5],
                       "close": [9, 9, 9, 9, 10.5, 10.5]}, index=idx)
    absorption = pd.Series([True, False, False, False, False, False], index=idx)
    delta = pd.Series([0, 0, 0, 0, 5, 5.0], index=idx)
    # Kerze 4 liegt ausserhalb von 3 Folgekerzen
    assert F.find_confirmations(df, delta, absorption).empty
    df.iloc[3, df.columns.get_loc("close")] = 10.5
    delta.iloc[3] = -1.0
    assert F.find_confirmations(df, delta, absorption).empty  # negatives Delta
    delta.iloc[3] = 1.0
    assert F.find_confirmations(df, delta, absorption).values.tolist() == [[0, 3]]


# --- Struktur und Swings ----------------------------------------------------


def test_causal_structure_registers_swing_after_lookback():
    # Ein klares Swing-Tief bei 10, danach ein hoeheres Tief bei 22 (HL -> bullish)
    lows = np.array([10.0] * 40)
    lows[10] = 5.0
    lows[22] = 7.0
    highs = lows + 2
    causal = F.causal_structure_trend(highs, lows, 5)
    original = F.original_structure_trend(highs, lows, 5)
    first_bull_orig = int(np.argmax(original == "bullish"))
    first_bull_causal = int(np.argmax(causal == "bullish"))
    assert first_bull_orig == 22
    assert first_bull_causal == 27  # erst 5 Kerzen spaeter bekannt


def test_causal_structure_no_lookahead():
    df = synthetic_15m(400, seed=3)

    def fn(frame):
        return pd.Series(F.causal_structure_trend(frame["high"].to_numpy(), frame["low"].to_numpy()),
                         index=frame.index).map({"bullish": 1, "bearish": -1, "ranging": 0})

    for cut in (100, 237, 350):
        assert_no_lookahead_on_truncation(fn, df, cut)


def test_original_structure_has_lookahead():
    """Dokumentiert den Befund: das Original veraendert vergangene Werte, wenn die Zukunft fehlt."""
    df = synthetic_15m(400, seed=3)

    def fn(frame):
        return pd.Series(F.original_structure_trend(frame["high"].to_numpy(), frame["low"].to_numpy()),
                         index=frame.index).map({"bullish": 1, "bearish": -1, "ranging": 0})

    with pytest.raises(AssertionError):
        for cut in range(50, 390, 7):
            assert_no_lookahead_on_truncation(fn, df, cut)


def test_confirmed_swing_highs_confirm_time():
    idx = pd.date_range("2024-01-01", periods=50, freq="1h", tz="UTC")
    high = np.full(50, 100.0)
    high[25] = 110.0
    df = pd.DataFrame({"high": high, "low": high - 1}, index=idx)
    out = F.confirmed_swing_highs(df, lookback=20)
    assert len(out) == 1
    assert out["pivot_time"].iloc[0] == idx[25]
    assert out["confirm_time"].iloc[0] == idx[45] + pd.Timedelta(hours=1)


def test_asof_closed_uses_only_closed_bars():
    idx = pd.date_range("2024-01-01", periods=3, freq="4h", tz="UTC")
    values = pd.Series(["A", "B", "C"], index=idx, dtype=object)
    at = pd.DatetimeIndex([ts("2024-01-01 03:45"), ts("2024-01-01 04:00"), ts("2024-01-01 11:59")])
    assert list(F.asof_closed(values, pd.Timedelta(hours=4), at)) == [None, "A", "B"]


# --- Lookahead fuer alle Reihen-Merkmale ------------------------------------


@pytest.mark.parametrize("cut", [150, 333, 500])
def test_features_no_lookahead(cut):
    df = synthetic_15m(600, seed=7)

    def all_features(frame):
        delta = F.taker_delta(frame)
        dz = F.delta_zscore(delta)
        vw = F.session_vwap(frame)
        prof = F.volume_profile(frame)
        absorption = F.absorption_bars(frame, dz).astype(float)
        return pd.concat([delta, dz, vw, prof, absorption, F.atr_15m(frame)], axis=1)

    assert_no_lookahead_on_truncation(all_features, df, cut)
    assert_no_lookahead_on_future_perturbation(all_features, df, cut)


def test_regime_4h_marks_missing_inputs():
    df = synthetic_15m(120, seed=5).resample("4h").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    regime = F.regime_4h(df)
    assert (regime.iloc[:10] == "MISSING").all()
    assert C.REGIMES_NORMAL[0] not in regime.iloc[:10].tolist()
