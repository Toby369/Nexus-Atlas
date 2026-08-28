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

**Not yet implemented / next step:** integrating these factors and the
walk-forward validator into an actual backtest/model-comparison pipeline,
and a migration strategy against the 14 existing production factors — not
started, deliberately, until there is a validated reason to touch
production (see repo `docs/research/PHASE-*` for why this project treats
that step as its own, evidence-gated decision).

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
  tests/
    lookahead_utils.py     # shared no-look-ahead test helpers
    test_derivatives.py
    test_volatility.py
    test_momentum.py
    test_walk_forward.py   # no-overlap / purge / embargo / monotonicity leak tests
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
pytest -v                                  # 62 tests
pytest --cov=src --cov-report=term-missing # with coverage (95% overall)
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
| `PurgedWalkForwardCV` | Sequential expanding or rolling walk-forward. `purge_window` bars removed from a fold's own train immediately before its test block; `embargo_window` bars removed specifically from the *next* fold's train immediately after a test block (matches the task spec's literal "blocked for the next train set" wording — documented as a deliberately conservative design choice, see module docstring for the reasoning). `test_size` has no implicit default (must be given explicitly); insufficient data raises a clear `ValueError` rather than silently producing fewer/degenerate folds. |
| `generate_combinatorial_splits` | Combinatorial Purged Cross-Validation (CPCV) split generator (Lopez de Prado, ch. 12) — the primitive a Probability-of-Backtest-Overfitting (PBO) analysis needs. Purge/embargo applied symmetrically at *every* train/test group boundary in both time directions, since combinatorial test-group selection means a train group can sit chronologically before **or** after a given test group. PBO statistic aggregation across paths is **not** implemented — this function only produces correctly purged/embargoed splits. |

`tests/test_walk_forward.py` verifies, for both generators: (a) train and
test indices never overlap, (b) no index from a purge or embargo zone ever
appears in a train set, and (c) for `PurgedWalkForwardCV` specifically,
train is always strictly chronologically before its own test block (no
future-data training) — while a dedicated CPCV test asserts the opposite is
true there by design (train legitimately appears after a test group in some
combinations), so the two behaviors are shown to actually differ, not just
asserted to.
