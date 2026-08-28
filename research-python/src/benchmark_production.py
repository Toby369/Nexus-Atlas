"""End-to-end production-factor benchmark: legacy (production-mirroring)
factors vs. new orthogonal candidate factors, both run through the same
PurgedWalkForwardCV + evaluate_features pipeline on the real TRAIN+
VALIDATION snapshot (data/btc_1d_trainval_snapshot.csv).

STATUS -- READ BEFORE INTERPRETING ANY OUTPUT:
This is a pipeline/mechanics benchmark, NOT a statistically valid migration
decision. n=201 (TRAIN+VALIDATION only) does not meet the power
requirements established in docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md
-- that analysis found adequate power for the effect sizes this project has
observed requires several *years* of further data accumulation, not 201
daily bars. See the disclaimer at the top of BENCHMARK_RESULTS.md, which
this script generates verbatim on every run.

Honesty about what "new orthogonal factors" means here: the raw snapshot
only contains close_price and CVD (delta/cumulative/trend) as inputs that
weren't already used by the 6 available legacy factors -- there is no
OHLC (high/low), no volume, and no funding/OI/positioning/orderbook/
options/macro/sentiment data in this window (0% coverage, matching the
Phase 6 audit). So the "new" candidate set is deliberately limited to what
is honestly computable from those inputs: multi-horizon log-return
momentum and Bollinger-Band statistics on close_price, and a rolling
Z-score of CVD delta. No synthetic/fabricated OHLC or volume was
constructed to make a larger "new" set possible -- that would violate this
project's core "no fabricated data" rule.

No Supabase/production imports. Self-contained within research-python/.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from src.features.legacy_factors import compute_all_legacy_factors, compute_model_a
from src.features.momentum import return_momentum
from src.features.volatility import bollinger_bands
from src.selection.evaluate import EvaluationReport, evaluate_features
from src.validation.walk_forward import PurgedWalkForwardCV

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "btc_1d_trainval_snapshot.csv"
REPORT_PATH = Path(__file__).resolve().parent.parent / "BENCHMARK_RESULTS.md"

# Legacy factors with genuine (non-zero) coverage in this snapshot -- the
# other 8 are entirely NaN (see legacy_factors.py docstring / Phase 6
# audit) and are structurally impossible to feed into evaluate_features
# (a RandomForest / correlation matrix cannot be fit on all-NaN columns --
# every row would be dropped). They are reported separately as
# NOT EVALUABLE, never silently excluded without comment.
LEGACY_EVALUABLE = ["structure", "momentum", "cvd", "trend_strength", "trend_regime", "vwap_position"]
LEGACY_NOT_EVALUABLE = ["oi_price", "positioning", "orderbook", "options", "macro", "funding", "sentiment", "basis"]

CVD_ZSCORE_WINDOW = 20
BOLLINGER_WINDOW = 20
MOMENTUM_HORIZONS_HOURS = (24.0, 168.0, 336.0)  # 1d / 7d / 14d, bar_interval_hours=24

# Purged walk-forward parameters. purge_window/embargo_window in bars (1D
# bars here), matching the primary 7d forward-return horizon used
# throughout this project's SQL-side research track (Phase 0-3.2) for
# comparability -- not re-derived or picked to flatter either factor set.
CV_N_SPLITS = 4
CV_TRAIN_SIZE = 60
CV_TEST_SIZE = 25
CV_PURGE_WINDOW = 7
CV_EMBARGO_WINDOW = 1

FORWARD_RETURN_HORIZONS_DAYS = {"7d": 7, "1d": 1, "30d": 30}  # 7d first -> primary horizon


def _rolling_zscore(series: pd.Series, window: int, ddof: int = 1) -> pd.Series:
    """Generic causal rolling Z-score (mean/std over the trailing `window`
    bars, min_periods=window). Same construction as derivatives.funding_zscore,
    written standalone here rather than reusing that funding-specific
    function under a misleading name for a different underlying series (CVD)."""
    rolling = series.rolling(window=window, min_periods=window, center=False)
    mean = rolling.mean()
    std = rolling.std(ddof=ddof)
    z = (series - mean) / std
    return z.replace([np.inf, -np.inf], np.nan)


def load_snapshot() -> pd.DataFrame:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"{DATA_PATH} not found -- run data/export_snapshot.sql (see its header "
            "comment) and save the result there before running this benchmark."
        )
    df = pd.read_csv(DATA_PATH, parse_dates=["candle_open_time"])
    df = df.sort_values("candle_open_time").reset_index(drop=True)
    return df


def build_legacy_factor_set(df: pd.DataFrame) -> pd.DataFrame:
    """All 14 legacy factors, computed from the snapshot's raw columns.
    Columns not present in the snapshot (positioning/orderbook/options/
    macro/funding/sentiment raw inputs) are passed as explicit all-NaN
    series -- their factor functions then correctly return all-NaN too."""
    n = len(df)
    nan_series = pd.Series(np.nan, index=df.index)
    raw = pd.DataFrame(
        {
            "structure_trend": df["structure_trend"],
            "rsi_14": df["rsi_14"],
            "macd_histogram": df["macd_histogram"],
            "cvd_trend": df["cvd_trend"],
            "oi_delta_pct": df["oi_delta_pct"],
            "close_price": df["close_price"],
            "ema_20": df["ema_20"],
            "ema_50": df["ema_50"],
            "ema_200": df["ema_200"],
            "positioning_score": nan_series,
            "avg_depth_imbalance": nan_series,
            "put_call_oi_ratio": nan_series,
            "macro_regime": nan_series,
            "avg_funding_rate_pct": nan_series,
            "sentiment_classification": nan_series,
            "adx_14": df["adx_14"],
            "plus_di": df["plus_di"],
            "minus_di": df["minus_di"],
            "vwap": df["vwap"],
            "basis_pct": df["basis_pct"],
        }
    )
    assert len(raw) == n
    return compute_all_legacy_factors(raw)


def build_new_candidate_factor_set(df: pd.DataFrame) -> pd.DataFrame:
    """The honestly-computable "new" candidate set: multi-horizon log-return
    momentum and Bollinger-Band statistics on close_price, plus a rolling
    Z-score of CVD delta. See module docstring for why this is limited to
    6 factors rather than the hoped-for larger set."""
    close = df["close_price"]
    momentum_df = return_momentum(close, bar_interval_hours=24.0, horizons_hours=MOMENTUM_HORIZONS_HOURS)
    momentum_df.columns = ["mom_1d", "mom_7d", "mom_14d"]

    bb = bollinger_bands(close, window=BOLLINGER_WINDOW, num_std=2.0)

    cvd_z = _rolling_zscore(df["cvd_delta"], window=CVD_ZSCORE_WINDOW)

    return pd.DataFrame(
        {
            "mom_1d": momentum_df["mom_1d"],
            "mom_7d": momentum_df["mom_7d"],
            "mom_14d": momentum_df["mom_14d"],
            "percent_b": bb["percent_b"],
            "bandwidth": bb["bandwidth"],
            "cvd_zscore": cvd_z,
        },
        index=df.index,
    )


def build_forward_returns(df: pd.DataFrame) -> dict[str, pd.Series]:
    """LABEL construction -- intentionally forward-looking (`.shift(-n)`).
    This is never used as a feature input; PurgedWalkForwardCV's
    purge_window/embargo_window exist specifically to stop these labels'
    forward window from leaking across a fold's train/test boundary."""
    close = df["close_price"]
    return {
        label: np.log(close.shift(-n) / close).rename(f"fwd_return_{label}")
        for label, n in FORWARD_RETURN_HORIZONS_DAYS.items()
    }


