"""Kennzahlen auf R-Basis."""

from __future__ import annotations

import numpy as np
import pandas as pd


def summarize(trades: pd.DataFrame) -> dict:
    if trades.empty:
        return {"trades": 0, "win_rate": np.nan, "avg_r": np.nan, "t_stat": np.nan, "pf": np.nan,
                "total_r": 0.0, "max_dd_r": 0.0, "avg_cost_r": np.nan}
    r = trades["r"].to_numpy()
    wins, losses = r[r > 0].sum(), -r[r < 0].sum()
    equity = np.cumsum(r)
    dd = np.max(np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:] - equity)
    std = r.std(ddof=1) if len(r) > 1 else np.nan
    return {
        "trades": len(r),
        "win_rate": float((r > 0).mean()),
        "avg_r": float(r.mean()),
        # t-Statistik des mittleren R (|t| < 2 => nicht von 0 unterscheidbar)
        "t_stat": float(r.mean() / (std / np.sqrt(len(r)))) if std and std > 0 else np.nan,
        "pf": float(wins / losses) if losses > 0 else np.inf,
        "total_r": float(r.sum()),
        "max_dd_r": float(dd),
        "avg_cost_r": float(trades["cost_r"].mean()),
    }
