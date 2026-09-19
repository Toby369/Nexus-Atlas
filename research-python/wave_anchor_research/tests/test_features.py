import numpy as np
import pandas as pd

from features import (
    OB_THRESHOLD,
    OS_THRESHOLD,
    _anchor_duration,
    _direction,
    _state,
    compute_htf_observations,
    join_htf_to_ltf,
    mtf_confluence,
)
from wavetrend import WaveTrendParams


def test_state_classification_boundaries():
    # Spec: "above +60" / "below -60" -- strikte Ungleichung, 60.0/-60.0
    # selbst sind NEUTRAL (Grenzwert gehoert noch nicht zur Anchor-Zone).
    wt2 = pd.Series([70.0, 60.0, 59.9, 0.0, -59.9, -60.0, -70.0, np.nan])
    state = _state(wt2)
    assert list(state) == ["OB", "NEUTRAL", "NEUTRAL", "NEUTRAL", "NEUTRAL", "NEUTRAL", "OS", None]


def test_direction_classification_sign_based_default():
    wt2 = pd.Series([10.0, 15.0, 15.0, 10.0])
    direction = _direction(wt2)
    # erste Bar: kein vorheriger Wert -> None
    assert direction.iloc[0] is None
    assert list(direction.iloc[1:]) == ["RISING", "FLAT", "FALLING"]


def test_anchor_duration_resets_on_state_exit():
    state = pd.Series(["NEUTRAL", "OB", "OB", "OB", "NEUTRAL", "OB", None])
    dur = _anchor_duration(state, "OB")
    assert list(dur[:-1]) == [0, 1, 2, 3, 0, 1]
    assert np.isnan(dur.iloc[-1])


def test_mtf_confluence_matching_and_mixed():
    a = pd.Series(["OB", "OS", "NEUTRAL", "OB", None])
    b = pd.Series(["OB", "NEUTRAL", "NEUTRAL", None, "OS"])
    combined = mtf_confluence(a, b)
    assert list(combined) == ["OB", "MIXED", "NEUTRAL", None, None]


def _htf_4h_df_for_cross() -> pd.DataFrame:
    # Konstruiert eine HTF-OHLC-Reihe mit (a) einer sinusfoermigen
    # Aufwaerm-Phase (baut eine realistische, von Null verschiedene
    # de-EMA auf -- ein flacher Preis vor dem Ramp fuehrt sonst zu de~0
    # und einem UNSTETEN Sprung weit ueber 60 OHNE erfassbaren Cross,
    # per Probe-Skript verifiziert), gefolgt von (b) einem moderaten
    # linearen Ramp, der die Welle GRADUELL durch +60 zieht (ebenfalls per
    # Probe-Skript verifiziert: sauberer Durchgang bei 2025-01-10 00:00).
    n_warmup, n_ramp = 40, 40
    idx = pd.date_range("2025-01-01", periods=n_warmup + n_ramp, freq="4h", tz="UTC")
    warmup = 100 + np.sin(np.linspace(0, 12, n_warmup)) * 3
    ramp = warmup[-1] + np.arange(1, n_ramp + 1) * 0.3
    price = np.concatenate([warmup, ramp])
    return pd.DataFrame({"open": price, "high": price + 0.5, "low": price - 0.5, "close": price}, index=idx)


def test_cross_up_60_fires_during_strong_rally_and_not_before():
    df = _htf_4h_df_for_cross()
    obs = compute_htf_observations(df, WaveTrendParams(chlen=9, avg=12, malen=3, label="t"))
    assert obs["cross_up_60"].any(), "Erwartete mindestens ein cross_up_60-Event waehrend der Rally"
    first_cross_idx = obs.index[obs["cross_up_60"]][0]
    # Vor dem Ramp-Start (erste 40 Bars, Aufwaerm-Phase) darf kein Cross auftreten.
    assert not obs.loc[df.index[:40], "cross_up_60"].any()
    assert first_cross_idx in df.index[40:]
    assert first_cross_idx == pd.Timestamp("2025-01-10 00:00", tz="UTC")


def test_join_htf_to_ltf_is_lookahead_safe_end_to_end():
    htf = _htf_4h_df_for_cross()
    obs = compute_htf_observations(htf, WaveTrendParams(chlen=9, avg=12, malen=3, label="t"))

    ltf_hours = int((htf.index[-1] - htf.index[0]) / pd.Timedelta(hours=1))
    ltf_idx = pd.date_range(htf.index[0], periods=ltf_hours, freq="1h", tz="UTC")  # deckt den ganzen HTF-Bereich ab, 1h-Raster
    ltf = pd.DataFrame({"open": 1, "high": 1, "low": 1, "close": 1}, index=ltf_idx)

    joined = join_htf_to_ltf(ltf, "1h", obs, "4h", prefix="htf4h")
    assert list(joined.index) == list(ltf.index)
    assert "htf4h_state" in joined.columns

    # Fuer jede HTF-Bar i (ausser der ersten): die LTF-Bar unmittelbar VOR
    # der Bestaetigung von Bar i muss noch den Wert von Bar i-1 sehen (nicht
    # von Bar i) -- exakte Gleichheitspruefung, nicht nur Ungleichheit.
    from mtf_join import close_time_of

    htf_close = close_time_of(htf, "4h")
    ltf_close = close_time_of(ltf, "1h")
    for i in range(1, len(htf)):
        boundary = htf_close.iloc[i]
        just_before = ltf.index[ltf_close < boundary]
        if len(just_before) == 0:
            continue
        last_bar_before = just_before[-1]
        seen = joined.loc[last_bar_before, "htf4h_wt2"]
        expected_prev = obs["wt2"].iloc[i - 1]
        if pd.isna(expected_prev):
            assert pd.isna(seen)
        else:
            assert seen == expected_prev

        at_or_after = ltf.index[ltf_close >= boundary]
        if len(at_or_after) == 0:
            continue
        first_bar_at_or_after = at_or_after[0]
        seen_new = joined.loc[first_bar_at_or_after, "htf4h_wt2"]
        expected_new = obs["wt2"].iloc[i]
        if pd.isna(expected_new):
            assert pd.isna(seen_new)
        else:
            assert seen_new == expected_new
