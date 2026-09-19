"""Baut die vollstaendige Feature+Target-Matrix fuer EINE Studien-Konfiguration
(LTF + HTF-Paar + WaveTrend-Preset) zusammen -- reine Orchestrierung der
bereits einzeln getesteten Bausteine (wavetrend.py, mtf_join.py, features.py,
targets.py, baselines.py). Keine eigene neue Rechenlogik hier.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from baselines import compute_all_baselines
from features import compute_htf_observations, join_htf_to_ltf, mtf_confluence
from targets import compute_forward_return_targets, horizon_bars_for_timeframe
from wavetrend import WaveTrendParams


@dataclass(frozen=True)
class StudySetup:
    ltf: str
    htf_a: str  # naeher (z.B. "1h" fuer LTF=15m; "4h" fuer LTF=1h)
    htf_b: str  # weiter (z.B. "4h" fuer LTF=15m; "1d" fuer LTF=1h)
    label: str


STUDY_SETUPS = [
    StudySetup(ltf="15m", htf_a="1h", htf_b="4h", label="15m monitors 1H+4H"),
    StudySetup(ltf="1h", htf_a="4h", htf_b="1d", label="1H monitors 4H+1D"),
]

MOMENTUM_LOOKBACK_BARS = {"15m": 16, "1h": 24}  # ~4h bzw. 1 Tag Rueckblick, timeframe-passend


def assemble(
    ltf_df: pd.DataFrame,
    htf_a_df: pd.DataFrame,
    htf_b_df: pd.DataFrame,
    setup: StudySetup,
    wt_params: WaveTrendParams,
) -> pd.DataFrame:
    """Ein DataFrame, Index = LTF open_time, Spalten:
    - htfA_*/htfB_* (wt2, state, direction, dist_*, cross_*, anchor_duration_*)
    - mtf_confluence_a_only, mtf_confluence_b_only (Aliase der Einzel-States,
      fuer Test G "1H only"/"4H only" etc.), mtf_confluence_combined
    - forward_return_*/direction_*/abs_return_*/mfe_*/mae_* (alle 6 Horizonte)
    - baseline_momentum/baseline_ema_trend/baseline_rsi/baseline_macd_hist
    """
    obs_a = compute_htf_observations(htf_a_df, wt_params)
    obs_b = compute_htf_observations(htf_b_df, wt_params)

    joined_a = join_htf_to_ltf(ltf_df, setup.ltf, obs_a, setup.htf_a, prefix="htfA")
    joined_b = join_htf_to_ltf(ltf_df, setup.ltf, obs_b, setup.htf_b, prefix="htfB")

    combined_state = mtf_confluence(joined_a["htfA_state"], joined_b["htfB_state"])

    horizon_bars = horizon_bars_for_timeframe(setup.ltf)
    targets = compute_forward_return_targets(ltf_df, horizon_bars)
    baselines = compute_all_baselines(ltf_df, MOMENTUM_LOOKBACK_BARS[setup.ltf])

    out = pd.concat([joined_a, joined_b, targets, baselines], axis=1)
    out["mtf_confluence_combined"] = combined_state
    return out
