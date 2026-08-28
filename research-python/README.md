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

**Not yet implemented / next step:** integrating this into an actual
backtest/model-comparison pipeline, and a migration strategy against the 14
existing production factors — not started, deliberately, until there is a
validated reason to touch production (see repo `docs/research/PHASE-*` for
why this project treats that step as its own, evidence-gated decision).

## Structure

```
research-python/
  src/
    features/
      derivatives.py   # funding_zscore, funding_persistence, oi_volume_ratio
      volatility.py    # garman_klass_volatility, bollinger_bands
      momentum.py      # adx (Wilder), log_return, return_momentum
    validation/
      walk_forward.py  # PurgedWalkForwardCV, generate_combinatorial_splits (CPCV)
    selection/
      orthogonal.py    # HRP-style clustering, Clustered Feature Importance
      evaluate.py       # fold-by-fold importance/ADF/IC evaluation engine
  tests/
    lookahead_utils.py     # shared no-look-ahead test helpers
    test_derivatives.py
    test_volatility.py
    test_momentum.py
    test_walk_forward.py   # no-overlap / purge / embargo / monotonicity leak tests
    test_selection.py      # fold-discipline tests + synthetic noise/regime/collinearity benchmark
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
pytest -v                                  # 102 tests
pytest --cov=src --cov-report=term-missing # with coverage (96% overall)
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
| `generate_combinatorial_splits` | Combinatorial Purged Cross-Validation (CPCV) split generator (Lopez de Prado, ch. 12) — the primitive a Probability-of-Backtest-Overfitting (PBO) analysis needs. Purge/embargo applied symmetrically at *every* train/test group boundary in both time directions, since combinatorial test-group selection means a train group can sit chronologically before **or** after a given test group. PBO statistic aggregation across paths is **not** implemented — this function only produces correctly purged/embargoed splits. |

`tests/test_walk_forward.py` verifies, for both generators: (a) train and
test indices never overlap, (b) no index from a purge or embargo zone ever
appears in a train set, and (c) for `PurgedWalkForwardCV` specifically,
train is always strictly chronologically before its own test block (no
future-data training) — while a dedicated CPCV test asserts the opposite is
true there by design (train legitimately appears after a test group in some
combinations), so the two behaviors are shown to actually differ, not just
asserted to.

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
