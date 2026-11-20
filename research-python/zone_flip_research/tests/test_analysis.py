import numpy as np
import pandas as pd

from zone_flip_research.analysis import Bars, find_zones, pivot_lows


def frame(closes, wick=0.2, vol=1.0):
    c = np.asarray(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    idx = pd.date_range("2024-01-01", periods=len(c), freq="1h", tz="UTC")
    return pd.DataFrame({"open": o, "high": np.maximum(o, c) + wick, "low": np.minimum(o, c) - wick,
                         "close": c, "volume": vol}, index=idx)


def test_pivot_needs_k_bars_after():
    l = np.array([5, 4, 3, 2, 1, 2, 3, 4, 5, 6.0])
    assert pivot_lows(l, 3) == [4]
    assert pivot_lows(l[:7], 3) == []  # erst 3 Kerzen danach bestaetigt


def test_no_lookahead_zone_state_before_cut():
    rng = np.random.default_rng(1)
    df = frame(100 + np.cumsum(rng.normal(0, 1, 3000)))
    full = find_zones(Bars.build(df, 1), 5)
    cut = 2000
    part = find_zones(Bars.build(df.iloc[:cut], 1), 5)
    key = lambda z: (z["pivot"], z["touches"] if (z["brk"] or 10**9) < cut else None, z["brk"] if (z["brk"] or 10**9) < cut else None)
    a = {key(z) for z in full if z["conf"] < cut - 1}
    b = {key(z) for z in part if z["conf"] < cut - 1}
    assert a == b


def test_support_break_departure_and_return():
    # Abwaertsbewegung zum Tief 90 (Pivot), Anstieg, 2. Beruehrung, Bruch, Entfernung, Rueckkehr
    path = list(np.linspace(100, 90, 11)) + list(np.linspace(91, 96, 6)) + [93, 91, 90.0, 92, 95, 97]
    path += [96, 93, 89, 86, 84, 83, 84, 86, 88, 89.8, 90.1, 88]
    df = frame(path, wick=0.1)
    zones = [z for z in find_zones(Bars.build(df, 1), 3) if abs(z["zl"] - 89.9) < 0.3]
    assert len(zones) == 1
    z = zones[0]
    assert z["touches"] == 2
    assert z["brk"] is not None and df.close.iloc[z["brk"]] < z["zl"]
    assert z["visit"] is not None and df.high.iloc[z["visit"]] >= z["zl"]
