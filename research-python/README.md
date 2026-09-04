# research-python

Standalone Python framework for computing and purged walk-forward-validating
BTC/USDT perpetual market-state factors. Deliberately separate from the main
Next.js/Supabase Nexus-Atlas application (`app/`, `lib/`, `supabase/`) — no
imports either direction, no shared runtime. This is a research/prototyping
track exploring alternative factor definitions; it does not read from or
write to the production Supabase project, and does not affect
`compute-market-state` or any live dashboard behavior.

## Status

**Step 1 (done):** the three feature modules (`derivatives.py`,
`volatility.py`, `momentum.py`) and their look-ahead-bias unit tests.

**Step 2 (done):** `src/validation/walk_forward.py` — `PurgedWalkForwardCV`
(sequential expanding/rolling purged & embargoed walk-forward splits) and
`generate_combinatorial_splits` (Combinatorial Purged Cross-Validation split
generator, the primitive a Probability-of-Backtest-Overfitting analysis is
built on — PBO statistic aggregation itself is not implemented).

**Step 3 (done):** `src/selection/orthogonal.py` (HRP-style hierarchical
clustering + Clustered Feature Importance) and `src/selection/evaluate.py`
(fold-by-fold feature evaluation: MDI importance stability, ADF
stationarity, IC/Rank IC vs. forward returns, under `PurgedWalkForwardCV`).

