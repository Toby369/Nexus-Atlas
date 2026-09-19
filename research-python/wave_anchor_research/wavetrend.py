"""WaveTrend-Oszillator (LazyBear-Original + VuManChu-Cipher-B-Tuning), siehe
docs/research/WAVE-ANCHOR-CODE-RECONSTRUCTION.md Abschnitt 1 -- exakte Formel
1:1 aus dem tatsächlich eingesehenen VuManChu-Cipher-B-Pine-Quelltext
reproduziert (Kategorie C dort), NICHT aus Wave Anchors eigenem (nicht
zugänglichen) Code.

    esa = EMA(src, chlen)
    de  = EMA(|src - esa|, chlen)
    ci  = (src - esa) / (0.015 * de)
    wt1 = EMA(ci, avg)
    wt2 = SMA(wt1, malen)

`src` = HLC3 (Default). Da Kategorie D besteht, ob Wave Anchor die
LazyBear-Originalparameter (n1=10/n2=21/signal=4) oder die VuManChu-Defaults
(chlen=9/avg=12/malen=3) verwendet, werden BEIDE Presets bereitgestellt und
in der Forschung parallel getestet (siehe config.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class WaveTrendParams:
    chlen: int  # Kanallaenge (esa/de EMA-Periode)
    avg: int  # wt1 EMA-Periode
    malen: int  # wt2 SMA-Periode (Signal-Laenge)
    label: str


LAZYBEAR_ORIGINAL = WaveTrendParams(chlen=10, avg=21, malen=4, label="LazyBear-Original (n1=10/n2=21/sig=4)")
VUMANCHU_DEFAULT = WaveTrendParams(chlen=9, avg=12, malen=3, label="VuManChu-Cipher-B-Default (9/12/3)")


def compute_wavetrend(df: pd.DataFrame, params: WaveTrendParams) -> pd.DataFrame:
    """df: OHLC-DataFrame (Spalten open/high/low/close), aufsteigend sortiert,
    DatetimeIndex. Gibt ein DataFrame mit Spalten wt1/wt2 zurueck, gleicher
    Index wie df. Erste `chlen`-1 (esa/de) bzw. weitere `avg`/`malen`-1 Werte
    sind NaN (EMA/SMA-Anlaufzeit) -- kein kuenstliches Auffuellen."""
    hlc3 = (df["high"] + df["low"] + df["close"]) / 3.0

    esa = hlc3.ewm(span=params.chlen, adjust=False, min_periods=params.chlen).mean()
    de = (hlc3 - esa).abs().ewm(span=params.chlen, adjust=False, min_periods=params.chlen).mean()
    ci = (hlc3 - esa) / (0.015 * de)
    wt1 = ci.ewm(span=params.avg, adjust=False, min_periods=params.avg).mean()
    wt2 = wt1.rolling(window=params.malen, min_periods=params.malen).mean()

    return pd.DataFrame({"wt1": wt1, "wt2": wt2}, index=df.index)
