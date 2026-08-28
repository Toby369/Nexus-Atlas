# Production Factor Benchmark Results

> **DISCLAIMER (read first):** This report is a **pipeline / code-correctness verification exercise**, run on the TRAIN+VALIDATION snapshot (`data/btc_1d_trainval_snapshot.csv`, n=201 daily bars, 19.12.2025-07.07.2026). It validates that `legacy_factors.py` correctly reproduces the production engine's formulas (verified row-by-row against the engine's own reference values -- see `tests/test_legacy_factors.py`) and that the `PurgedWalkForwardCV` + `evaluate_features` pipeline runs correctly end to end on both factor sets. **It CANNOT be used as a statistically valid migration decision.** `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` established that adequate statistical power for the effect sizes this project has observed requires several *years* of further data accumulation -- n=201 falls far short of that, by design and by necessity (it is simply all the TRAIN+VALIDATION data that exists). Any IC, stability, or selection numbers below describe this specific 201-row sample only.

## 1. Data & Scope

- Source: `research-python/data/btc_1d_trainval_snapshot.csv`, n=201, TEST split hard-excluded.
- Walk-forward: 4 expanding folds, train_size>=60, test_size=25, purge_window=7, embargo_window=1.
- Primary evaluation horizon: 7d forward log-return (also reports 1d, 30d).

## 2. Legacy Factors -- Evaluability

Of the 14 production factors, **6 have real coverage** in this window and could be evaluated: structure, momentum, cvd, trend_strength, trend_regime, vwap_position.

**8 are NOT EVALUABLE** (0% coverage -- their raw data sources were not collecting yet in this period, per the Phase 6 audit): oi_price, positioning, orderbook, options, macro, funding, sentiment, basis. This is a *data availability* finding, not a *redundancy* finding -- these factors were never run through the evaluation, so nothing can be said about whether they would be redundant or informative once real data exists for them.

## 3. New Candidate Factors -- Honesty Note

The snapshot contains no OHLC (high/low), no volume, and no funding/OI/positioning/orderbook/options/macro/sentiment data (0% coverage, matching Phase 6). The only raw inputs available beyond what the 6 evaluable legacy factors already use are `close_price` and CVD (delta/cumulative/trend). The new candidate set is therefore honestly limited to 6 factors derived from those two inputs -- **no synthetic OHLC or volume was fabricated** to reach a larger set:

- `mom_1d`, `mom_7d`, `mom_14d`: log-return momentum at 1/7/14-day horizons (close_price)
- `percent_b`, `bandwidth`: Bollinger Bands, 20-period, 2 stddev (close_price)
- `cvd_zscore`: rolling 20-period Z-score of CVD delta


## 4. Legacy Factor Set Results

Multicollinearity index (mean |pairwise Pearson r|, full-sample, descriptive): **0.567**

Effective dimensionality (participation ratio): **2.22** of 6 nominal factors (dimension-reduction ratio: 0.37)

Selected (orthogonalized) representatives: `['cvd', 'structure']`

| feature        |   mean_importance |   importance_stability |   mean_adf_p_value |   stationarity_rate |   selection_frequency |   ic_mean_7d |   ic_std_7d |   rank_ic_mean_7d |   rank_ic_std_7d |   ic_mean_1d |   ic_std_1d |   rank_ic_mean_1d |   rank_ic_std_1d |   ic_mean_30d |   ic_std_30d |   rank_ic_mean_30d |   rank_ic_std_30d |
|:---------------|------------------:|-----------------------:|-------------------:|--------------------:|----------------------:|-------------:|------------:|------------------:|-----------------:|-------------:|------------:|------------------:|-----------------:|--------------:|-------------:|-------------------:|------------------:|
| structure      |            0.1204 |                 0.8838 |             0.0977 |                0.25 |                  0.25 |      -0.0221 |      0.3931 |           -0.0385 |           0.4061 |       0.0183 |      0.2946 |            0.0327 |           0.2453 |       -0.2369 |       0.4395 |            -0.1034 |            0.5079 |
| momentum       |            0.2966 |                 0.8075 |             0.083  |                0.5  |                  0.75 |      -0.1898 |      0.477  |           -0.2187 |           0.454  |      -0.1389 |      0.1674 |           -0.1471 |           0.1464 |       -0.3643 |       0.1905 |            -0.2533 |            0.262  |
| cvd            |            0.1565 |                 0.7826 |             0.0036 |                1    |                  0.75 |      -0.1652 |      0.3147 |           -0.197  |           0.2912 |      -0.1232 |      0.1898 |           -0.1205 |           0.1508 |       -0.2438 |       0.145  |            -0.2228 |            0.2803 |
| trend_strength |            0.2022 |                 0.6654 |             0.4519 |                0.25 |                  0.25 |      -0.0984 |      0.454  |           -0.1506 |           0.4262 |      -0.1905 |      0.192  |           -0.2013 |           0.1247 |       -0.1941 |       0.2778 |            -0.1855 |            0.3783 |
| trend_regime   |            0.1812 |                 0.7082 |             0.022  |                1    |                  0.25 |       0.0194 |      0.4953 |           -0.0219 |           0.4449 |       0.0067 |      0.1351 |            0.0054 |           0.1103 |       -0.3263 |       0.2423 |            -0.2647 |            0.2032 |
| vwap_position  |            0.0431 |                 0.5528 |             0.2984 |                0    |                  0    |      -0.1489 |      0.2813 |           -0.1472 |           0.2735 |      -0.0747 |      0.1795 |           -0.0615 |           0.1437 |       -0.3852 |       0.2594 |            -0.4202 |            0.2346 |