**Step 4 (done):** `src/features/legacy_factors.py` (independent Python
reimplementation of the 14 production factors, verified row-by-row against
the production engine's own reference values — see `data/`) and
`src/benchmark_production.py` (runs the legacy factor set and a new
candidate factor set through the same walk-forward + evaluation pipeline,
writes `BENCHMARK_RESULTS.md`). **This is a pipeline/mechanics benchmark on
n=201 (TRAIN+VALIDATION), not a statistically valid migration decision** —
see the disclaimer at the top of `BENCHMARK_RESULTS.md` and
`docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` for why.

**Step 5 (done, Path A / ROADMAP.md):** `src/validation/block_bootstrap.py`
— Moving Block Bootstrap inference (L=14 days, blocked on the full
calendar series), exactly per `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md`
Section 6a. Provides the dependence-aware confidence-interval/p-value
machinery the eventual primary confirmatory test needs; not yet wired into
`benchmark_production.py` or run against real data — see `ROADMAP.md` for
the remaining Path-A items (PBO path aggregation, migration decision
framework) and the Path-B (data-gated) timeline.

**Step 6 (done, Path A / ROADMAP.md):** `src/validation/decision_framework.py`
— formalizes the 4 Decision Gates from `BENCHMARK_RESULTS.md` Section 8
(statistical power, feature coverage, out-of-sample performance via
`block_bootstrap.py`, cross-fold stability) into an automated, three-state
(`PASS`/`FAIL`/`INSUFFICIENT_DATA`) module with a strict combination rule
(`combine_gate_results`) producing one `MigrationDecisionResult`
(`MIGRATE`/`REJECT`/`INSUFFICIENT_DATA`). Fully wired and tested, but not
yet run against real data — the actual migration decision itself is still
gated on the Phase-3.2 power requirements (see `BENCHMARK_RESULTS.md`
Section 8 and `ROADMAP.md`).

**Step 7 (done, Path A / ROADMAP.md):**
`src/validation/walk_forward.py::compute_pbo` — Combinatorially Symmetric
Cross-Validation (CSCV) aggregation of the Probability of Backtest
Overfitting (PBO), completing the CPCV validation story
`generate_combinatorial_splits` started. Wired as an optional input to
Gate 4 of `decision_framework.py` (`StabilityGateConfig.max_pbo` /
`evaluate_gate_4_stability(..., pbo=...)`), `None` by default so every
existing caller is unaffected.

**Not yet implemented / next step:** running the framework above against
real, sufficiently-powered data — not started, deliberately, until that
data exists (see `ROADMAP.md` for the specific timeline).

## Structure

```
research-python/
  src/
    features/
      derivatives.py     # funding_zscore, funding_persistence, oi_volume_ratio
      volatility.py      # garman_klass_volatility, bollinger_bands
      momentum.py        # adx (Wilder), log_return, return_momentum
      legacy_factors.py  # independent reimplementation of the 14 production factors
    validation/
      walk_forward.py       # PurgedWalkForwardCV, generate_combinatorial_splits (CPCV)
      block_bootstrap.py    # Moving Block Bootstrap inference (L=14, per Phase 3.2)
      decision_framework.py # Migration Decision Framework: 4 Decision Gates + combiner
    selection/
      orthogonal.py    # HRP-style clustering, Clustered Feature Importance
      evaluate.py       # fold-by-fold importance/ADF/IC evaluation engine
    benchmark_production.py  # legacy vs. new candidate factors, end to end
  data/
    export_snapshot.sql             # documented, one-time, read-only export query
    btc_1d_trainval_snapshot.csv    # its output (n=201, TRAIN+VALIDATION only)
  tests/
    lookahead_utils.py     # shared no-look-ahead test helpers
    test_derivatives.py
    test_volatility.py
    test_momentum.py
    test_walk_forward.py   # no-overlap / purge / embargo / monotonicity leak tests + compute_pbo (PBO) tests
    test_block_bootstrap.py # determinism, NaN handling, "corrects inference not information" proof
    test_decision_framework.py # golden-value power table, all gate PASS/FAIL/INSUFFICIENT_DATA paths, combiner rules
    test_selection.py      # fold-discipline tests + synthetic noise/regime/collinearity benchmark
    test_legacy_factors.py # formula unit tests + golden-value check against the real snapshot
    test_benchmark.py      # benchmark pipeline tests (synthetic + real-snapshot smoke test)
  BENCHMARK_RESULTS.md  # generated by `python -m src.benchmark_production` -- read its disclaimer first
  ROADMAP.md  # status & architecture record: near-term (Path A) vs. data-gated (Path B) work
  requirements.txt
  pyproject.toml
```

## Design principles (carried over from the SQL/Supabase research track)

- **No silent parameter choices.** Every non-obvious choice (ddof, sum vs.
  mean aggregation, sign(0) handling, min_periods) is picked explicitly and
  documented in the function's docstring, not left as an implicit default.
- **No look-ahead, verified, not just claimed.** Every rolling/smoothing
  feature has two independent tests: (1) truncating the input at time T does
  not change any value at t <= T, and (2) mutating the input strictly after T
  does not change any value at t <= T. Both must pass.
- **Fail loudly on ambiguous input.** An unsorted index, mismatched series,
  or missing OHLC column raises `ValueError` immediately rather than
  producing a silently wrong rolling window.

## Running the tests

```bash
cd research-python
pip install -r requirements.txt
pytest -v                                  # 269 tests
pytest --cov=src --cov-report=term-missing # with coverage (98% overall)
python -m src.benchmark_production         # runs the production-factor benchmark, writes BENCHMARK_RESULTS.md
```

## Factor definitions implemented

| Module | Factor | Notes |
|---|---|---|
| `derivatives.py` | `funding_zscore` | Rolling Z-score, w=90 (8h funding), sample stddev (ddof=1), min_periods=window |
| `derivatives.py` | `funding_persistence` | Consecutive same-sign count; sign(0) explicitly resets the streak to 0 |
| `derivatives.py` | `oi_volume_ratio` | OI(USD) / rolling mean(volume); window in **bars**, caller must match their bar frequency |
| `volatility.py` | `garman_klass_volatility` | Rolling **sum** of per-bar Garman-Klass variance, sqrt'd; negative-sum edge case clipped at 0, documented |
| `volatility.py` | `bollinger_bands` | 20-period, 2 stddev, population stddev (ddof=0); returns middle/upper/lower/%B/bandwidth |
| `momentum.py` | `adx` | Welles Wilder (1978) smoothing, implemented as an explicit causal loop (not `pandas.ewm`, which seeds differently) |
| `momentum.py` | `return_momentum` | Log-returns at configurable horizons (default 1h/4h/24h), bar-interval-aware |

See each module's docstrings for the exact formulas and the rationale
behind every non-obvious parameter choice.

## Validation framework (`src/validation/walk_forward.py`)

| Component | Notes |
|---|---|
| `PurgedWalkForwardCV` | Sequential expanding or rolling walk-forward. `purge_window` bars removed from a fold's own train immediately before its test block; `embargo_window` bars removed specifically from the *next* fold's train immediately after a test block (matches the task spec's literal "blocked for the next train set" wording — documented as a deliberately conservative design choice, see module docstring for the reasoning). `test_size` has no implicit default (must be given explicitly); insufficient data raises a clear `ValueError` rather than silently producing fewer/degenerate folds. `train_size` is optional in expanding mode too (backward-compatible addition made while building `src/selection/`): if given, it sets a minimum floor for the *first* fold's train window so it's large enough to fit a model on, rather than always starting at just `purge_window + 1` rows. |
| `generate_combinatorial_splits` | Combinatorial Purged Cross-Validation (CPCV) split generator (Lopez de Prado, ch. 12) — the data-splitting primitive a Probability-of-Backtest-Overfitting (PBO) analysis needs. Purge/embargo applied symmetrically at *every* train/test group boundary in both time directions, since combinatorial test-group selection means a train group can sit chronologically before **or** after a given test group. Produces correctly purged/embargoed bar-index splits only — aggregating a performance statistic across them into PBO is `compute_pbo`, below. |
| `compute_pbo` | Probability of Backtest Overfitting via Combinatorially Symmetric Cross-Validation (CSCV; Bailey, Borwein, Lopez de Prado & Zhu 2014; AFML ch. 11) — the aggregation step. Takes a pre-computed `(n_groups, n_trials)` performance matrix (one statistic, e.g. Sharpe ratio, per CPCV group per candidate trial — computed by the caller, this function is statistic-agnostic) and, for every one of `C(n_groups, n_groups//2)` symmetric train/test group combinations: picks the in-sample-best trial, ranks its out-of-sample performance among all trials' (`scipy.stats.rankdata`, ties averaged), and converts that rank to a logit. `PBO = mean(logit <= 0)` — the fraction of combinations where the in-sample winner performed at or below the OOS median, i.e. looked good only on the data used to pick it. Fully deterministic (exhaustive enumeration, no randomness, no seed needed). |

`tests/test_walk_forward.py` verifies, for both split generators: (a) train and
test indices never overlap, (b) no index from a purge or embargo zone ever
appears in a train set, and (c) for `PurgedWalkForwardCV` specifically,
train is always strictly chronologically before its own test block (no
future-data training) — while a dedicated CPCV test asserts the opposite is
true there by design (train legitimately appears after a test group in some
combinations), so the two behaviors are shown to actually differ, not just
asserted to.

**`compute_pbo` golden values** (`tests/test_walk_forward.py::TestComputePBOGoldenValues`): with 4 groups and 2 trials, every one of the `C(4,2)=6` combinations' logit is hand-derivable, so these are exact checks, not tolerance-based sanity bounds — a trial that strictly dominates another in every group yields `PBO == 0.0` exactly (every combination's logit is positive: the selection is genuinely, consistently good, not an in-sample fluke); two trials with identical performance everywhere tie in-sample and out-of-sample in every combination (`omega=0.5`, `logit=0` exactly, and the boundary rule `logit <= 0` counts a tie as a vote for overfitting), yielding `PBO == 1.0` exactly. A separate empirical test (`TestComputePBOLargerCombinatorics::test_pure_noise_trials_yield_non_extreme_pbo`) shows pure iid-noise trials (no real skill difference) produce a `PBO` strictly inside `(0, 1)` — a collapse to either extreme there would indicate a bug in the rank/logit aggregation, not a real finding, the same empirical-proof discipline used for `block_bootstrap.py`'s "corrects inference, does not create information" claim.

## Feature selection & benchmark (`src/selection/`)

| Component | Notes |
|---|---|
| `orthogonal.py` — `correlation_distance` | HRP-style distance `d = sqrt(0.5*(1-rho))` (Lopez de Prado, 2016) — a true metric, unlike `1 - abs(rho)`. NaN correlations (from a zero-variance column within a fold) are treated as uncorrelated, not dropped or left broken. |
| `orthogonal.py` — `cluster_features` | Hierarchical (single-linkage) clustering, cut at the distance equivalent to a given `corr_threshold` (default 0.65, matching the task spec's example) — groups of features correlated above that threshold end up in the same cluster. |
| `orthogonal.py` — `select_cluster_representatives` | Picks the single most "stable" feature per cluster from an externally-supplied stability score (see below) — deterministic alphabetical tie-break, raises on a feature/score mismatch rather than silently defaulting. |
| `orthogonal.py` — `clustered_feature_importance` | Clustered Feature Importance (CFI): sums a cluster's members' individual importances, recovering the cluster's total contribution rather than letting collinear features silently "split the credit". |
| `evaluate.py` — `evaluate_features` | The fold-by-fold engine. Per fold: correlation + clustering + ADF stationarity + RandomForest MDI importance computed on **train only**; IC and Rank IC against every forward-return horizon computed on **test only**. After all folds: aggregates mean importance, a coefficient-of-variation-based importance-stability score, mean ADF p-value / stationarity rate, per-horizon IC/Rank-IC mean+std, and how often each feature "won" its own cluster across folds (`selection_frequency`). Final feature selection clusters on the *last* (largest) fold's train-only correlation matrix and picks one representative per cluster using the cross-fold stability score — never a single fold's snapshot. |

**Fold discipline**, verified directly in `tests/test_selection.py::TestFoldDiscipline` (not just asserted): the exact correlation matrix passed to clustering, and the exact row count passed to the RandomForest fit, are independently recomputed by the test itself from `cv.split(X)` and compared byte-for-byte / count-for-count against what `evaluate_features` actually used — proving clustering and importance fitting only ever see that fold's train rows, and IC only the test rows.

**Synthetic benchmark** (`TestSyntheticBenchmark`, noise + regime change + multicollinearity, deterministic fixed seeds): `feature_A` (clean signal proxy), `feature_B` (a collinear but strictly noisier duplicate of A, corr ≈ 0.75), `feature_C` (engineered to align tightly with the forward return only in bars 0–149, pure noise everywhere else — and that window is placed entirely before every walk-forward test block by construction, so it can never leak into an out-of-sample IC calculation), and `feature_D` (a second, independent informative feature). A volatility regime shift at the series midpoint affects later folds differently from earlier ones. Demonstrated, not just asserted: `feature_A` is selected over `feature_B` and has a higher cross-fold selection frequency and importance stability; `feature_D` survives as its own cluster; and — the core "more reliable than naive selection" result — a naive correlation check restricted to `feature_C`'s engineered window rates it very favorably (|IC| > 0.5), while the genuine walk-forward, all-out-of-sample-folds IC average is more than 2x smaller in magnitude, correctly showing it is not a reliable predictor.

## Production factor benchmark (`src/features/legacy_factors.py` + `src/benchmark_production.py`)

**Read `BENCHMARK_RESULTS.md`'s disclaimer before interpreting anything below it.** n=201 (the entire available TRAIN+VALIDATION window) does not meet the statistical power requirements `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` established — this is a pipeline/mechanics benchmark, not a migration decision.

| Component | Notes |
|---|---|
| `legacy_factors.py` | Independent Python reimplementation of all 14 production factors, exact formulas from `docs/research/phase6-ist-zustand-audit.md` (Wilder-style thresholds, MACD-histogram/RSI momentum, EMA-ratio trend regime, contrarian funding/basis, etc.) — not simplified stand-ins. Pure row-wise transforms (no rolling window inside this module at all, since the underlying indicators are already point-in-time-safe upstream), so there is structurally no way for it to look ahead. Also implements `compute_model_a`, the production coverage-gate/scoring/state-classification logic. |
| Golden-value validation | `tests/test_legacy_factors.py::TestGoldenValuesAgainstProductionSnapshot` compares every one of the 14 factors' computed value against the production engine's own already-computed reference value (`reference_factors_jsonb` in the data snapshot) for all 201 real historical rows — 2,814 real data points, not a synthetic approximation. All match exactly. |
| `data/export_snapshot.sql` + `data/btc_1d_trainval_snapshot.csv` | One-time, read-only, manually-run export (TRAIN+VALIDATION only, TEST split hard-excluded) — approved via an explicit ADR/approval process (see git history), not fetched live. `benchmark_production.py` never connects to Supabase; it only reads this static file. |
| `benchmark_production.py` | Runs the 6 factors with real coverage (of the 14 legacy factors — the other 8 have 0% coverage in this window and are reported as **NOT EVALUABLE**, explicitly not conflated with "found redundant") and 6 honestly-derivable new candidate factors (multi-horizon `close_price` momentum, Bollinger %B/bandwidth, a CVD Z-score — no synthetic OHLC/volume/funding was fabricated to reach a larger "new" set) through the same `PurgedWalkForwardCV` + `evaluate_features` pipeline. Reports mean out-of-sample Rank IC, a multicollinearity index, cross-fold importance stability, and PCA-based effective dimensionality (same participation-ratio method as the SQL-side Phase 2 H1 analysis) for both sets, then writes `BENCHMARK_RESULTS.md` with an explicit NOT-a-migration-decision disclaimer and a step-by-step roadmap toward an eventual real evaluation instead of a recommendation itself. |

## Dependence-aware inference (`src/validation/block_bootstrap.py`)

Moving Block Bootstrap (MBB), the inference method `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` Section 6a fixed for the eventual primary confirmatory test — implemented here as a standalone, reusable module (Path A of `ROADMAP.md`), not yet wired into `benchmark_production.py`.

| Component | Notes |
|---|---|
| `draw_moving_block_indices` | One MBB resample: draws `ceil(n/block_length)` block-start positions with replacement from a fixed block length (default 14 days = 2× the H=7-day dependence length derived in Phase 3.2), concatenates the contiguous blocks, truncates to length `n`. |
| `moving_block_bootstrap` | Generic engine — `statistic_fn` receives the resampled index array and computes whatever conditioned statistic it needs from its own closed-over data, so the resampling mechanism itself never has to know about state/condition logic. Blocks are always drawn from the **full** calendar series, never a pre-filtered subsequence — a condition-filtered series loses the true calendar-time distance between kept rows, which is what the dependence structure actually depends on (same point `evaluate.py` makes for clustering). CI via the percentile method; p-value via a centered/pivot bootstrap test against a **fixed, never-resampled** baseline. Seeds are required, not optional, everywhere in this module. |
| `block_bootstrap_hit_rate_difference` / `_mean_difference` / `_sharpe_ratio` | Convenience wrappers for the three metric families named in the task spec, all built on the same generic engine. Sharpe is explicitly unannualized (an `annualize`-style decision left to the caller, consistent with `volatility.garman_klass_volatility`). |
| `compare_iid_vs_block_bootstrap_ci_width` | Diagnostic utility, not used internally — compares the (invalid) naive iid Wald CI width against the actual block-bootstrap width on the same sample, for whoever runs the eventual confirmatory test. |

**Central claim, empirically demonstrated, not just documented:** *Block Bootstrap corrects the inference for dependence; it does not create additional information.* `tests/test_block_bootstrap.py::TestCorrectsInferenceNotInformation` builds a strongly autocorrelated synthetic binary series (Markov chain with `p_stay=0.85`, long same-value runs — unlike iid coin flips) and shows the block-bootstrap CI is >30% *wider* than the naive iid CI on the same raw n — a narrower interval would indicate fabricated precision, i.e. a bug. A companion test confirms the method does not wildly over-inflate uncertainty on genuinely iid data either (width ratio stays within 0.6–1.8).

## Migration decision framework (`src/validation/decision_framework.py`)

Formalizes the 4 Decision Gates from `BENCHMARK_RESULTS.md` Section 8 into an automated, fully-testable module — so the eventual real comparison runs against a pre-registered, not ad-hoc, decision procedure. Does not import from `benchmark_production.py` or `evaluate.py`; every gate function takes plain, well-typed inputs and reuses `block_bootstrap.py` for Gate 3's inference.

| Component | Notes |
|---|---|
| `GateStatus` / `MigrationDecision` | Three-state (`PASS`/`FAIL`/`INSUFFICIENT_DATA`) and three-state (`MIGRATE`/`REJECT`/`INSUFFICIENT_DATA`) enums. `INSUFFICIENT_DATA` is never conflated with `FAIL` — "no evidence of an edge" and "evidence of no edge" stay distinct, consistent with Phase 0–3.2 and every prior module in this project. |
| Gate 1 — `evaluate_gate_1_statistical_power` | `statistical_power` (two-sided one-sample proportion z-test, `scipy.stats.norm`) and `required_sample_size` (binary search) reimplement, independently, the exact formula used throughout `docs/research/PHASE-0..3.2` — golden-value cross-checked against the Phase-3.2 required-n table (baseline=0.535: effect 5/8/10/13/15pp → n=776/301/192/112/84, all 5 exact) in `tests/test_decision_framework.py::TestPowerMatchesPhase32`. Status is `PASS` or `INSUFFICIENT_DATA` only — never `FAIL`. |
| Gate 2 — `evaluate_gate_2_feature_coverage` | Per-feature non-null fraction vs. a required-feature list and minimum-coverage threshold — same notion of "coverage" as `benchmark_production.py`'s `LEGACY_EVALUABLE`/`NOT_EVALUABLE` split. `INSUFFICIENT_DATA`, not `FAIL`, for missing-entirely or below-threshold features. |
| Gate 3 — `evaluate_gate_3_performance` | Calls `block_bootstrap_hit_rate_difference` for dependence-corrected p-value/CI; `PASS` requires statistical significance AND practical relevance (`min_practically_relevant_effect`, an explicitly-flagged NOT-yet-finalized 5pp placeholder from Phase 3 Section 6.2) AND favorable direction, all three — a significant result in the wrong direction is a genuine `FAIL`. The underlying `ValueError` from an uncomputable bootstrap (e.g. the condition never matches) is caught and reclassified as `INSUFFICIENT_DATA`, never a crash. |
| Gate 4 — `evaluate_gate_4_stability` | Judges `evaluate.py`'s own cross-fold `importance_stability`/`selection_frequency` metrics against thresholds — deliberately decoupled from `evaluate.py`'s types (plain floats in, so it stays independently testable). `INSUFFICIENT_DATA` for too few folds or NaN inputs. Also takes an optional `pbo` argument (`walk_forward.compute_pbo(...).pbo`) enforced only when `StabilityGateConfig.max_pbo` is set — `None` by default on both, so every pre-existing caller is unaffected; if `max_pbo` is configured but no `pbo` is supplied, that configured requirement is not silently skipped — the gate returns `INSUFFICIENT_DATA` instead. |
| `combine_gate_results` | Strict, conservative rule: any gate `INSUFFICIENT_DATA` → overall `INSUFFICIENT_DATA` (takes priority over any `FAIL` — concluding `REJECT` from missing data would be exactly as premature as concluding `MIGRATE`); all four `PASS` → `MIGRATE`; otherwise `REJECT`. Raises `ValueError` on a partial or duplicated gate set rather than silently producing a decision. |

`tests/test_decision_framework.py` (60 tests, 100% coverage of this module) exercises every reachable status of every gate individually — including the `pbo`/`max_pbo` PASS/FAIL/INSUFFICIENT_DATA paths and a dedicated backward-compatibility check that calling Gate 4 exactly as before (no `pbo` argument) is unaffected — an end-to-end 4-gate pipeline on deterministic synthetic data for both the `MIGRATE` path (n=1000, clear edge) and the `INSUFFICIENT_DATA` path (n=201 — the actual current project state per `BENCHMARK_RESULTS.md`), and exhaustive `combine_gate_results` combination coverage (including `INSUFFICIENT_DATA` explicitly taking priority over a simultaneous `FAIL`).

## Multivariate candidate model (`src/multivariate/`) — first real run against sufficiently-powered data

This is the first module in `research-python/` actually run against real, sufficiently-powered data end-to-end (n≈530/oos≈320, vs. n=201 for `benchmark_production.py` above) — made possible by the 2-year Supabase-side backfill (see `docs/research/PHASE-1B-EXTENDED-HISTORY-VALIDATION_2026-09-04.md`) and a same-day on-chain history backfill (`backfill-onchain` Edge Function, `onchain_snapshots`).

Motivation: every SQL-side model tested in this project (`baseline_v1`/`domain_balanced_v1`/`calibrated_v1`/`redundancy_aware_v1` and their `_2y` extensions) discretizes each factor to {-1, 0, +1} by a hand-picked threshold before aggregating — this module instead keeps the underlying continuous/ordinal values and lets a regularized logistic regression learn its own weights and decision boundary, to test whether the discretization itself (not just the factor choice) was leaving information on the table.

| Component | Notes |
|---|---|
| `src/multivariate/features.py` (`build_features`) | Continuous/ordinal feature engineering from the raw SQL export — RSI/MACD-histogram/ADX/±DI kept as-is (not thresholded), EMA50/EMA200/VWAP distance as %, `structure_trend`/macro regime/Fear&Greed classification as ordinal scales (Fear&Greed kept in its natural low→high order, deliberately **not** pre-flipped to match production's contrarian convention — the model is meant to learn its own sign from data, not inherit the hand-built engine's assumption). Pure row-wise transforms, unit-tested (`tests/test_multivariate_features.py`, 8 tests). |
| `data/export_multivariate_snapshot.sql` + `data/multivariate_1d_snapshot.csv` | One-time, read-only, manually-run export, same pattern as `data/export_snapshot.sql` above. On-chain features are joined to the **prior** calendar day's observation, not the same day — conservative choice against undocumented same-day publication-timing leakage. |
| `src/multivariate/run_benchmark.py` | Trains two variants — `core` (12 price/derivatives features) and `core_onchain` (+5 on-chain features: SOPR, MVRV, LTH net-position-change, stablecoin-supply % change, whale-address count) — through `PurgedWalkForwardCV` (5 folds, expanding, purge=embargo=1 day) with a `StandardScaler` + `LogisticRegression(C=1.0)` per fold, collects out-of-sample predictions across all folds, and evaluates via Gates 1-3 of `decision_framework.py` plus `block_bootstrap_hit_rate_difference` against the empirical majority-class baseline. Gate 4 in its original HRP/MDI-importance-stability form is **not** run here (that gate answers "which of many candidate features are consistently selected", not relevant to this fixed, small, pre-specified feature set) — a simplified per-fold sign-consistency count (`folds_above_majority_baseline`) is reported instead, explicitly labeled as a simplification, not presented as the real Gate 4. |
| `BENCHMARK_MULTIVARIATE_RESULTS.json` | Full machine-readable output of the run below. |

**Result (both variants, pre-registered seed/config, not tuned after seeing numbers):**

| Variant | n (oos) | OOS hit rate | Majority baseline | Folds above baseline | Bootstrap diff | Gate 3 |
|---|---|---|---|---|---|---|
| `core` (12 features) | 320 | 49.06% | 51.88% | 1/5 | −2.81pp (p=0.249) | **FAIL** (wrong direction) |
| `core_onchain` (17 features) | 315 | 49.84% | 53.02% | 2/5 | −3.17pp (p=0.258) | **FAIL** (wrong direction) |

Both variants underperform the trivial "always predict the majority class" baseline — not merely fail to beat it. Gate 1 also reports `INSUFFICIENT_DATA` (n=320/315 vs. a required ≈780 for 80% power to detect a 5pp effect at this baseline) — but since the observed effect is already in the wrong direction, more data would not rescue this result on its own. Adding the 5 on-chain features did not help (if anything, marginally worse OOS hit rate, though within noise of the core variant).

**Consistent with, not contradicted by, every SQL-side finding in this project**: letting a model learn its own weights/thresholds instead of the production engine's hand-picked ones did not surface a hidden edge — reinforcing that the underlying factor set (price/derivatives technicals, largely trend-following) carries little standalone 24h directional information at this data volume, regardless of how it is combined. See `docs/research/MULTIVARIATE-MODEL-BENCHMARK_2026-09-04.md` for the full write-up and next-step framing.