def _mean_abs_pairwise_correlation(features: pd.DataFrame) -> float:
    """Descriptive multicollinearity index: mean |pairwise Pearson r| across
    all feature pairs, computed on the full available (non-purged,
    non-fold-wise) overlap sample -- a single summary number for the
    report, not a substitute for evaluate_features' fold-wise diagnostics."""
    corr = features.corr().to_numpy()
    n = corr.shape[0]
    if n < 2:
        return float("nan")
    off_diagonal = corr[~np.eye(n, dtype=bool)]
    return float(np.nanmean(np.abs(off_diagonal)))


def _effective_dimensionality(features: pd.DataFrame) -> tuple[float, float]:
    """Participation-ratio effective dimensionality (same methodology as
    Phase 2's H1 factor-redundancy analysis, reused here for consistency,
    not re-derived). Returns (effective_dim, nominal_dim). NaN rows are
    dropped listwise first; returns (nan, nominal_dim) if fewer than
    nominal_dim+1 complete rows remain."""
    complete = features.dropna()
    nominal_dim = float(features.shape[1])
    if len(complete) < features.shape[1] + 1:
        return float("nan"), nominal_dim
    corr = complete.corr().to_numpy()
    eigvals = np.linalg.eigvalsh(corr)
    eigvals = np.clip(eigvals, 0, None)  # guard tiny negative numerical noise
    participation_ratio = (eigvals.sum() ** 2) / (eigvals**2).sum()
    return float(participation_ratio), nominal_dim


