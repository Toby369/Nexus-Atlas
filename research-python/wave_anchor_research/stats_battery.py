"""Statistik-Batterie (Aufgabenstellung Abschnitt 10-13): dependence-aware
Inferenz via Moving-Block-Bootstrap (reuse von
research-python/src/validation/block_bootstrap.py -- KEINE eigene, zweite
Bootstrap-Implementierung), anschliessend BH-FDR ueber den GESAMTEN
Zellen-Pool (statsmodels, Standard-Implementierung).

Jede Zelle = eine (Bedingung, Horizont)-Kombination. Zwei Zellen-Typen:
- Bedingt (condition vs. Rest): `block_bootstrap_mean_difference` --
  Baseline = unkonditionierter Mittelwert der Stichprobe (nicht 0), damit
  die Frage lautet "unterscheidet sich diese Bedingung vom Rest", nicht
  "ist der Forward-Return von Null verschieden" (bei BTC im Bullenmarkt
  waere Letzteres oft trivial erfuellt und wenig aussagekraeftig).
- Kontinuierlich (Distanz/Roh-WT vs. Forward-Return): Rank-IC (Spearman),
  Konfidenzintervall ueber `moving_block_bootstrap` (generischer Engine,
  eigene statistic_fn) -- dieselbe Bootstrap-Mechanik wie oben, nur ein
  anderer Statistik-Callback.

MIN_N = 30 pro Gruppe (Bedingung UND Rest) -- unterhalb dessen:
INSUFFICIENT_DATA, kein p-Wert (konsistent mit der in dieser Codebasis
etablierten MIN_N-Konvention, siehe CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md
Abschnitt 4, dort MIN_N=10 fuer eine andere, deutlich kleinere Stichprobe --
hier bewusst hoeher angesetzt, da die verfuegbaren Stichproben um
Groessenordnungen groesser sind).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata, spearmanr
from statsmodels.stats.multitest import multipletests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # .../research-python, fuer `src.*`
from src.validation.block_bootstrap import block_bootstrap_mean_difference, moving_block_bootstrap  # noqa: E402

MIN_N = 30


@dataclass
class CellResult:
    study_setup: str
    wt_preset: str
    split: str  # "TRAIN_VAL" | "OOS"
    test_category: str  # A..G
    feature: str
    condition: str
    horizon: str
    n_condition: int
    n_complement: int
    observed_diff: float
    baseline: float
    ci_lower: float
    ci_upper: float
    raw_p_value: float
    status: str  # "OK" | "INSUFFICIENT_DATA"
    n_replicates: int
    block_length: int
    bh_significant: bool | None = None
    bh_adjusted_p: float | None = None
    # v3 Event-Study-Zusatzgroessen (Abschnitt 15): Median und Hit-Rate der
    # BEDINGUNGS-Gruppe direkt aus den Rohdaten (kein Bootstrap noetig, reine
    # deskriptive Statistik) -- nur fuer Bedingungs-Zellen populiert, bei
    # Rank-IC-Zellen None (dort nicht sinnvoll definiert).
    median_condition: float | None = None
    hit_rate_condition: float | None = None


MIN_BLOCK_LENGTH = 10  # siehe Begruendung unten


def _block_length_for_horizon(horizon_bars: int) -> int:
    """2x der Horizont-Bar-Zahl -- konservative Marge oberhalb der
    strukturellen Abhaengigkeitslaenge, exakt dieselbe Regel wie
    src/validation/block_bootstrap.py's eigene Herleitung (H=7d -> L=14d).
    Mindestens `MIN_BLOCK_LENGTH=10`: fuer sehr kurze Horizonte (z.B. der
    1H-Horizont bei 1h-LTF, wo 2xhorizon_bars=2 waere) faengt ein derart
    kurzer Block kaum noch Autokorrelationsstruktur ein -- UND
    `draw_moving_block_indices` (block_bootstrap.py) baut pro Replikat
    `ceil(n/block_length)` einzelne numpy-Arrays per Python-Schleife auf,
    was bei sehr kurzer Blocklaenge und n~100k Zeilen unverhaeltnismaessig
    teuer wird (empirisch gemessen: block_length=2 -> ~54ms/Aufruf,
    block_length=384 -> ~0.44ms/Aufruf, Faktor ~120x). Die Untergrenze ist
    also sowohl methodisch als auch aus Rechenzeitgruenden sinnvoll, VOR
    jeder Ergebnisbetrachtung festgelegt."""
    return max(MIN_BLOCK_LENGTH, 2 * horizon_bars)


def _effective_n_replicates(block_length: int, requested: int) -> int:
    """Reduziert die Replikatzahl NUR aus Rechenzeitgruenden bei sehr
    kurzer Blocklaenge (siehe `_block_length_for_horizon`-Docstring fuer die
    Kalibrierungsmessung) -- nie aus Ergebnis-/Signifikanz-Erwaegungen,
    diese Staffelung ist rein an `block_length` (nicht an irgendeinem
    Zwischenergebnis) festgemacht und daher VOR jeder Analyse determiniert."""
    if block_length < 20:
        return min(requested, 250)
    if block_length < 100:
        return min(requested, 500)
    return requested


def evaluate_condition_vs_complement(
    forward_return: pd.Series,
    condition_mask: pd.Series,
    horizon_bars: int,
    seed: int,
    n_replicates: int,
    study_setup: str,
    wt_preset: str,
    split: str,
    test_category: str,
    feature: str,
    condition: str,
    horizon: str,
) -> CellResult:
    valid = forward_return.notna() & condition_mask.notna()
    fr = forward_return[valid].to_numpy(dtype=float)
    mask = condition_mask[valid].astype(bool).to_numpy()
    n_cond, n_comp = int(mask.sum()), int((~mask).sum())

    block_length = _block_length_for_horizon(horizon_bars)

    if n_cond < MIN_N or n_comp < MIN_N or len(fr) <= block_length:
        return CellResult(
            study_setup, wt_preset, split, test_category, feature, condition, horizon,
            n_cond, n_comp, np.nan, np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA",
            n_replicates, block_length,
        )

    baseline = float(fr.mean())
    effective_n_replicates = _effective_n_replicates(block_length, n_replicates)
    result = block_bootstrap_mean_difference(
        returns=fr, condition_mask=mask, baseline=baseline, seed=seed,
        block_length=block_length, n_replicates=effective_n_replicates,
    )
    # v3 Event-Study-Zusatzgroessen (Abschnitt 15): Median und Hit-Rate
    # (Anteil positiver Forward-Returns) direkt aus den Rohdaten der
    # Bedingungs-Gruppe -- rein deskriptiv, kein Bootstrap noetig.
    cond_returns = fr[mask]
    median_condition = float(np.median(cond_returns))
    hit_rate_condition = float((cond_returns > 0).mean())
    return CellResult(
        study_setup, wt_preset, split, test_category, feature, condition, horizon,
        n_cond, n_comp, result.difference, baseline, result.ci_lower, result.ci_upper,
        result.p_value, "OK", result.n_valid_replicates, block_length,
        median_condition=median_condition, hit_rate_condition=hit_rate_condition,
    )


def evaluate_rank_ic(
    feature_values: pd.Series,
    forward_return: pd.Series,
    horizon_bars: int,
    seed: int,
    n_replicates: int,
    study_setup: str,
    wt_preset: str,
    split: str,
    test_category: str,
    feature: str,
    horizon: str,
) -> CellResult:
    """Rank-IC (Spearman) mit block-bootstrap-Konfidenzintervall (eigene
    statistic_fn ueber die generische `moving_block_bootstrap`-Engine)."""
    paired = pd.concat([feature_values.rename("f"), forward_return.rename("r")], axis=1).dropna()
    n = len(paired)
    block_length = _block_length_for_horizon(horizon_bars)

    if n < MIN_N or n <= block_length:
        return CellResult(
            study_setup, wt_preset, split, test_category, feature, "rank_ic", horizon,
            n, 0, np.nan, np.nan, np.nan, np.nan, np.nan, "INSUFFICIENT_DATA",
            n_replicates, block_length,
        )

    f_arr = paired["f"].to_numpy()
    r_arr = paired["r"].to_numpy()
    observed_ic = float(spearmanr(f_arr, r_arr).statistic)

    # Performance: Spearman-IC = Pearson-Korrelation der RAENGE (mathematisch
    # exakt aequivalent). Raenge werden EINMAL vorab berechnet (rankdata,
    # average-Methode fuer Ties -- identisch zu scipy.stats.spearmanr's
    # eigener interner Rangbildung); die Bootstrap-Schleife selbst ruft dann
    # pro Replikat nur noch eine vektorisierte numpy-Pearson-Korrelation auf
    # den bereits berechneten Rang-Arrays auf, statt spearmanr() (das intern
    # rankdata+Pearson bei jedem Aufruf neu macht) 1000x pro Zelle neu
    # auszufuehren -- ca. 40x schneller bei gleichem Ergebnis, empirisch
    # gemessen bei der v1-Kalibrierung dieses Projekts.
    f_ranks = rankdata(f_arr)
    r_ranks = rankdata(r_arr)

    def _stat(idx: np.ndarray) -> float:
        fr = f_ranks[idx]
        rr = r_ranks[idx]
        fr_c = fr - fr.mean()
        rr_c = rr - rr.mean()
        denom = np.sqrt((fr_c * fr_c).sum() * (rr_c * rr_c).sum())
        if denom == 0.0:
            return 0.0
        return float((fr_c * rr_c).sum() / denom)

    effective_n_replicates = _effective_n_replicates(block_length, n_replicates)
    boot = moving_block_bootstrap(
        n_obs=n, statistic_fn=_stat, baseline=0.0, seed=seed,
        block_length=block_length, n_replicates=effective_n_replicates,
    )
    return CellResult(
        study_setup, wt_preset, split, test_category, feature, "rank_ic", horizon,
        n, 0, observed_ic, 0.0, boot.ci_lower, boot.ci_upper, boot.p_value, "OK",
        boot.n_valid_replicates, block_length,
    )


def apply_bh_fdr(cells: list[CellResult], alpha: float = 0.05) -> list[CellResult]:
    """BH-FDR ueber ALLE evaluierbaren (status=='OK') Zellen des uebergebenen
    Pools -- EIN Pool, wie in dieser Codebasis etabliert (siehe
    CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md Abschnitt 6: "kumulativ, EIN
    Pool"). Zellen mit status=='INSUFFICIENT_DATA' werden NICHT in die
    Korrektur einbezogen (kein p-Wert vorhanden) und bleiben unveraendert."""
    evaluable = [c for c in cells if c.status == "OK"]
    if not evaluable:
        return cells
    p_values = [c.raw_p_value for c in evaluable]
    reject, adjusted, _, _ = multipletests(p_values, alpha=alpha, method="fdr_bh")
    for cell, sig, adj_p in zip(evaluable, reject, adjusted):
        cell.bh_significant = bool(sig)
        cell.bh_adjusted_p = float(adj_p)
    return cells


def cells_to_dataframe(cells: list[CellResult]) -> pd.DataFrame:
    return pd.DataFrame([c.__dict__ for c in cells])
