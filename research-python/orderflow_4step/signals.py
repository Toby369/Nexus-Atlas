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
    df_trig: pd.DataFrame
    df_struct: pd.DataFrame
    df_regime: pd.DataFrame
    funding: pd.Series
    vwap: pd.DataFrame = field(init=False)
    delta: pd.Series = field(init=False)
    delta_z: pd.Series = field(init=False)
    atr: pd.Series = field(init=False)
    regime_hi: pd.Series = field(init=False)
    structure_hi: pd.Series = field(init=False)
    funding_z: pd.Series = field(init=False)
    swing_highs: pd.DataFrame = field(init=False)
    profile: pd.DataFrame | None = None
    direction: str = "long"
    funding_fallback: float = C.FUNDING_FALLBACK
    tf: C.Timeframe = C.TF_15M
    """df_trig/df_struct/df_regime: Kerzen fuer Ausloeser, Struktur und Regime laut `tf`
    (Grund-Protokoll 15m/1h/4h, Variante C 1h/4h/1d)."""

    def __post_init__(self) -> None:
        self.vwap = F.session_vwap(self.df_trig, self.tf.anchor)
        self.delta = F.taker_delta(self.df_trig)
        self.delta_z = F.delta_zscore(self.delta, self.tf.delta_z_window)
        self.atr = F.atr_trigger(self.df_trig)
        self.regime_hi = F.regime_4h(self.df_regime)
        self.structure_hi = pd.Series(
            F.causal_structure_trend(self.df_struct["high"].to_numpy(), self.df_struct["low"].to_numpy()),
            index=self.df_struct.index,
        )
        self.funding_z = F.funding_zscore_series(self.funding)
        self.swing_highs = F.confirmed_swing_highs(self.df_struct, bar_length=self.tf.structure_bar)
        if self.profile is None:
            self.profile = F.volume_profile(self.df_trig, bars=self.tf.profile_bars, bucket_pct=self.tf.bucket_pct)

    @classmethod
    def load(cls, cache_profile: bool = True, tf: C.Timeframe = C.TF_15M) -> "Dataset":
        df_trig = load_candles(tf.trigger)
        profile = None
        cache = DATA_DIR / f"profile_{tf.name}.csv"
        if cache_profile and cache.exists():
            cached = pd.read_csv(cache, index_col=0, parse_dates=True)
            if len(cached) == len(df_trig) and cached.index.equals(df_trig.index):
                profile = cached
        ds = cls(df_trig, load_candles(tf.structure), load_candles(tf.regime), load_funding(), profile=profile, tf=tf)
        if cache_profile and profile is None:
            ds.profile.to_csv(cache)
        return ds


_REGIME_MIRROR = {
    "TREND_EXPANSION_BULLISH": "TREND_EXPANSION_BEARISH",
    "TREND_EXPANSION_BEARISH": "TREND_EXPANSION_BULLISH",
    "TREND_FORMING_BULLISH": "TREND_FORMING_BEARISH",
    "TREND_FORMING_BEARISH": "TREND_FORMING_BULLISH",
}


def mirror_regime(regime: object) -> object:
    return _REGIME_MIRROR.get(regime, regime)


def _mirror_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(
        {"open": -df["open"], "high": -df["low"], "low": -df["high"], "close": -df["close"], "volume": df["volume"]},
        index=df.index,
    )
    if "taker_buy_base_vol" in df:
        out["taker_buy_base_vol"] = df["volume"] - df["taker_buy_base_vol"]
    return out


def mirrored(ds: Dataset) -> Dataset:
    """Short-Sicht (Protokoll Nachtrag 3): Hoch/Tief getauscht, Preise und Delta negiert,
    Funding negiert, Regime-Richtungen getauscht. Damit gelten die Long-Regeln 1:1 als
    gespiegelte Short-Regeln. 4h-Regime und Volumenprofil werden aus dem Original
    uebernommen und nur umbenannt bzw. gespiegelt (Bollinger-Bandbreite und
    Bucket-Raster sind fuer negative Preise nicht definiert).
    """
    m = object.__new__(Dataset)
    m.df_trig = _mirror_ohlc(ds.df_trig)
    m.df_struct = _mirror_ohlc(ds.df_struct)
    m.df_regime = ds.df_regime
    m.funding = -ds.funding
    m.vwap = pd.DataFrame({"vwap": -ds.vwap["vwap"], "vwap_sigma": ds.vwap["vwap_sigma"],
                           "vwap_bars": ds.vwap["vwap_bars"]}, index=ds.vwap.index)
    m.delta = -ds.delta
    m.delta_z = -ds.delta_z
    m.atr = ds.atr
    m.regime_hi = ds.regime_hi.map(mirror_regime)
    m.structure_hi = pd.Series(
        F.causal_structure_trend(m.df_struct["high"].to_numpy(), m.df_struct["low"].to_numpy()), index=ds.df_struct.index
    )
    m.funding_z = -ds.funding_z
    m.swing_highs = F.confirmed_swing_highs(m.df_struct, bar_length=ds.tf.structure_bar)
    m.profile = pd.DataFrame({"poc": -ds.profile["poc"], "val": -ds.profile["vah"], "vah": -ds.profile["val"]},
                             index=ds.profile.index)
    m.tf = ds.tf
    m.direction = "short"
    m.funding_fallback = -C.FUNDING_FALLBACK
    return m


