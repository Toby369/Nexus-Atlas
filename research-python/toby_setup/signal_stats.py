"""Stufe B: statistischer Test fuer Einzelsignale und Paare gegen die
Setup-Qualitaet, siehe docs/research/TOBY-SETUP-PHASEN-DEFINITION.md
Abschnitt "Testmethode Paar-/Dreier-Haeufigkeit" (mit Nutzer abgestimmt).

Kontrollgruppe: "restliche Setups in derselben Phase" (Zeile bereits durch
den Aufrufer auf eine Phase eingeschraenkt). Zwei Ziel-Typen je Zelle:
`reached_tp20` (binaer, Logit) und `final_mfe_margin_pct` (stetig, OLS),
beide mit HAC/Newey-West-robusten Standardfehlern -- 1:1 dieselbe Technik
wie `wave_anchor_research/incremental_value.py`. `block_length=384` =
max(10, 2*192) nach der in `stats_battery.py::_block_length_for_horizon`
etablierten Regel (192 Bars = 48h = der laengste moegliche Setup-Horizont).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tools.sm_exceptions import PerfectSeparationError

BLOCK_LENGTH = 384
MIN_N = 100


@dataclass
class CellResult:
    direction: str
    phase: str
    window: str
    kind: str  # "single" | "pair"
    signal: str
    n: int
    n_with_signal: int
    rate_with: float
    rate_without: float
    mean_mfe_with: float
    mean_mfe_without: float
    p_value_binary: float
    p_value_continuous: float
    status: str  # "OK" | "INSUFFICIENT_DATA" | "FIT_ERROR"
    error_message: str = ""


def evaluate_cell(
    sub: pd.DataFrame,
    indicator: pd.Series,
    direction: str,
    phase: str,
    window: str,
    kind: str,
    signal_label: str,
    block_length: int = BLOCK_LENGTH,
) -> CellResult:
    """`sub`: bereits auf eine Phase eingeschraenkter DataFrame mit Spalten
    `reached_tp20`/`final_mfe_margin_pct`. `indicator`: boolesche Serie
    (gleicher Index wie `sub`), True = Signal(-Kombination) anwesend.
    `block_length`: HAC-Fensterbreite, siehe Modul-Docstring fuer die
    Herleitungsregel -- Default 384 (15m-Setup-Basis, 192 Bars = 48h
    Horizont); bei anderer Setup-Aufloesung (z.B. 5m: 576 Bars = 48h,
    block_length=1152) vom Aufrufer explizit ueberschreiben."""
    n = len(sub)
    n_with = int(indicator.sum())
    n_without = n - n_with

    def _insufficient(msg: str = "") -> CellResult:
        return CellResult(
            direction, phase, window, kind, signal_label, n, n_with,
            np.nan, np.nan, np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA", msg,
        )

    if n_with < MIN_N or n_without < MIN_N:
        return _insufficient(f"n_with={n_with}, n_without={n_without}, MIN_N={MIN_N}")

    y_bin = sub["reached_tp20"].astype(int).to_numpy()
    y_cont = sub["final_mfe_margin_pct"].to_numpy()
    x = sm.add_constant(indicator.astype(int).to_numpy())

    rate_with = float(y_bin[indicator.to_numpy()].mean())
    rate_without = float(y_bin[~indicator.to_numpy()].mean())
    mean_with = float(y_cont[indicator.to_numpy()].mean())
    mean_without = float(y_cont[~indicator.to_numpy()].mean())

    try:
        if y_bin.sum() < 10 or (n - y_bin.sum()) < 10:
            p_bin = np.nan
        else:
            logit = sm.Logit(y_bin, x).fit(disp=0, cov_type="HAC", cov_kwds={"maxlags": block_length})
            p_bin = float(logit.pvalues[1])
        ols = sm.OLS(y_cont, x).fit(cov_type="HAC", cov_kwds={"maxlags": block_length})
        p_cont = float(ols.pvalues[1])
    except (PerfectSeparationError, np.linalg.LinAlgError, ValueError) as exc:
        return CellResult(
            direction, phase, window, kind, signal_label, n, n_with,
            rate_with, rate_without, mean_with, mean_without, np.nan, np.nan, "FIT_ERROR", str(exc),
        )

    return CellResult(
        direction, phase, window, kind, signal_label, n, n_with,
        rate_with, rate_without, mean_with, mean_without, p_bin, p_cont, "OK",
    )


def results_to_dataframe(results: list[CellResult]) -> pd.DataFrame:
    return pd.DataFrame([r.__dict__ for r in results])


def split_train_val_oos(df: pd.DataFrame, oos_fraction: float = 0.20, embargo_bars: int = 192) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Chronologischer 80/20-Split (df muss bereits nach entry_time
    sortiert sein) + Embargo: die letzten `embargo_bars` Zeilen von
    TRAIN_VAL werden entfernt, da ihr Outcome-Fenster (bis 48h = 192 Bars
    vorwaerts) sonst in den OOS-Zeitraum hineinreichen und dessen
    Preisinformation in ein TRAIN_VAL-Label durchsickern lassen wuerde."""
    assert df["entry_time"].is_monotonic_increasing
    n = len(df)
    split_idx = int(round(n * (1 - oos_fraction)))
    train_val = df.iloc[: max(0, split_idx - embargo_bars)]
    oos = df.iloc[split_idx:]
    return train_val, oos