## 5. New Candidate Factor Set Results

Multicollinearity index (mean |pairwise Pearson r|, full-sample, descriptive): **0.441**

Effective dimensionality (participation ratio): **2.63** of 6 nominal factors (dimension-reduction ratio: 0.44)

Selected (orthogonalized) representatives: `['bandwidth', 'mom_14d', 'mom_1d']`

| feature    |   mean_importance |   importance_stability |   mean_adf_p_value |   stationarity_rate |   selection_frequency |   ic_mean_7d |   ic_std_7d |   rank_ic_mean_7d |   rank_ic_std_7d |   ic_mean_1d |   ic_std_1d |   rank_ic_mean_1d |   rank_ic_std_1d |   ic_mean_30d |   ic_std_30d |   rank_ic_mean_30d |   rank_ic_std_30d |
|:-----------|------------------:|-----------------------:|-------------------:|--------------------:|----------------------:|-------------:|------------:|------------------:|-----------------:|-------------:|------------:|------------------:|-----------------:|--------------:|-------------:|-------------------:|------------------:|
| mom_1d     |            0.1037 |                 0.92   |             0      |                1    |                     1 |      -0.1551 |      0.1586 |           -0.1698 |           0.1617 |      -0.0137 |      0.1872 |           -0.0244 |           0.205  |       -0.3535 |       0.1825 |            -0.3188 |            0.1708 |
| mom_7d     |            0.1202 |                 0.7108 |             0.1804 |                0    |                     0 |      -0.2756 |      0.4573 |           -0.2581 |           0.4292 |      -0.1889 |      0.1722 |           -0.1721 |           0.1789 |       -0.5038 |       0.3151 |            -0.431  |            0.2751 |
| mom_14d    |            0.1097 |                 0.7934 |             0.3513 |                0.25 |                     0 |      -0.2613 |      0.1458 |           -0.2119 |           0.2188 |      -0.2023 |      0.1951 |           -0.1538 |           0.1452 |       -0.3676 |       0.5494 |            -0.2033 |            0.4948 |
| percent_b  |            0.2113 |                 0.7639 |             0.254  |                0    |                     1 |      -0.3085 |      0.4162 |           -0.3371 |           0.4118 |      -0.1983 |      0.2582 |           -0.2006 |           0.2094 |       -0.5473 |       0.0963 |            -0.4673 |            0.1594 |
| bandwidth  |            0.3849 |                 0.7242 |             0.1152 |                0.5  |                     1 |       0.052  |      0.3713 |           -0.0733 |           0.3391 |      -0.072  |      0.1507 |           -0.0981 |           0.1103 |        0.4648 |       0.5359 |             0.38   |            0.3942 |
| cvd_zscore |            0.0702 |                 0.8725 |             0.0005 |                1    |                     0 |      -0.1039 |      0.1238 |           -0.18   |           0.0985 |      -0.0067 |      0.1598 |           -0.0321 |           0.1367 |       -0.3999 |       0.1794 |            -0.4017 |            0.1399 |

## 6. Cross-Set Comparison

| Metric | Legacy (evaluable, n=6) | New candidates (n=6) |
|---|---|---|
| Multicollinearity index | 0.567 | 0.441 |
| Effective dimensionality | 2.22/6 | 2.63/6 |
| Mean \|IC\| (7d, across factors) | 0.107 | 0.193 |

**No claim of superiority is made from this table.** With n=201 and the fold sizes above, the Minimum Detectable Effect for these IC comparisons is large relative to the differences shown (consistent with Phase 3.2's power analysis) -- these numbers describe this sample, not a validated difference in true predictive value.

## 7. Redundancy / Coverage Classification (as requested)

| Category | Factors |
|---|---|
| Legacy: NOT EVALUABLE (no data, not a redundancy finding) | oi_price, positioning, orderbook, options, macro, funding, sentiment, basis |
| Legacy: evaluable, clustered as redundant with another factor | momentum, trend_strength, trend_regime, vwap_position |
| Legacy: evaluable, selected as cluster representative | cvd, structure |
| New candidates: clustered as redundant with another factor | mom_7d, percent_b, cvd_zscore |
| New candidates: selected as cluster representative | bandwidth, mom_14d, mom_1d |

## 8. Step-by-Step Path Toward an Eventual Migration Decision

This is a **roadmap for how to reach a decision**, not a migration recommendation itself -- consistent with this project's explicit rule that no premature architecture/feature change may be derived from a power-deficient analysis (Phase 3, Section 11):

1. Continue passive data accumulation (already running, unaffected by this benchmark) until the 8 currently NOT EVALUABLE legacy factors have real coverage, and until the Phase-3.2 power targets for the primary 168h/7d horizon are met.
2. Re-run this exact benchmark (same code, same methodology) on that larger, real dataset -- not on a larger synthetic one.
3. Only then evaluate whether the new candidate set's cross-fold IC/stability is *statistically distinguishable* from the legacy set's (proper hypothesis test, corrected for multiple comparisons, per the Phase 3 pre-registration protocol) -- not just numerically different as in section 6 above.
4. A migration decision, if any, follows from step 3's outcome -- never from this n=201 mechanics run.
