import pandas as pd
import pytest

from avwap_engine import run_avwap_pivot_signals
from config import AvwapPivotParams


def _make_df(rows: list[dict]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(rows), freq="15min", tz="UTC")
    return pd.DataFrame(rows, index=idx)


def _flat(price: float = 100.0, volume: float = 10.0) -> dict:
    return {"open": price, "high": price + 0.5, "low": price - 0.5, "close": price, "volume": volume}


def test_resistance_rejection_produces_short_signal_with_correct_level():
    # Pivot-High auf CLOSE bei Index 2 (105 > Nachbarn 100), pivot_length=1
    # -> enthuellt bei Index 3. AVWAP-Wert nach Index 3 (Anker+Reveal-Bar):
    # pv = 105*10 (typical=(110+100+105)/3=105) + 100*10 (typical=(101+99+100)/3=100)
    #    = 1050 + 1000 = 2050, cum_v=20 -> Wert=102.5 (noch nicht testbar).
    # Index 4: hoch=110,tief=100,close=102,volumen=10, typical=(110+100+102)/3=104,
    # pv=1040 -> cum_pv=3090, cum_v=30 -> Wert=103.0 GENAU. Docht [100,110]
    # beruehrt 103.0, Close(102) < 103.0 -> Rejection.
    rows = [
        _flat(100), _flat(100),
        {"open": 100, "high": 110, "low": 100, "close": 105, "volume": 10},  # Index 2: Pivot-High-Kandidat
        {"open": 100, "high": 101, "low": 99, "close": 100, "volume": 10},   # Index 3: Reveal-Bar
        {"open": 100, "high": 110, "low": 100, "close": 102, "volume": 10}, # Index 4: Touch + Rejection
    ]
    df = _make_df(rows)
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))

    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "SHORT"
    assert s.bar_index == 4
    assert s.entry_price == 102
    assert s.level == pytest.approx(103.0)
    assert s.confluence_count == 1


def test_no_signal_fires_on_the_reveal_bar_itself():
    # Gleiche Konstellation, aber die Reveal-Bar (Index 3) selbst hat einen
    # Docht, der rein rechnerisch (mit sich selbst eingerechnet) die Linie
    # beruehren würde -- darf trotzdem KEIN Signal auf Index 3 auslösen,
    # da die Linie an ihrer eigenen Enthuellungs-Bar noch nicht aktiv ist.
    rows = [
        _flat(100), _flat(100),
        {"open": 100, "high": 110, "low": 100, "close": 105, "volume": 10},  # Index 2
        {"open": 100, "high": 200, "low": 50, "close": 90, "volume": 10},    # Index 3: Reveal-Bar mit riesigem Docht
    ]
    df = _make_df(rows)
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))
    assert all(s.bar_index != 3 for s in signals)


def test_line_invalidated_after_close_breaks_through():
    # Close-Sequenz [100,100,105,100,100,110,110,100] enthaelt GENAU EINEN
    # Pivot (Index 2, revealed Index 3) -- verifiziert gegen pivot_high/low,
    # damit keine ungewollten Zusatz-Pivots die Aussage verfaelschen.
    rows = [
        _flat(100), _flat(100),
        {"open": 100, "high": 110, "low": 100, "close": 105, "volume": 10},  # Index 2: Pivot-High
        {"open": 100, "high": 100.5, "low": 99.5, "close": 100, "volume": 10},  # Index 3: Reveal
        {"open": 100, "high": 100.5, "low": 99.5, "close": 100, "volume": 10},  # Index 4: neutraler Puffer
        {"open": 100, "high": 112, "low": 100, "close": 110, "volume": 10},  # Index 5: bricht die Linie (Close > Wert) -> Invalidierung
        {"open": 100, "high": 110.5, "low": 109.5, "close": 110, "volume": 10},  # Index 6: Puffer (Tie zu Index 5, kein neuer Pivot)
        {"open": 100, "high": 110, "low": 95, "close": 100, "volume": 10},  # Index 7: Docht erreicht die (invalidierte) alte Zone erneut
    ]
    df = _make_df(rows)
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))
    assert signals == []

    # Kontrolle: OHNE den Durchbruch (Index 5/6 bleiben flach) waere die
    # Linie noch aktiv und Index 7 wuerde feuern -- belegt, dass der leere
    # Signal-Output oben tatsaechlich an der Invalidierung liegt.
    rows_control = list(rows)
    rows_control[5] = {"open": 100, "high": 100.5, "low": 99.5, "close": 100, "volume": 10}
    rows_control[6] = {"open": 100, "high": 100.5, "low": 99.5, "close": 100, "volume": 10}
    df_control = _make_df(rows_control)
    signals_control = run_avwap_pivot_signals(df_control, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))
    assert any(s.bar_index == 7 and s.direction == "SHORT" for s in signals_control)


