"""Continuous feature engineering for the multivariate (logistic
regression) candidate model.

Deliberately different in kind from ``src/features/legacy_factors.py``:
that module reproduces the PRODUCTION -1/0/1 discretization (for a
mechanics benchmark against the same hand-built thresholds). This module
keeps the underlying continuous/ordinal values instead, so a learned model
can find its own weighting and thresholds rather than inheriting the
production engine's hand-picked ones (RSI>55, ADX<20, funding>0.0005, ...).

No Supabase/production imports, no network access -- operates on a
DataFrame already exported via
``research-python/data/export_multivariate_snapshot.sql``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = [
    "CORE_FEATURE_COLUMNS",
    "ONCHAIN_FEATURE_COLUMNS",
    "build_features",
]

# Price/derivatives features -- available for the full 2-year backfilled
# history (>=99% coverage after dropping the ~14-day indicator warmup).
CORE_FEATURE_COLUMNS = [
    "rsi_14",
    "macd_histogram",
    "adx_14",
    "di_diff",  # plus_di - minus_di (signed trend-direction strength)
    "ema50_dist_pct",
    "ema200_dist_pct",
    "vwap_dist_pct",
    "cvd_delta",
    "structure_ord",
    "avg_funding_rate",
    "macro_ord",
    "sentiment_ord",
]

# On-chain features -- near-full coverage over the same 2-year window
# (backfilled from bitcoin-data.com/BGeometrics), but a handful of NaN
# days (LTH net-position-change has ~5 missing days in the export). Kept
# as a separate, optional block so a "core-only" and a "core+onchain"
# model can be trained and compared on their own respective valid rows.
ONCHAIN_FEATURE_COLUMNS = [
    "onchain_sopr",
    "onchain_mvrv",
    "onchain_lth_net_position_change_btc",
    "onchain_stablecoin_supply_chg_pct",
    "onchain_whale_addr_count",
]

_STRUCTURE_MAP = {"bullish": 1.0, "ranging": 0.0, "bearish": -1.0}
# Ordinal, NOT pre-flipped to match production's contrarian treatment of
# funding/basis -- the model is meant to learn its own sign from data,
# not inherit the hand-built engine's assumptions.
_MACRO_MAP = {"Risk-On": 1.0, "Neutral": 0.0, "Mixed": 0.0, "Risk-Off": -1.0}
_SENTIMENT_MAP = {
    "Extreme Fear": 1.0,
    "Fear": 2.0,
    "Neutral": 3.0,
    "Greed": 4.0,
    "Extreme Greed": 5.0,
}


def build_features(raw: pd.DataFrame) -> pd.DataFrame:
    """Engineer continuous/ordinal features + the 24h-forward label from
    the raw export.

    Returns a new DataFrame indexed the same as ``raw`` (chronological,
    NOT re-sorted -- caller's responsibility to have exported it sorted),
    with ``CORE_FEATURE_COLUMNS`` + ``ONCHAIN_FEATURE_COLUMNS`` +
    ``label_up`` (1 if price rose over the next 24h, 0 if not, NaN if the
    forward price is not yet available -- rows with NaN label must be
    dropped by the caller before training, never imputed).
    """
    df = raw.copy()

    df["di_diff"] = df["plus_di"] - df["minus_di"]
    df["ema50_dist_pct"] = (df["close_price"] - df["ema_50"]) / df["ema_50"] * 100.0
    df["ema200_dist_pct"] = (df["close_price"] - df["ema_200"]) / df["ema_200"] * 100.0
    df["vwap_dist_pct"] = (df["close_price"] - df["vwap"]) / df["vwap"] * 100.0

    df["structure_ord"] = df["structure_trend"].map(_STRUCTURE_MAP)
    df["macro_ord"] = df["macro_regime"].map(_MACRO_MAP)
    df["sentiment_ord"] = df["sentiment_classification"].map(_SENTIMENT_MAP)

    df["onchain_stablecoin_supply_chg_pct"] = df["onchain_stablecoin_supply"].pct_change() * 100.0

    df["label_up"] = np.where(
        df["close_price_fwd_24h"].isna(),
        np.nan,
        (df["close_price_fwd_24h"] > df["close_price"]).astype(float),
    )
    df["forward_return_pct"] = (df["close_price_fwd_24h"] - df["close_price"]) / df["close_price"] * 100.0

    keep = ["candle_open_time"] + CORE_FEATURE_COLUMNS + ONCHAIN_FEATURE_COLUMNS + ["label_up", "forward_return_pct"]
    return df[keep]
