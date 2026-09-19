import numpy as np
import pandas as pd

from regime import compute_daily_regimes


def _df_from_close(close_values: np.ndarray) -> pd.DataFrame:
    # WICHTIG: `close` muss denselben Index wie `df` tragen, BEVOR es in
    # den DataFrame-Konstruktor eingeht -- pandas richtet Series in einem
    # dict-Konstruktor an ihrem EIGENEN Index aus, nicht positionell. Ohne
    # das hier wuerde jede Spalte stillschweigend komplett NaN werden
    # (RangeIndex 0..n vs. der uebergebene DatetimeIndex haben keine
    # gemeinsamen Labels) -- realer Bug, der beim ersten Testlauf auftrat.
    idx = pd.date_range("2025-01-01", periods=len(close_values), freq="1D", tz="UTC")
    close = pd.Series(close_values, index=idx)
    return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1, "close": close}, index=idx)


def test_strong_uptrend_classified_bull():
    df = _df_from_close(np.linspace(100, 300, 80))
    regimes = compute_daily_regimes(df)
    assert regimes["trend_regime"].dropna().iloc[-1] == "BULL"


def test_strong_downtrend_classified_bear():
    df = _df_from_close(np.linspace(300, 100, 80))
    regimes = compute_daily_regimes(df)
    assert regimes["trend_regime"].dropna().iloc[-1] == "BEAR"


def test_vol_regime_has_three_terciles_with_enough_data():
    rng = np.random.default_rng(1)
    df = _df_from_close(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 200))))
    regimes = compute_daily_regimes(df)
    assert set(regimes["vol_regime"].dropna().unique()) <= {"LOW", "MID", "HIGH"}
    assert regimes["vol_regime"].notna().sum() > 100