def run_benchmark_side(
    features: pd.DataFrame, forward_returns: dict[str, pd.Series], label: str
) -> EvaluationReport:
    cv = PurgedWalkForwardCV(
        n_splits=CV_N_SPLITS,
        train_size=CV_TRAIN_SIZE,
        test_size=CV_TEST_SIZE,
        purge_window=CV_PURGE_WINDOW,
        embargo_window=CV_EMBARGO_WINDOW,
        expanding=True,
    )
    print(f"\n=== Running walk-forward evaluation: {label} ({features.shape[1]} factors) ===")
    report = evaluate_features(features, forward_returns, cv, corr_threshold=0.65, n_estimators=200)
    return report


@dataclass
class BenchmarkSideResult:
    label: str
    report: EvaluationReport
    multicollinearity_index: float
    effective_dim: float
    nominal_dim: float


def summarize_side(features: pd.DataFrame, forward_returns: dict[str, pd.Series], label: str) -> BenchmarkSideResult:
    report = run_benchmark_side(features, forward_returns, label)
    mc_index = _mean_abs_pairwise_correlation(features)
    eff_dim, nominal_dim = _effective_dimensionality(features)
    return BenchmarkSideResult(
        label=label, report=report, multicollinearity_index=mc_index, effective_dim=eff_dim, nominal_dim=nominal_dim
    )


def print_console_report(legacy: BenchmarkSideResult, new: BenchmarkSideResult) -> None:
    print("\n" + "=" * 78)
    print("PRODUCTION FACTOR BENCHMARK -- CONSOLE SUMMARY")
    print("=" * 78)
    print(
        "\nDISCLAIMER: n=201 (TRAIN+VALIDATION), does not meet Phase 3.2 power "
        "requirements. Pipeline/mechanics validation only -- NOT a statistically "
        "valid migration decision. See BENCHMARK_RESULTS.md."
    )

    for side in (legacy, new):
        print(f"\n--- {side.label} ---")
        print(side.report.summary.round(4).to_string())
        print(f"Multicollinearity index (mean |pairwise r|): {side.multicollinearity_index:.3f}")
        print(f"Effective dimensionality: {side.effective_dim:.2f} / {side.nominal_dim:.0f} nominal factors")
        print(f"Selected (orthogonalized) features: {side.report.selected_features}")


