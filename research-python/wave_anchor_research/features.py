"""Wave-Anchor-Feature-Engine (Aufgabenstellung Abschnitt 4) -- reine
Feature-Extraktion, KEINE LONG/SHORT-Signalumwandlung. Alle Groessen werden
auf HTF-Ebene (je bestaetigter HTF-Bar) berechnet und danach via
`mtf_join.confirmed_asof_join` look-ahead-sicher auf die LTF-Zeitachse
projiziert -- derselbe Join-Mechanismus fuer Zustand, Richtung, Distanz,
Cross-Events und Anchor-Dauer, damit alle Groessen exakt dieselbe
Verfuegbarkeitsregel teilen (siehe WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md).

Cross-Events sind bewusst "sticky" fuer die Dauer einer HTF-Periode
(dieselbe Join-Semantik wie State/Direction) statt nur fuer die exakt eine
LTF-Bar der Bestaetigung selbst zu gelten -- dokumentierte Design-
entscheidung, nicht Teil der (nicht zugaenglichen) Original-Spezifikation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from mtf_join import close_time_of, confirmed_asof_join
from wavetrend import WaveTrendParams, compute_wavetrend

OB_THRESHOLD = 60.0
OS_THRESHOLD = -60.0


def _state(wt2: pd.Series) -> pd.Series:
    # .astype(object) VOR .where(..., other=None): pandas' Default-String-
    # Dtype wuerde `None` sonst in seine eigene NA-Repraesentation
    # umwandeln (zeigt sich als "nan" beim Ausgeben, ist aber NICHT `is
    # None` -- fuehrt zu stillen Fehlern in nachgelagerten `is None`-
    # Vergleichen, siehe tests/test_features.py).
    return pd.Series(
        np.select([wt2 > OB_THRESHOLD, wt2 < OS_THRESHOLD], ["OB", "OS"], default="NEUTRAL"),
        index=wt2.index,
    ).astype(object).where(wt2.notna(), other=None)


def _direction(wt2: pd.Series, flat_epsilon: float = 0.0) -> pd.Series:
    diff = wt2.diff()
    return pd.Series(
        np.select([diff > flat_epsilon, diff < -flat_epsilon], ["RISING", "FALLING"], default="FLAT"),
        index=wt2.index,
    ).astype(object).where(diff.notna(), other=None)


def _anchor_duration(state: pd.Series, target_state: str) -> pd.Series:
    """Anzahl aufeinanderfolgender bestaetigter HTF-Bars, die UNUNTERBROCHEN
    im Zustand `target_state` waren (0 sobald der Zustand verlassen wird)."""
    is_target = (state == target_state).to_numpy()
    out = np.zeros(len(is_target), dtype=float)
    run = 0
    for i, flag in enumerate(is_target):
        run = run + 1 if flag else 0
        out[i] = run
    out[state.isna().to_numpy()] = np.nan
    return pd.Series(out, index=state.index)


def compute_htf_observations(htf_df: pd.DataFrame, wt_params: WaveTrendParams) -> pd.DataFrame:
    """Eine Zeile je HTF-Bar: wt2, state, direction, distance_from_ob/os,
    cross-events, anchor-duration. `state`/`direction` sind None solange
    `wt2` selbst NaN ist (Anlaufzeit der WaveTrend-Formel, siehe
    wavetrend.py)."""
    wt = compute_wavetrend(htf_df, wt_params)
    wt2 = wt["wt2"]

    state = _state(wt2)
    direction = _direction(wt2)

    dist_from_ob = OB_THRESHOLD - wt2
    dist_from_os = wt2 - OS_THRESHOLD

    prev = wt2.shift(1)
    cross_up_60 = (prev < OB_THRESHOLD) & (wt2 >= OB_THRESHOLD)
    cross_down_60 = (prev >= OB_THRESHOLD) & (wt2 < OB_THRESHOLD)
    cross_down_minus60 = (prev > OS_THRESHOLD) & (wt2 <= OS_THRESHOLD)
    cross_up_minus60 = (prev <= OS_THRESHOLD) & (wt2 > OS_THRESHOLD)
    # Waehrend der Anlaufzeit (prev oder wt2 NaN) ist kein Cross feststellbar.
    valid = wt2.notna() & prev.notna()
    for c in (cross_up_60, cross_down_60, cross_down_minus60, cross_up_minus60):
        c &= valid

    anchor_duration_ob = _anchor_duration(state, "OB")
    anchor_duration_os = _anchor_duration(state, "OS")

    return pd.DataFrame(
        {
            "wt2": wt2,
            "state": state,
            "direction": direction,
            "dist_from_ob60": dist_from_ob,
            "dist_from_os60": dist_from_os,
            "cross_up_60": cross_up_60,
            "cross_down_60": cross_down_60,
            "cross_down_minus60": cross_down_minus60,
            "cross_up_minus60": cross_up_minus60,
            "anchor_duration_ob": anchor_duration_ob,
            "anchor_duration_os": anchor_duration_os,
        },
        index=htf_df.index,
    )


def join_htf_to_ltf(
    ltf_df: pd.DataFrame,
    ltf_interval: str,
    htf_observations: pd.DataFrame,
    htf_interval: str,
    prefix: str,
) -> pd.DataFrame:
    """Projiziert alle Spalten von `compute_htf_observations` look-ahead-
    sicher auf die LTF-Zeitachse von `ltf_df` (Index = LTF open_time),
    Spalten mit `prefix_` versehen (z.B. `htf_1h_state`). Ergebnis-Index =
    `ltf_df.index` (Reihenfolge bleibt erhalten, `confirmed_asof_join`
    sortiert intern nur eine Kopie)."""
    ltf_close = close_time_of(ltf_df, ltf_interval)
    cols = list(htf_observations.columns)
    joined = confirmed_asof_join(ltf_close, htf_observations, htf_interval, cols)
    joined = joined.reset_index(drop=True)
    joined.index = ltf_df.index
    joined.columns = [f"{prefix}_{c}" for c in cols]
    return joined


def mtf_confluence(state_a: pd.Series, state_b: pd.Series) -> pd.Series:
    """Kombinierter Zustand zweier HTF-States: wenn beide identisch (OB/OB,
    OS/OS, NEUTRAL/NEUTRAL) -> dieser Zustand; sonst 'MIXED'. NaN, wenn
    einer der beiden fehlt."""
    both_known = state_a.notna() & state_b.notna()
    combined = pd.Series(np.where(state_a == state_b, state_a, "MIXED"), index=state_a.index).astype(object)
    return combined.where(both_known, other=None)
