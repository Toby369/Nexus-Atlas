import numpy as np
import pandas as pd

from wavetrend import LAZYBEAR_ORIGINAL, VUMANCHU_DEFAULT, WaveTrendParams, compute_wavetrend


def _flat_df(n: int, price: float = 100.0) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=n, freq="1h", tz="UTC")
    return pd.DataFrame({"open": price, "high": price, "low": price, "close": price}, index=idx)


def test_flat_price_series_wavetrend_is_undefined_everywhere():
    # Konstanter Preis -> esa=price, de=0 fuer JEDE Bar -> ci=(src-esa)/(0.015*de)
    # ist ueberall 0/0=NaN, nicht nur in der Anlaufzeit. Das ist ein legitimer
    # Kantenfall der Formel selbst (keine Volatilitaet = Oszillator
    # undefiniert), kein Implementierungsfehler -- hier bewusst dokumentiert
    # statt versteckt/kuenstlich aufgefuellt.
    df = _flat_df(60)
    params = WaveTrendParams(chlen=9, avg=12, malen=3, label="test")
    wt = compute_wavetrend(df, params)
    assert wt["wt1"].isna().all()
    assert wt["wt2"].isna().all()


def test_warmup_period_is_nan_not_fabricated():
    df = pd.DataFrame(
        {"open": np.linspace(100, 120, 40), "high": np.linspace(101, 121, 40),
         "low": np.linspace(99, 119, 40), "close": np.linspace(100, 120, 40)},
        index=pd.date_range("2025-01-01", periods=40, freq="1h", tz="UTC"),
    )
    wt = compute_wavetrend(df, VUMANCHU_DEFAULT)
    # chlen=9 -> esa/de erst ab Index 8 gueltig; avg=12 auf ci angewandt
    # verschiebt wt1 weiter nach hinten; wt2 (SMA 3 auf wt1) nochmal.
    assert wt["wt1"].iloc[:19].isna().all()  # 9+12-2 rein rechnerisch konservativ NaN
    assert wt["wt2"].notna().any()


def test_lazybear_and_vumanchu_presets_differ():
    df = pd.DataFrame(
        {
            "open": 100 + np.sin(np.linspace(0, 20, 200)) * 5,
            "high": 101 + np.sin(np.linspace(0, 20, 200)) * 5,
            "low": 99 + np.sin(np.linspace(0, 20, 200)) * 5,
            "close": 100 + np.sin(np.linspace(0, 20, 200)) * 5,
        },
        index=pd.date_range("2025-01-01", periods=200, freq="1h", tz="UTC"),
    )
    wt_lb = compute_wavetrend(df, LAZYBEAR_ORIGINAL)
    wt_vm = compute_wavetrend(df, VUMANCHU_DEFAULT)
    tail_lb = wt_lb["wt2"].dropna()
    tail_vm = wt_vm["wt2"].dropna()
    assert len(tail_lb) > 0 and len(tail_vm) > 0
    # Unterschiedliche Parameter muessen zu unterschiedlichen Werten fuehren
    # (sonst waere eines der beiden Presets im Code faktisch wirkungslos).
    common_idx = tail_lb.index.intersection(tail_vm.index)
    assert not np.allclose(tail_lb.loc[common_idx].to_numpy(), tail_vm.loc[common_idx].to_numpy())
