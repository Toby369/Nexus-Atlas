"""Baut die vollstaendige Feature+Target-Matrix fuer EINE Studien-Konfiguration
(LTF + HTF-Paar + WaveTrend-Preset) zusammen -- reine Orchestrierung der
bereits einzeln getesteten Bausteine (wavetrend.py, mtf_join.py, features.py,
targets.py, baselines.py). Keine eigene neue Rechenlogik hier.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from baselines import compute_all_baselines
from features import THRESHOLD_LEVELS, WAVE_NAMES, compute_htf_observations, join_htf_to_ltf, mtf_confluence
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
    - htfA_wt1/htfA_wt2 (Rohwerte), htfA_{wave}_direction (wave in wt1/wt2),
      htfA_{wave}_{level}_state/_dist_from_ob/_dist_from_os/_cross_*/
      _anchor_duration_* (level in L1/L2/L3, siehe features.THRESHOLD_LEVELS)
      -- dieselbe Struktur fuer htfB_*
    - mtf_confluence_{wave}_{level} (6 Spalten, je Welle x Level)
    - forward_return_*/direction_*/abs_return_*/mfe_*/mae_* (alle 6 Horizonte)
    - baseline_momentum/baseline_ema_trend/baseline_rsi/baseline_macd_hist
    """
    obs_a = compute_htf_observations(htf_a_df, wt_params)
    obs_b = compute_htf_observations(htf_b_df, wt_params)

    joined_a = join_htf_to_ltf(ltf_df, setup.ltf, obs_a, setup.htf_a, prefix="htfA")
    joined_b = join_htf_to_ltf(ltf_df, setup.ltf, obs_b, setup.htf_b, prefix="htfB")

    horizon_bars = horizon_bars_for_timeframe(setup.ltf)
    targets = compute_forward_return_targets(ltf_df, horizon_bars)
    baselines = compute_all_baselines(ltf_df, MOMENTUM_LOOKBACK_BARS[setup.ltf])

    out = pd.concat([joined_a, joined_b, targets, baselines], axis=1)

    # MTF-Konfluenz (Aufgabenstellung v2, TEST 9/10) -- je (Welle x
    # Threshold-Level) getrennt, da Kategorie D besteht, welche Kombination
    # StormCat1 tatsaechlich verwendet (siehe Reconstruction-Dokument).
    for wave in WAVE_NAMES:
        for level in THRESHOLD_LEVELS:
            col = f"mtf_confluence_{wave}_{level}"
            out[col] = mtf_confluence(joined_a[f"htfA_{wave}_{level}_state"], joined_b[f"htfB_{wave}_{level}_state"])

    return out
