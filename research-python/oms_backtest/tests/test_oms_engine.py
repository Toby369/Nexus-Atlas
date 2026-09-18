import pandas as pd

from config import OmsParams
from oms_engine import run_oms


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="1min", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def _flat_row(price: float = 100.0) -> dict:
    return {"open": price, "high": price + 0.5, "low": price - 0.5, "close": price}


def _long_setup_rows() -> list[dict]:
    """20 Bars (Index 0-19): 15 flache Bars, ein Pivot-High auf CLOSE=101.5
    bei Index 15 (bestaetigt/sichtbar ab Index 17 dank pivot_length=2), dann
    4 weitere flache Bars. Alle Ranges = 1.0, damit range_sma(20) an Index
    19/20 wohldefiniert und klein ist (siehe Docstring der Testdatei fuer die
    Handrechnung der Ausbruchskerze).
    """
    rows = [_flat_row(100.0) for _ in range(15)]  # Index 0-14
    rows.append({"open": 101.0, "high": 102.0, "low": 101.0, "close": 101.5})  # Index 15, Pivot-High
    rows.extend(_flat_row(100.0) for _ in range(4))  # Index 16-19
    return rows


def _short_setup_rows() -> list[dict]:
    """Symmetrisches Pendant fuer einen Pivot-Low (Support=198.5 bei Index 15)."""
    rows = [_flat_row(200.0) for _ in range(15)]
    rows.append({"open": 199.0, "high": 199.0, "low": 198.0, "close": 198.5})
    rows.extend(_flat_row(200.0) for _ in range(4))
    return rows


def test_long_breakout_signal_fires_on_transition_bar():
    rows = _long_setup_rows()
    rows.append({"open": 100.8, "high": 102.5, "low": 100.5, "close": 102.3})  # Index 20: gueltiger Ausbruch
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "long"
    assert s.bar_index == 20
    assert s.entry_price == 102.3
    assert s.sl_price == 100.5  # tiefster Punkt der Ausbruchskerze
    assert s.level == 101.5


def test_long_breakout_does_not_refire_on_following_bar():
    rows = _long_setup_rows()
    rows.append({"open": 100.8, "high": 102.5, "low": 100.5, "close": 102.3})  # Index 20: Ausbruch
    rows.append({"open": 102.3, "high": 103.0, "low": 102.0, "close": 102.8})  # Index 21: bleibt drueber
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert len(signals) == 1  # kein zweites Signal, obwohl Bar 21 ebenfalls > Resistance schliesst


def test_long_breakout_rejected_when_body_out_fraction_too_small():
    rows = _long_setup_rows()
    # Schliesst nur knapp ueber der Resistance -> Koerper-Anteil jenseits der Linie < 50%.
    rows.append({"open": 100.0, "high": 102.0, "low": 99.9, "close": 101.6})
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert signals == []


def test_long_breakout_rejected_when_wick_ratio_too_large():
    rows = _long_setup_rows()
    # Grosser oberer Docht (Ablehnung von oben) trotz ausreichendem Body-Anteil.
    rows.append({"open": 100.8, "high": 104.5, "low": 100.5, "close": 102.3})
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert signals == []


def test_long_breakout_rejected_when_candle_too_large_vs_sma():
    rows = _long_setup_rows()
    # Weit ausserhalb der 2.5x-SMA(20)-Range-Grenze.
    rows.append({"open": 95.0, "high": 110.0, "low": 90.0, "close": 108.0})
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert signals == []


def test_short_breakout_signal_fires_on_transition_bar():
    rows = _short_setup_rows()
    rows.append({"open": 199.2, "high": 199.4, "low": 197.5, "close": 197.7})  # Index 20: gueltiger Ausbruch
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "short"
    assert s.bar_index == 20
    assert s.entry_price == 197.7
    assert s.sl_price == 199.4  # hoechster Punkt der Ausbruchskerze
    assert s.level == 198.5


def test_no_signal_when_no_pivot_revealed_yet():
    # Rein flache Daten ohne jegliche Pivot-Struktur -- last_resistance/
    # last_support bleiben durchgaengig NaN, es kann nie ein Signal feuern.
    rows = [_flat_row(100.0) for _ in range(25)]
    df = _make_df(rows)

    signals = run_oms(df, OmsParams())
    assert signals == []
