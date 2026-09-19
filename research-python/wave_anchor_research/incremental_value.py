"""Incremental-Value-Test (Aufgabenstellung v3, Abschnitt 18): "Liefert Wave
Anchor Informationen, die einfache Baseline-Variablen nicht bereits
enthalten?" -- getestet mit einem einzigen, interpretierbaren Modell je
(Studien-Setup, Horizont, Ziel-Typ), NICHT mit ML-Optimierung (v3 Abschnitt
18 explizit: "Keine komplexe ML-Optimierung. Ziel ist Interpretierbarkeit.").

Modell-Wahl:
- Ziel "direction" (Vorzeichen des Forward-Returns): logistische Regression
  (`statsmodels.Logit`), Pseudo-R2 = McFadden.
- Ziel "forward_return" (stetig): OLS, R2.

Fuer beide: Modell A ("Baseline") nur mit den vier Baseline-Kontrollgroessen,
Modell B ("Baseline+WaveAnchor") zusaetzlich mit dem Wave-Anchor-Block.
Delta-R2 (bzw. Delta-Pseudo-R2) = Modell B - Modell A. Gemeinsame
Signifikanz des Wave-Anchor-Blocks: Wald-Test (funktioniert korrekt mit
HAC-robusten Kovarianzen, im Unterschied zum Likelihood-Ratio-Test, der
unter robusten/HAC-Kovarianzen nicht ohne Weiteres gueltig ist).

Ueberlappende Targets (v3 Abschnitt 21): HAC/Newey-West-robuste
Standardfehler (`cov_type="HAC"`, `cov_kwds={"maxlags": block_length}`) --
`block_length` identisch zur in `stats_battery.py` etablierten
Herleitungsregel (`max(MIN_BLOCK_LENGTH, 2*horizon_bars)`), damit dieselbe
dokumentierte Abhaengigkeitslaenge ueberall im Projekt verwendet wird.

Wave-Anchor-Block bewusst klein gehalten (Interpretierbarkeit):
{htfA_wt2, htfB_wt2} -- die rohen Slow-Wave-Werte (siehe
WAVE-ANCHOR-ORIGINAL-SOURCE.md: `wt2` = "Slow Wave" im Original) beider vom
Setup ueberwachten HTFs, die woertliche Umsetzung von "dem Wave-Anchor-Wert"
laut Original-Beschreibung. State/Cross/Distance/Fast-Wave(WT1) sind
nichtlineare Ableitungen bzw. Alternativen derselben zugrunde liegenden
Groesse und werden bereits separat in TEST1-11 (`stats_battery.py`)
getestet -- hier nicht dupliziert, um das Modell klein und interpretierbar
zu halten (dokumentierte Scope-Entscheidung, nicht Ergebnis-getrieben).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tools.sm_exceptions import PerfectSeparationError

BASELINE_COLS = ["baseline_momentum", "baseline_ema_trend", "baseline_rsi", "baseline_macd_hist"]
WAVE_ANCHOR_COLS = ["htfA_wt2", "htfB_wt2"]
MIN_N = 100  # hoeher als stats_battery.MIN_N=30 -- Mehrfachregression braucht mehr Beobachtungen je Prädiktor


@dataclass
class IncrementalValueResult:
    study_setup: str
    horizon: str
    target_type: str  # "direction" | "forward_return"
    n: int
    block_length: int
    r2_baseline: float
    r2_baseline_plus_wave_anchor: float
    delta_r2: float
    wave_anchor_wald_p_value: float
    status: str  # "OK" | "INSUFFICIENT_DATA" | "FIT_ERROR"
    error_message: str = ""


def _design(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    return sm.add_constant(df[cols], has_constant="add")


def evaluate_incremental_value(
    df: pd.DataFrame,
    target_col: str,
    target_type: str,
    horizon: str,
    block_length: int,
    study_setup: str,
) -> IncrementalValueResult:
    cols_needed = BASELINE_COLS + WAVE_ANCHOR_COLS + [target_col]
    valid = df[cols_needed].notna().all(axis=1)
    sub = df.loc[valid]
    n = len(sub)

    if n < MIN_N:
        return IncrementalValueResult(
            study_setup, horizon, target_type, n, block_length,
            np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA",
        )

    y = sub[target_col].to_numpy(dtype=float)
    x_base = _design(sub, BASELINE_COLS)
    x_full = _design(sub, BASELINE_COLS + WAVE_ANCHOR_COLS)
    wald_restriction = " = 0, ".join(WAVE_ANCHOR_COLS) + " = 0"

    try:
        if target_type == "direction":
            y_bin = (y > 0).astype(int)
            if y_bin.sum() < 10 or (n - y_bin.sum()) < 10:
                return IncrementalValueResult(
                    study_setup, horizon, target_type, n, block_length,
                    np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA",
                )
            model_base = sm.Logit(y_bin, x_base).fit(
                disp=0, cov_type="HAC", cov_kwds={"maxlags": block_length},
            )
            model_full = sm.Logit(y_bin, x_full).fit(
                disp=0, cov_type="HAC", cov_kwds={"maxlags": block_length},
            )
            r2_base = float(model_base.prsquared)
            r2_full = float(model_full.prsquared)
            wald = model_full.wald_test(wald_restriction, use_f=False, scalar=True)
        elif target_type == "forward_return":
            model_base = sm.OLS(y, x_base).fit(cov_type="HAC", cov_kwds={"maxlags": block_length})
            model_full = sm.OLS(y, x_full).fit(cov_type="HAC", cov_kwds={"maxlags": block_length})
            r2_base = float(model_base.rsquared)
            r2_full = float(model_full.rsquared)
            wald = model_full.wald_test(wald_restriction, use_f=True, scalar=True)
        else:
            raise ValueError(f"Unbekannter target_type '{target_type}'")
    except (PerfectSeparationError, np.linalg.LinAlgError, ValueError) as exc:
        return IncrementalValueResult(
            study_setup, horizon, target_type, n, block_length,
            np.nan, np.nan, np.nan, np.nan, "FIT_ERROR", str(exc),
        )

    return IncrementalValueResult(
        study_setup, horizon, target_type, n, block_length,
        r2_base, r2_full, r2_full - r2_base, float(wald.pvalue), "OK",
    )


def results_to_dataframe(results: list[IncrementalValueResult]) -> pd.DataFrame:
    return pd.DataFrame([r.__dict__ for r in results])
