"""Setups je Variante (Protokoll Abschnitte 2-4 und 6).

`Dataset` rechnet alle Merkmale einmal; `build_setups` liefert je
Absorption+Bestaetigung eine Zeile mit allen Filter-Flags, `select_variant`
waehlt daraus die Setups einer Variante.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from orderflow_4step import config as C
from orderflow_4step import features as F
from orderflow_4step.data import DATA_DIR, load_candles, load_funding


@dataclass
class Dataset:
    df15: pd.DataFrame
    df1h: pd.DataFrame
    df4h: pd.DataFrame
    funding: pd.Series
    vwap: pd.DataFrame = field(init=False)
    delta: pd.Series = field(init=False)
    delta_z: pd.Series = field(init=False)
    atr: pd.Series = field(init=False)
    regime4h: pd.Series = field(init=False)
    structure1h: pd.Series = field(init=False)
    funding_z: pd.Series = field(init=False)
    swing_highs: pd.DataFrame = field(init=False)
    profile: pd.DataFrame | None = None

    def __post_init__(self) -> None:
        self.vwap = F.session_vwap(self.df15)
        self.delta = F.taker_delta(self.df15)
        self.delta_z = F.delta_zscore(self.delta)
        self.atr = F.atr_15m(self.df15)
        self.regime4h = F.regime_4h(self.df4h)
        self.structure1h = pd.Series(
            F.causal_structure_trend(self.df1h["high"].to_numpy(), self.df1h["low"].to_numpy()),
            index=self.df1h.index,
        )
        self.funding_z = F.funding_zscore_series(self.funding)
        self.swing_highs = F.confirmed_swing_highs(self.df1h)
        if self.profile is None:
            self.profile = F.volume_profile(self.df15)

    @classmethod
    def load(cls, cache_profile: bool = True) -> "Dataset":
        df15 = load_candles("15m")
        profile = None
        cache = DATA_DIR / "profile_15m.csv"
        if cache_profile and cache.exists():
            cached = pd.read_csv(cache, index_col=0, parse_dates=True)
            if len(cached) == len(df15) and cached.index.equals(df15.index):
                profile = cached
        ds = cls(df15, load_candles("1h"), load_candles("4h"), load_funding(), profile=profile)
        if cache_profile and profile is None:
            ds.profile.to_csv(cache)
        return ds


def env_class(regime: object) -> str:
    if regime in C.REGIMES_NORMAL:
        return "normal"
    if regime in C.REGIMES_STRICT:
        return "strict"
    return "none"


def build_setups(ds: Dataset, delta_z_max: float = C.DELTA_Z_MAX, sigma_normal: float = C.SIGMA_NORMAL,
                 new_low_lookback: int = C.NEW_LOW_LOOKBACK) -> pd.DataFrame:
    df15 = ds.df15
    absorption = F.absorption_bars(df15, ds.delta_z, delta_z_max, new_low_lookback)
    pairs = F.find_confirmations(df15, ds.delta, absorption)
    a = pairs["abs_pos"].to_numpy()
    c = pairs["conf_pos"].to_numpy()
    idx = df15.index
    low = df15["low"].to_numpy()
    vwap = ds.vwap["vwap"].to_numpy()
    sigma = ds.vwap["vwap_sigma"].to_numpy()
    vbars = ds.vwap["vwap_bars"].to_numpy()
    val = ds.profile["val"].to_numpy()
    poc = ds.profile["poc"].to_numpy()
    atr = ds.atr.to_numpy()

    def location(sig_mult: float) -> np.ndarray:
        by_vwap = (vbars[a] >= C.VWAP_MIN_BARS) & (low[a] <= vwap[a] - sig_mult * sigma[a])
        by_va = low[a] < val[a]
        return np.nan_to_num(by_vwap, nan=False).astype(bool) | np.nan_to_num(by_va, nan=False).astype(bool)

    abs_close = idx[a] + F.BAR_15M
    regime = F.asof_closed(ds.regime4h, pd.Timedelta(hours=4), abs_close)
    structure = F.asof_closed(ds.structure1h, pd.Timedelta(hours=1), abs_close)
    fz = F.asof_closed(ds.funding_z, pd.Timedelta(0), abs_close)
    classes = np.array([env_class(r) for r in regime], dtype=object)
    funding_block = np.nan_to_num(fz.astype(float), nan=-np.inf) > C.FUNDING_Z_MAX
    env_ok = (classes != "none") & (structure != "bearish") & ~funding_block

    out = pd.DataFrame(
        {
            "abs_pos": a,
            "conf_pos": c,
            "entry_pos": c + 1,
            "signal_time": idx[c] + F.BAR_15M,
            "stop": low[a] - C.STOP_ATR_BUFFER * atr[c],
            "vwap_c": vwap[c],
            "poc_c": poc[c],
            "regime": regime,
            "env_class": classes,
            "structure_1h": structure,
            "funding_z": fz.astype(float),
            "env_ok": env_ok,
            "loc_normal": location(sigma_normal),
            "loc_strict": location(C.SIGMA_STRICT),
        }
    )
    out = out[np.isfinite(out["stop"])]
    return out.sort_values("entry_pos").reset_index(drop=True)


def select_variant(setups: pd.DataFrame, variant: str) -> pd.DataFrame:
    if variant == "V1":
        mask = np.ones(len(setups), dtype=bool)
    elif variant == "V2":
        mask = setups["loc_normal"].to_numpy()
    elif variant in ("V3", "V4"):
        loc = np.where(setups["env_class"] == "strict", setups["loc_strict"], setups["loc_normal"])
        mask = setups["env_ok"].to_numpy() & loc.astype(bool)
    else:
        raise ValueError(variant)
    return setups[mask]


def in_split(setups: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    t = setups["signal_time"]
    return setups[(t >= start) & (t < end)]


def random_setups(ds: Dataset, start: pd.Timestamp, end: pd.Timestamp, n: int, rng: np.random.Generator
                  ) -> pd.DataFrame:
    """V0: n zufaellige Einstiegskerzen im Abschnitt, Stop aus den 3 Vorkerzen."""
    idx = ds.df15.index
    candidates = np.flatnonzero((idx >= start) & (idx < end))
    candidates = candidates[candidates > C.V0_STOP_LOOKBACK]
    n = min(n, len(candidates))
    e = np.sort(rng.choice(candidates, size=n, replace=False))
    low = ds.df15["low"].to_numpy()
    prior_low = np.min(np.stack([low[e - k] for k in range(1, C.V0_STOP_LOOKBACK + 1)]), axis=0)
    out = pd.DataFrame(
        {
            "entry_pos": e,
            "stop": prior_low - C.STOP_ATR_BUFFER * ds.atr.to_numpy()[e - 1],
            "vwap_c": ds.vwap["vwap"].to_numpy()[e - 1],
            "poc_c": ds.profile["poc"].to_numpy()[e - 1],
        }
    )
    return out[np.isfinite(out["stop"])].reset_index(drop=True)


def ensure_output_dir() -> Path:
    out = Path(__file__).resolve().parent / "output"
    out.mkdir(exist_ok=True)
    return out
