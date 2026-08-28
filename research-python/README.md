# research-python

Standalone Python framework for computing and purged walk-forward-validating
BTC/USDT perpetual market-state factors. Deliberately separate from the main
Next.js/Supabase Nexus-Atlas application (`app/`, `lib/`, `supabase/`) — no
imports either direction, no shared runtime. This is a research/prototyping
track exploring alternative factor definitions; it does not read from or
write to the production Supabase project, and does not affect
`compute-market-state` or any live dashboard behavior.

## Status

**Step 1 of the framework (current):** the three feature modules
(`derivatives.py`, `volatility.py`, `momentum.py`) and their look-ahead-bias
unit tests. This is what exists right now.

**Not yet implemented:** `src/validation/walk_forward.py` is scaffolding
only (interface + docstring, raises `NotImplementedError`) — the purged /
embargoed walk-forward cross-validator is the next step, not part of this
delivery.

## Structure

```
research-python/
  src/
    features/
      derivatives.py   # funding_zscore, funding_persistence, oi_volume_ratio
      volatility.py    # garman_klass_volatility, bollinger_bands
      momentum.py      # adx (Wilder), log_return, return_momentum
    validation/
      walk_forward.py  # NOT YET IMPLEMENTED - interface stub only
  tests/
    lookahead_utils.py     # shared no-look-ahead test helpers
    test_derivatives.py
    test_volatility.py
    test_momentum.py
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
pytest -v
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
