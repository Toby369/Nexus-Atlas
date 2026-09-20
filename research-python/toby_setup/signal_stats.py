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


@dataclass
class ContinuousResult:
    """Ergebnis fuer einen STETIGEN Praediktor (z.B. Konfluenz-Score = Anzahl
    gleichzeitig aktiver, richtungskonformer Signale) statt eines binaeren
    Einzelsignals -- siehe run_confluence_test_5m.py. Motivation: die
    Einzelsignal-/Paar-Tests in run_stage_b*.py verduennen jedes echte
    Konfluenz-Setup mit ~95%+ irrelevanten "kein Setup"-Zeilen und testen nie
    mehr als 2 Signale gleichzeitig -- ein Score-Regressor mit wenigen
    Zellen (Phase x Fenster) hat dagegen viel mehr Power pro Test (kein
    grosser BH-FDR-Pool noetig) und bildet echte Mehrfach-Uebereinstimmung ab."""

    direction: str
    phase: str
    window: str
    n: int
    max_score: int
    mean_score: float
    coef_binary: float
    p_value_binary: float
    coef_continuous: float
    p_value_continuous: float
    high_threshold: int
    n_high: int
    n_low: int
    rate_high: float
    rate_low: float
    mean_mfe_high: float
    mean_mfe_low: float
    status: str  # "OK" | "INSUFFICIENT_DATA" | "FIT_ERROR"
    error_message: str = ""


def evaluate_continuous_predictor(
    sub: pd.DataFrame,
    score: pd.Series,
    direction: str,
    phase: str,
    window: str,
    block_length: int = BLOCK_LENGTH,
    high_threshold: int | None = None,
) -> ContinuousResult:
    """`sub`: bereits auf eine Phase eingeschraenkter DataFrame mit Spalten
    `reached_tp20`/`final_mfe_margin_pct`. `score`: stetiger (nicht-negativer
    Integer) Konfluenz-Score, gleicher Index wie `sub`. `high_threshold`:
    Score-Schwelle fuer die deskriptive High-vs-Rest-Gegenueberstellung
    (Default: oberstes Quartil der beobachteten Score-Verteilung, mindestens
    1). Regression: score als STETIGER Regressor (nicht Gruppenindikator) --
    angemessener fuer eine Zaehlgroesse als ein With/Without-Split."""
    n = len(sub)
    max_score = int(score.max()) if n > 0 else 0

    def _insufficient(msg: str = "") -> ContinuousResult:
        return ContinuousResult(
            direction, phase, window, n, max_score, np.nan, np.nan, np.nan, np.nan, np.nan,
            high_threshold or 0, 0, 0, np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA", msg,
        )

    if n < 2 * MIN_N:
        return _insufficient(f"n={n}, MIN_N={MIN_N} (je Gruppe)")

    if high_threshold is None:
        high_threshold = max(1, int(np.quantile(score.to_numpy(), 0.75)))

    is_high = score >= high_threshold
    n_high = int(is_high.sum())
    n_low = n - n_high
    if n_high < MIN_N or n_low < MIN_N:
        return _insufficient(f"n_high={n_high}, n_low={n_low} bei high_threshold={high_threshold}, MIN_N={MIN_N}")

    y_bin = sub["reached_tp20"].astype(int).to_numpy()
    y_cont = sub["final_mfe_margin_pct"].to_numpy()
    x = sm.add_constant(score.to_numpy().astype(float))

    rate_high = float(y_bin[is_high.to_numpy()].mean())
    rate_low = float(y_bin[~is_high.to_numpy()].mean())
    mean_mfe_high = float(y_cont[is_high.to_numpy()].mean())
    mean_mfe_low = float(y_cont[~is_high.to_numpy()].mean())

    try:
        if y_bin.sum() < 10 or (n - y_bin.sum()) < 10:
            coef_bin, p_bin = np.nan, np.nan
        else:
            logit = sm.Logit(y_bin, x).fit(disp=0, cov_type="HAC", cov_kwds={"maxlags": block_length})
            coef_bin, p_bin = float(logit.params[1]), float(logit.pvalues[1])
        ols = sm.OLS(y_cont, x).fit(cov_type="HAC", cov_kwds={"maxlags": block_length})
        coef_cont, p_cont = float(ols.params[1]), float(ols.pvalues[1])
    except (PerfectSeparationError, np.linalg.LinAlgError, ValueError) as exc:
        return ContinuousResult(
            direction, phase, window, n, max_score, float(score.mean()), np.nan, np.nan, np.nan, np.nan,
            high_threshold, n_high, n_low, rate_high, rate_low, mean_mfe_high, mean_mfe_low, "FIT_ERROR", str(exc),
        )

    return ContinuousResult(
        direction, phase, window, n, max_score, float(score.mean()), coef_bin, p_bin, coef_cont, p_cont,
        high_threshold, n_high, n_low, rate_high, rate_low, mean_mfe_high, mean_mfe_low, "OK",
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