def env_class(regime: object) -> str:
    if regime in C.REGIMES_NORMAL:
        return "normal"
    if regime in C.REGIMES_STRICT:
        return "strict"
    return "none"


def target_candidates(ds: Dataset, pos: np.ndarray, target_mode: str) -> tuple[np.ndarray, np.ndarray]:
    """Kandidaten fuer Ziel 1 an Position `pos`.

    vwap_poc: Grund-Protokoll (naeherer von VWAP/POC). va_edge: Variante B,
    gegenueberliegender Value-Area-Rand (Long: VAH; in der gespiegelten Short-Sicht
    ist vah = -VAL, also VAL).
    """
    if target_mode == "vwap_poc":
        return ds.vwap["vwap"].to_numpy()[pos], ds.profile["poc"].to_numpy()[pos]
    if target_mode == "va_edge":
        return ds.profile["vah"].to_numpy()[pos], np.full(len(pos), np.nan)
    raise ValueError(target_mode)


def build_setups(ds: Dataset, delta_z_max: float = C.DELTA_Z_MAX, sigma_normal: float = C.SIGMA_NORMAL,
                 new_low_lookback: int = C.NEW_LOW_LOOKBACK, target_mode: str = C.TARGET_MODE) -> pd.DataFrame:
    df_trig = ds.df_trig
    absorption = F.absorption_bars(df_trig, ds.delta_z, delta_z_max, new_low_lookback)
    pairs = F.find_confirmations(df_trig, ds.delta, absorption)
    a = pairs["abs_pos"].to_numpy()
    c = pairs["conf_pos"].to_numpy()
    idx = df_trig.index
    low = df_trig["low"].to_numpy()
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

    abs_close = idx[a] + ds.tf.bar
    regime = F.asof_closed(ds.regime_hi, ds.tf.regime_bar, abs_close)
    structure = F.asof_closed(ds.structure_hi, ds.tf.structure_bar, abs_close)
    fz = F.asof_closed(ds.funding_z, pd.Timedelta(0), abs_close)
    classes = np.array([env_class(r) for r in regime], dtype=object)
    funding_block = np.nan_to_num(fz.astype(float), nan=-np.inf) > C.FUNDING_Z_MAX
    env_ok = (classes != "none") & (structure != "bearish") & ~funding_block

    out = pd.DataFrame(
        {
            "abs_pos": a,
            "conf_pos": c,
            "entry_pos": c + 1,
            "signal_time": idx[c] + ds.tf.bar,
            "stop": low[a] - C.STOP_ATR_BUFFER * atr[c],
            "target_a": target_candidates(ds, c, target_mode)[0],
            "target_b": target_candidates(ds, c, target_mode)[1],
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


def random_setups(ds: Dataset, start: pd.Timestamp, end: pd.Timestamp, n: int, rng: np.random.Generator,
                  target_mode: str = C.TARGET_MODE) -> pd.DataFrame:
    """V0: n zufaellige Einstiegskerzen im Abschnitt, Stop aus den 3 Vorkerzen."""
    idx = ds.df_trig.index
    candidates = np.flatnonzero((idx >= start) & (idx < end))
    candidates = candidates[candidates > C.V0_STOP_LOOKBACK]
    n = min(n, len(candidates))
    e = np.sort(rng.choice(candidates, size=n, replace=False))
    low = ds.df_trig["low"].to_numpy()
    prior_low = np.min(np.stack([low[e - k] for k in range(1, C.V0_STOP_LOOKBACK + 1)]), axis=0)
    out = pd.DataFrame(
        {
            "entry_pos": e,
            "stop": prior_low - C.STOP_ATR_BUFFER * ds.atr.to_numpy()[e - 1],
            "target_a": target_candidates(ds, e - 1, target_mode)[0],
            "target_b": target_candidates(ds, e - 1, target_mode)[1],
        }
    )
    return out[np.isfinite(out["stop"])].reset_index(drop=True)


def ensure_output_dir() -> Path:
    out = Path(__file__).resolve().parent / "output"
    out.mkdir(exist_ok=True)
    return out
