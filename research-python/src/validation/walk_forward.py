"""Purged walk-forward cross-validation for the BTC/USDT factor pipeline.

NOT YET IMPLEMENTED. This module is scaffolding only, per the task's own
"als Erstes die Feature-Module" instruction -- the feature modules
(derivatives.py, volatility.py, momentum.py) and their look-ahead tests are
the deliverable of this step. The interface below documents the planned
contract so callers/tests can be written against it in a subsequent step,
without pretending the implementation already exists.

Planned design (from the task spec, not yet built):
  - Combinatorial / Rolling Purged Walk-Forward Cross-Validation.
  - Purging window: 24h before/after each test split (removes training rows
    whose label horizon would overlap into the test split, and vice versa).
  - Embargo window: an additional 24h buffer after each test split.
  - Must reuse the same purge/embargo *concept* already implemented and
    validated for the Supabase/SQL side of this project (see
    docs/research/PHASE-1-VALIDATION-INTEGRITY.md and
    docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md for the purging, embargo,
    and dependence-correction methodology this Python module should mirror)
    -- not a new, independently-invented definition of purging/embargo.
"""

from __future__ import annotations

import pandas as pd


class PurgedWalkForwardSplitter:
    """Planned interface -- raises NotImplementedError until implemented."""

    def __init__(self, n_splits: int, purge_hours: int = 24, embargo_hours: int = 24) -> None:
        self.n_splits = n_splits
        self.purge_hours = purge_hours
        self.embargo_hours = embargo_hours

    def split(self, index: pd.DatetimeIndex):
        raise NotImplementedError(
            "PurgedWalkForwardSplitter.split() is scaffolding only -- not yet "
            "implemented. See module docstring."
        )