def _two_pivot_confluence_rows() -> list[dict]:
    # Close-Sequenz [100,100,105,100,100,103,100,100,100] -> genau zwei
    # Pivots (Index 2 -> revealed 3; Index 5 -> revealed 6), verifiziert
    # gegen pivot_high/low. Beide Anker-Kerzen mit dominantem Volumen, damit
    # ihr AVWAP-Wert durch die kleinvolumigen Puffer-Kerzen kaum abdriftet
    # (sonst wuerden die Puffer-Kerzen selbst versehentlich die Linie
    # beruehren). Index 5 (Pivot #2, Wert bleibt niedriger als Pivot #1) ist
    # zugleich ein legitimer Test/Rejection-Punkt fuer Linie #1 -- daher wird
    # unten gezielt nach `bar_index == 8` gefiltert statt die volle
    # Signal-Liste zu vergleichen.
    return [
        _flat(100), _flat(100),
        {"open": 100, "high": 110, "low": 100, "close": 105, "volume": 1000},  # Index 2: Pivot-High #1
        _flat(100),  # Index 3: Reveal #1
        _flat(100),  # Index 4: Puffer
        {"open": 100, "high": 106, "low": 100, "close": 103, "volume": 1000},  # Index 5: Pivot-High #2 (niedriger als #1)
        _flat(100),  # Index 6: Reveal #2
        _flat(100),  # Index 7: Puffer
        {"open": 100, "high": 110, "low": 95, "close": 100, "volume": 10},  # Index 8: beruehrt beide Linien, Close darunter
    ]


def test_confluence_count_when_two_lines_touched_same_bar():
    df = _make_df(_two_pivot_confluence_rows())
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))

    matching = [s for s in signals if s.bar_index == 8]
    assert len(matching) == 1
    assert matching[0].confluence_count == 2
    assert matching[0].direction == "SHORT"


def test_max_active_lines_cap_evicts_oldest():
    # Gleiches Setup, aber Cap=1 -> Pivot #1 wird beim Hinzufuegen von
    # Pivot #2 verdraengt. An Index 8 ist dann nur noch EINE Linie aktiv.
    df = _make_df(_two_pivot_confluence_rows())
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=1))

    matching = [s for s in signals if s.bar_index == 8]
    assert len(matching) == 1
    assert matching[0].confluence_count == 1


def test_support_rejection_produces_long_signal_symmetric():
    rows = [
        _flat(100), _flat(100),
        {"open": 100, "high": 100, "low": 90, "close": 95, "volume": 10},   # Index 2: Pivot-Low-Kandidat
        {"open": 100, "high": 101, "low": 99, "close": 100, "volume": 10},  # Index 3: Reveal-Bar
        {"open": 100, "high": 100, "low": 90, "close": 98, "volume": 10},  # Index 4: Docht beruehrt Linie von oben, Close darueber
    ]
    df = _make_df(rows)
    signals = run_avwap_pivot_signals(df, AvwapPivotParams(pivot_length=1, max_active_lines_per_side=5))

    assert len(signals) == 1
    s = signals[0]
    assert s.direction == "LONG"
    assert s.bar_index == 4
    assert s.entry_price == 98
    assert s.confluence_count == 1
