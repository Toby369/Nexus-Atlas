"""Kritischer Look-Ahead-Sicherheits-Test fuer confirmed_asof_join --
siehe docs/research/WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md fuer die volle
Herleitung. Synthetisches Beispiel exakt wie dort beschrieben."""

import pandas as pd
import pytest

from mtf_join import close_time_of, confirmed_asof_join


def _htf_4h_df() -> pd.DataFrame:
    # 5 aufeinanderfolgende 4H-Bars, 2025-01-01 00:00 bis 20:00.
    # close_time der Bars: 04:00, 08:00, 12:00, 16:00, 20:00.
    idx = pd.date_range("2025-01-01 00:00", periods=5, freq="4h", tz="UTC")
    return pd.DataFrame({"wt2": [10.0, 20.0, 30.0, 40.0, 50.0]}, index=idx)


def _ltf_15m_close_times(start: str, end: str) -> pd.Series:
    # LTF-Bars: open_time-Raster, close_time = open_time + 15min.
    opens = pd.date_range(start, end, freq="15min", tz="UTC")
    return opens + pd.Timedelta(minutes=15)


def test_close_time_of_adds_interval_duration():
    htf = _htf_4h_df()
    ct = close_time_of(htf, "4h")
    assert list(ct) == list(pd.date_range("2025-01-01 04:00", periods=5, freq="4h", tz="UTC"))


def test_htf_value_not_available_before_its_own_close():
    # LTF-Bar mit close_time=15:45 liegt VOR dem Schluss der 12:00-16:00
    # HTF-Bar (close_time=16:00, Wert 40) -- darf NICHT 40 sehen, nur den
    # zuvor bestaetigten Wert 30 (08:00-12:00 HTF-Bar, close_time=12:00).
    htf = _htf_4h_df()
    ltf_close = pd.Series([pd.Timestamp("2025-01-01 15:45", tz="UTC")])
    result = confirmed_asof_join(ltf_close, htf, "4h", ["wt2"])
    assert result["wt2"].iloc[0] == 30.0


def test_htf_value_available_exactly_at_its_own_close():
    # LTF-Bar mit close_time=16:00 = exakter Schlusszeitpunkt der
    # 12:00-16:00 HTF-Bar -- MUSS ab hier den neuen Wert 40 sehen.
    htf = _htf_4h_df()
    ltf_close = pd.Series([pd.Timestamp("2025-01-01 16:00", tz="UTC")])
    result = confirmed_asof_join(ltf_close, htf, "4h", ["wt2"])
    assert result["wt2"].iloc[0] == 40.0


def test_no_leakage_across_full_15m_series_around_4h_boundary():
    # Vollstaendige Serie 15:00-17:00: jede LTF-Bar VOR 16:00 Close sieht
    # noch 30, jede LTF-Bar AB 16:00 Close sieht 40 -- keine einzige
    # Ausnahme, kein verfruehtes Durchsickern.
    htf = _htf_4h_df()
    ltf_close = _ltf_15m_close_times("2025-01-01 15:00", "2025-01-01 16:45")
    result = confirmed_asof_join(ltf_close, htf, "4h", ["wt2"])

    before_boundary = result[result.index < pd.Timestamp("2025-01-01 16:00", tz="UTC")]
    at_or_after_boundary = result[result.index >= pd.Timestamp("2025-01-01 16:00", tz="UTC")]

    assert (before_boundary["wt2"] == 30.0).all()
    assert (at_or_after_boundary["wt2"] == 40.0).all()


def test_before_first_htf_close_is_nan_not_backfilled():
    htf = _htf_4h_df()
    ltf_close = pd.Series([pd.Timestamp("2025-01-01 02:00", tz="UTC")])  # vor der ersten HTF-Bestaetigung (04:00)
    result = confirmed_asof_join(ltf_close, htf, "4h", ["wt2"])
    assert result["wt2"].isna().all()


def test_unknown_interval_raises():
    htf = _htf_4h_df()
    with pytest.raises(ValueError):
        close_time_of(htf, "3h")