def write_markdown_report(legacy: BenchmarkSideResult, new: BenchmarkSideResult, out_path: Path | None = None) -> None:
    if out_path is None:
        out_path = REPORT_PATH  # resolved at call time, not import time -- monkeypatch-friendly

    def fmt(x: float, digits: int = 3) -> str:
        return "n/a" if (x is None or (isinstance(x, float) and np.isnan(x))) else f"{x:.{digits}f}"

    lines: list[str] = []
    lines.append("# Production Factor Benchmark Results\n")
    lines.append(
        "> **DISCLAIMER (read first):** This report is a **pipeline / code-correctness "
        "verification exercise**, run on the TRAIN+VALIDATION snapshot "
        "(`data/btc_1d_trainval_snapshot.csv`, n=201 daily bars, 19.12.2025-07.07.2026). "
        "It validates that `legacy_factors.py` correctly reproduces the production "
        "engine's formulas (verified row-by-row against the engine's own reference "
        "values -- see `tests/test_legacy_factors.py`) and that the "
        "`PurgedWalkForwardCV` + `evaluate_features` pipeline runs correctly end to end "
        "on both factor sets. **It CANNOT be used as a statistically valid migration "
        "decision.** `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` established that "
        "adequate statistical power for the effect sizes this project has observed "
        "requires several *years* of further data accumulation -- n=201 falls far short "
        "of that, by design and by necessity (it is simply all the TRAIN+VALIDATION data "
        "that exists). Any IC, stability, or selection numbers below describe this "
        "specific 201-row sample only.\n"
    )

    lines.append("## 1. Data & Scope\n")
    lines.append(f"- Source: `{DATA_PATH.relative_to(DATA_PATH.parents[2])}`, n=201, TEST split hard-excluded.")
    lines.append(
        f"- Walk-forward: {CV_N_SPLITS} expanding folds, train_size>={CV_TRAIN_SIZE}, "
        f"test_size={CV_TEST_SIZE}, purge_window={CV_PURGE_WINDOW}, embargo_window={CV_EMBARGO_WINDOW}."
    )
    lines.append(f"- Primary evaluation horizon: 7d forward log-return (also reports 1d, 30d).\n")

    lines.append("## 2. Legacy Factors -- Evaluability\n")
    lines.append(
        f"Of the 14 production factors, **{len(LEGACY_EVALUABLE)} have real coverage** in this "
        f"window and could be evaluated: {', '.join(LEGACY_EVALUABLE)}.\n"
    )
    lines.append(
        f"**{len(LEGACY_NOT_EVALUABLE)} are NOT EVALUABLE** (0% coverage -- their raw data sources "
        f"were not collecting yet in this period, per the Phase 6 audit): {', '.join(LEGACY_NOT_EVALUABLE)}. "
        "This is a *data availability* finding, not a *redundancy* finding -- these factors were never "
        "run through the evaluation, so nothing can be said about whether they would be redundant or "
        "informative once real data exists for them.\n"
    )

    lines.append("## 3. New Candidate Factors -- Honesty Note\n")
    lines.append(
        "The snapshot contains no OHLC (high/low), no volume, and no funding/OI/positioning/"
        "orderbook/options/macro/sentiment data (0% coverage, matching Phase 6). The only raw "
        "inputs available beyond what the 6 evaluable legacy factors already use are `close_price` "
        "and CVD (delta/cumulative/trend). The new candidate set is therefore honestly limited to "
        "6 factors derived from those two inputs -- **no synthetic OHLC or volume was fabricated** "
        "to reach a larger set:\n"
    )
    lines.append(
        "- `mom_1d`, `mom_7d`, `mom_14d`: log-return momentum at 1/7/14-day horizons (close_price)\n"
        "- `percent_b`, `bandwidth`: Bollinger Bands, 20-period, 2 stddev (close_price)\n"
        "- `cvd_zscore`: rolling 20-period Z-score of CVD delta\n"
    )

    for side, heading in ((legacy, "## 4. Legacy Factor Set Results"), (new, "## 5. New Candidate Factor Set Results")):
        lines.append(f"\n{heading}\n")
        lines.append(f"Multicollinearity index (mean |pairwise Pearson r|, full-sample, descriptive): "
                      f"**{fmt(side.multicollinearity_index)}**\n")
        lines.append(
            f"Effective dimensionality (participation ratio): **{fmt(side.effective_dim, 2)}** of "
            f"{side.nominal_dim:.0f} nominal factors "
            f"(dimension-reduction ratio: {fmt(side.effective_dim/side.nominal_dim if not np.isnan(side.effective_dim) else float('nan'), 2)})\n"
        )
        lines.append(f"Selected (orthogonalized) representatives: `{side.report.selected_features}`\n")
        summary_md = side.report.summary.round(4).reset_index()
        lines.append(summary_md.to_markdown(index=False))
        lines.append("")

    lines.append("## 6. Cross-Set Comparison\n")
    lines.append("| Metric | Legacy (evaluable, n=6) | New candidates (n=6) |")
    lines.append("|---|---|---|")
    lines.append(f"| Multicollinearity index | {fmt(legacy.multicollinearity_index)} | {fmt(new.multicollinearity_index)} |")
    lines.append(
        f"| Effective dimensionality | {fmt(legacy.effective_dim,2)}/{legacy.nominal_dim:.0f} "
        f"| {fmt(new.effective_dim,2)}/{new.nominal_dim:.0f} |"
    )
    legacy_ic = legacy.report.summary["ic_mean_7d"].abs().mean()
    new_ic = new.report.summary["ic_mean_7d"].abs().mean()
    lines.append(f"| Mean \\|IC\\| (7d, across factors) | {fmt(legacy_ic)} | {fmt(new_ic)} |")
    lines.append("")
    lines.append(
        "**No claim of superiority is made from this table.** With n=201 and the fold sizes above, "
        "the Minimum Detectable Effect for these IC comparisons is large relative to the differences "
        "shown (consistent with Phase 3.2's power analysis) -- these numbers describe this sample, "
        "not a validated difference in true predictive value.\n"
    )

    lines.append("## 7. Redundancy / Coverage Classification (as requested)\n")
    lines.append("| Category | Factors |")
    lines.append("|---|---|")
    legacy_selected = set(legacy.report.selected_features)
    legacy_deselected = [f for f in LEGACY_EVALUABLE if f not in legacy_selected]
    lines.append(f"| Legacy: NOT EVALUABLE (no data, not a redundancy finding) | {', '.join(LEGACY_NOT_EVALUABLE)} |")
    lines.append(f"| Legacy: evaluable, clustered as redundant with another factor | {', '.join(legacy_deselected) or '(none)'} |")
    lines.append(f"| Legacy: evaluable, selected as cluster representative | {', '.join(sorted(legacy_selected))} |")
    new_selected = set(new.report.selected_features)
    new_deselected = [f for f in new.report.summary.index if f not in new_selected]
    lines.append(f"| New candidates: clustered as redundant with another factor | {', '.join(new_deselected) or '(none)'} |")
    lines.append(f"| New candidates: selected as cluster representative | {', '.join(sorted(new_selected))} |")
    lines.append("")

    lines.append("## 8. Step-by-Step Path Toward an Eventual Migration Decision\n")
    lines.append(
        "This is a **roadmap for how to reach a decision**, not a migration recommendation itself "
        "-- consistent with this project's explicit rule that no premature architecture/feature "
        "change may be derived from a power-deficient analysis (Phase 3, Section 11):\n"
    )
    lines.append(
        "1. Continue passive data accumulation (already running, unaffected by this benchmark) "
        "until the 8 currently NOT EVALUABLE legacy factors have real coverage, and until the "
        "Phase-3.2 power targets for the primary 168h/7d horizon are met.\n"
        "2. Re-run this exact benchmark (same code, same methodology) on that larger, real dataset "
        "-- not on a larger synthetic one.\n"
        "3. Only then evaluate whether the new candidate set's cross-fold IC/stability is "
        "*statistically distinguishable* from the legacy set's (proper hypothesis test, corrected "
        "for multiple comparisons, per the Phase 3 pre-registration protocol) -- not just "
        "numerically different as in section 6 above.\n"
        "4. A migration decision, if any, follows from step 3's outcome -- never from this "
        "n=201 mechanics run.\n"
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWritten: {out_path}")


def main() -> None:
    df = load_snapshot()
    legacy_factors = build_legacy_factor_set(df)
    new_factors = build_new_candidate_factor_set(df)
    forward_returns = build_forward_returns(df)

    legacy_evaluable = legacy_factors[LEGACY_EVALUABLE]

    legacy_result = summarize_side(legacy_evaluable, forward_returns, "LEGACY (6 evaluable of 14)")
    new_result = summarize_side(new_factors, forward_returns, "NEW CANDIDATES (6)")

    print_console_report(legacy_result, new_result)
    write_markdown_report(legacy_result, new_result)


if __name__ == "__main__":
    main()
