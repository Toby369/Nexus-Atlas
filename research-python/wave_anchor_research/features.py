"""Wave-Anchor-Feature-Engine v2 (Aufgabenstellung v2, Abschnitt 5/6/11) -- reine
Feature-Extraktion, KEINE LONG/SHORT-Signalumwandlung. Alle Groessen werden auf
HTF-Ebene (je bestaetigter HTF-Bar) berechnet und danach via
`mtf_join.confirmed_asof_join` look-ahead-sicher auf die LTF-Zeitachse
projiziert -- derselbe Join-Mechanismus fuer Zustand, Richtung, Distanz,
Cross-Events und Anchor-Dauer, damit alle Groessen exakt dieselbe
Verfuegbarkeitsregel teilen (siehe WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md).

NEU in v2: WT1 und WT2 werden vollstaendig GETRENNT als Feature-Familien
exponiert (Aufgabenstellung Abschnitt 5 -- welche Welle StormCat1 tatsaechlich
verwendet, ist Kategorie D, siehe WAVE-ANCHOR-CODE-RECONSTRUCTION.md), und alle
drei aus der Primaerquelle bestaetigten Threshold-Paare (±53/±60/+100,-75,
Abschnitt 6) werden separat getestet statt nur ±60 anzunehmen.

Cross-Events sind bewusst "sticky" fuer die Dauer einer HTF-Periode (dieselbe
Join-Semantik wie State/Direction) statt nur fuer die exakt eine LTF-Bar der
Bestaetigung selbst zu gelten -- dokumentierte Design-Entscheidung, nicht Teil
der (nicht zugaenglichen) Original-Spezifikation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from mtf_join import close_time_of, confirmed_asof_join
from wavetrend import WaveTrendParams, compute_wavetrend

WAVE_NAMES = ["wt1", "wt2"]

# Aus der vom Nutzer gelieferten Pine-v4-Primaerquelle (Kategorie C, siehe
# WAVE-ANCHOR-CODE-RECONSTRUCTION.md Abschnitt 2): obLevel/osLevel (L1),
# obLevel2/osLevel2 (L2), obLevel3/osLevel3 (L3). Welches Paar StormCat1s Wave
# Anchor tatsaechlich verwendet: Kategorie D -- alle drei werden getestet.
THRESHOLD_LEVELS: dict[str, tuple[float, float]] = {
    "L1": (53.0, -53.0),
    "L2": (60.0, -60.0),
    "L3": (100.0, -75.0),
}


def _state(wave: pd.Series, ob: float, os_: float) -> pd.Series:
    # .astype(object) VOR .where(..., other=None): pandas' Default-String-
    # Dtype wuerde `None` sonst in seine eigene NA-Repraesentation
    # umwandeln (zeigt sich als "nan" beim Ausgeben, ist aber NICHT `is
    # None` -- fuehrt zu stillen Fehlern in nachgelagerten `is None`-
    # Vergleichen, siehe tests/test_features.py).
    return pd.Series(
        np.select([wave > ob, wave < os_], ["OB", "OS"], default="NEUTRAL"),
        index=wave.index,
    ).astype(object).where(wave.notna(), other=None)


def _direction(wave: pd.Series, flat_epsilon: float = 0.0) -> pd.Series:
    diff = wave.diff()
    return pd.Series(
        np.select([diff > flat_epsilon, diff < -flat_epsilon], ["RISING", "FALLING"], default="FLAT"),
        index=wave.index,
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
    """Eine Zeile je HTF-Bar. Rohwerte `wt1`/`wt2`, je Welle `{wave}_direction`,
    und je (Welle x Threshold-Level) ein vollstaendiger Feature-Satz:
    `{wave}_{level}_state`, `_dist_from_ob`, `_dist_from_os`, vier Cross-Events,
    zwei Anchor-Duration-Groessen. `state`/`direction` sind None solange die
    jeweilige Welle selbst NaN ist (Anlaufzeit der WaveTrend-Formel)."""
    wt = compute_wavetrend(htf_df, wt_params)

    out: dict[str, pd.Series] = {"wt1": wt["wt1"], "wt2": wt["wt2"]}

    for wave in WAVE_NAMES:
        series = wt[wave]
        out[f"{wave}_direction"] = _direction(series)

        for level, (ob, os_) in THRESHOLD_LEVELS.items():
            state = _state(series, ob, os_)
            prefix = f"{wave}_{level}"

            dist_from_ob = ob - series
            dist_from_os = series - os_

            prev = series.shift(1)
            cross_up_ob = (prev < ob) & (series >= ob)
            cross_down_ob = (prev >= ob) & (series < ob)
            cross_down_os = (prev > os_) & (series <= os_)
            cross_up_os = (prev <= os_) & (series > os_)
            valid = series.notna() & prev.notna()
            cross_up_ob &= valid
            cross_down_ob &= valid
            cross_down_os &= valid
            cross_up_os &= valid

            out[f"{prefix}_state"] = state
            out[f"{prefix}_dist_from_ob"] = dist_from_ob
            out[f"{prefix}_dist_from_os"] = dist_from_os
            out[f"{prefix}_cross_up_ob"] = cross_up_ob
            out[f"{prefix}_cross_down_ob"] = cross_down_ob
            out[f"{prefix}_cross_down_os"] = cross_down_os
            out[f"{prefix}_cross_up_os"] = cross_up_os
            out[f"{prefix}_anchor_duration_ob"] = _anchor_duration(state, "OB")
            out[f"{prefix}_anchor_duration_os"] = _anchor_duration(state, "OS")

    return pd.DataFrame(out, index=htf_df.index)


def join_htf_to_ltf(
    ltf_df: pd.DataFrame,
    ltf_interval: str,
    htf_observations: pd.DataFrame,
    htf_interval: str,
    prefix: str,
) -> pd.DataFrame:
    """Projiziert alle Spalten von `compute_htf_observations` look-ahead-
    sicher auf die LTF-Zeitachse von `ltf_df` (Index = LTF open_time),
    Spalten mit `prefix_` versehen (z.B. `htfA_wt2_L2_state`). Ergebnis-Index
    = `ltf_df.index` (Reihenfolge bleibt erhalten, `confirmed_asof_join`
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
    OS/OS, NEUTRAL/NEUTRAL) -> dieser Zustand; sonst 'MIXED'. None, wenn einer
    der beiden fehlt."""
    both_known = state_a.notna() & state_b.notna()
    combined = pd.Series(np.where(state_a == state_b, state_a, "MIXED"), index=state_a.index).astype(object)
    return combined.where(both_known, other=None)
