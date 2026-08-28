"""Shared helper for look-ahead-bias unit tests.

The core technique: a feature function is look-ahead-free if and only if
truncating its input at some cutoff time T does not change any of the
values it produced for t <= T on the full series. If it *did* change, the
function must have used data from t > T to compute a value at some t <= T --
i.e. it peeked into the future.

Two complementary checks are provided:

1. ``assert_no_lookahead_on_truncation``: compute on the full series and on
   a series truncated at T, compare the overlap.
2. ``assert_no_lookahead_on_future_perturbation``: compute once, then
   *mutate* only the values strictly after T (arbitrary large numbers) and
   recompute -- the values at/ before T must be byte-for-byte identical.
   This catches bugs that (1) alone might miss if the perturbed truncation
   happens to coincide with a rolling window boundary in a way that doesn't
   expose the leak.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd


def _to_frame(obj: pd.Series | pd.DataFrame) -> pd.DataFrame:
    return obj.to_frame() if isinstance(obj, pd.Series) else obj


def assert_no_lookahead_on_truncation(
    compute_fn: Callable[[pd.Series | pd.DataFrame], pd.Series | pd.DataFrame],
    full_input: pd.Series | pd.DataFrame,
    cutoff_pos: int,
) -> None:
    """`compute_fn(full_input)` vs `compute_fn(full_input[:cutoff_pos+1])` must
    agree on every row up to and including `cutoff_pos`."""
    full_result = _to_frame(compute_fn(full_input))
    truncated_input = full_input.iloc[: cutoff_pos + 1]
    truncated_result = _to_frame(compute_fn(truncated_input))

    full_overlap = full_result.iloc[: cutoff_pos + 1]
    pd.testing.assert_frame_equal(
        full_overlap.reset_index(drop=True),
        truncated_result.reset_index(drop=True),
        check_dtype=False,
        obj="look-ahead check (truncation)",
    )


def assert_no_lookahead_on_future_perturbation(
    compute_fn: Callable[[pd.Series | pd.DataFrame], pd.Series | pd.DataFrame],
    full_input: pd.Series | pd.DataFrame,
    cutoff_pos: int,
    perturbation_scale: float = 1e6,
) -> None:
    """Mutate only rows after `cutoff_pos` and confirm rows <= cutoff_pos
    are completely unaffected."""
    baseline_result = _to_frame(compute_fn(full_input))

    perturbed_input = full_input.copy()
    n = len(perturbed_input)
    if cutoff_pos + 1 >= n:
        raise ValueError("cutoff_pos must leave at least one future row to perturb")

    numeric_cols = (
        perturbed_input.select_dtypes(include=[np.number]).columns
        if isinstance(perturbed_input, pd.DataFrame)
        else None
    )
    if numeric_cols is not None:
        for col in numeric_cols:
            perturbed_input.iloc[cutoff_pos + 1 :, perturbed_input.columns.get_loc(col)] = (
                perturbation_scale * (1 + np.arange(n - cutoff_pos - 1))
            )
    else:
        perturbed_input.iloc[cutoff_pos + 1 :] = perturbation_scale * (
            1 + np.arange(n - cutoff_pos - 1)
        )

    perturbed_result = _to_frame(compute_fn(perturbed_input))

    pd.testing.assert_frame_equal(
        baseline_result.iloc[: cutoff_pos + 1].reset_index(drop=True),
        perturbed_result.iloc[: cutoff_pos + 1].reset_index(drop=True),
        check_dtype=False,
        obj="look-ahead check (future perturbation)",
    )


def make_datetime_index(n: int, freq: str = "h") -> pd.DatetimeIndex:
    return pd.date_range("2024-01-01", periods=n, freq=freq)
