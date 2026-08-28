from __future__ import annotations

from itertools import combinations

import numpy as np
import pandas as pd
import pytest

from src.validation.walk_forward import PurgedWalkForwardCV, generate_combinatorial_splits


# ---------------------------------------------------------------------------
# PurgedWalkForwardCV
# ---------------------------------------------------------------------------


@pytest.fixture
def price_index() -> pd.DatetimeIndex:
    return pd.date_range("2024-01-01", periods=1000, freq="h")


class TestPurgedWalkForwardCVValidation:
    def test_requires_test_size(self):
        with pytest.raises(ValueError, match="test_size"):
            PurgedWalkForwardCV(n_splits=3)

    def test_rolling_requires_train_size(self):
        with pytest.raises(ValueError, match="train_size"):
            PurgedWalkForwardCV(n_splits=3, test_size=50, expanding=False)

    def test_negative_purge_rejected(self):
        with pytest.raises(ValueError, match="purge_window"):
            PurgedWalkForwardCV(n_splits=3, test_size=50, purge_window=-1)

    def test_negative_embargo_rejected(self):
        with pytest.raises(ValueError, match="embargo_window"):
            PurgedWalkForwardCV(n_splits=3, test_size=50, embargo_window=-1)

    def test_zero_splits_rejected(self):
        with pytest.raises(ValueError, match="n_splits"):
            PurgedWalkForwardCV(n_splits=0, test_size=50)

    def test_insufficient_data_raises_clear_error(self, price_index):
        cv = PurgedWalkForwardCV(n_splits=50, test_size=100, purge_window=24, embargo_window=24)
        with pytest.raises(ValueError, match="does not fit"):
            list(cv.split(price_index))

    def test_bool_rejected_as_size(self, price_index):
        cv = PurgedWalkForwardCV(n_splits=2, test_size=True)
        with pytest.raises(ValueError, match="bool"):
            list(cv.split(price_index))

    def test_negative_size_rejected(self, price_index):
        cv = PurgedWalkForwardCV(n_splits=2, test_size=-5)
        with pytest.raises(ValueError, match="test_size"):
            list(cv.split(price_index))

    def test_get_n_splits(self):
        cv = PurgedWalkForwardCV(n_splits=7, test_size=10)
        assert cv.get_n_splits() == 7


class TestPurgedWalkForwardCVNoLeakage:
    """(a) train/test never overlap; (b) purge/embargo zones never appear in
    train; (c) train is strictly before test (no future-data training) --
    exactly the three checks the task spec requires."""

    @pytest.fixture
    def folds(self, price_index):
        cv = PurgedWalkForwardCV(
            n_splits=5, test_size=100, purge_window=24, embargo_window=24, expanding=True
        )
        return list(cv.split(price_index))

    def test_correct_number_of_folds(self, folds):
        assert len(folds) == 5

    def test_a_no_train_test_overlap(self, folds):
        for i, (train_idx, test_idx) in enumerate(folds):
            overlap = set(train_idx) & set(test_idx)
            assert not overlap, f"fold {i}: train/test overlap at {sorted(overlap)[:10]}"

    def test_b_purge_window_excluded_from_own_train(self, folds):
        purge_window = 24
        for i, (train_idx, test_idx) in enumerate(folds):
            test_start = test_idx.min()
            purge_zone = set(range(test_start - purge_window, test_start))
            leaked = purge_zone & set(train_idx)
            assert not leaked, f"fold {i}: purge-zone indices leaked into train: {sorted(leaked)[:10]}"

    def test_b_embargo_window_excluded_from_next_train(self, folds):
        embargo_window = 24
        for i in range(1, len(folds)):
            prev_test_idx = folds[i - 1][1]
            this_train_idx = folds[i][0]
            embargo_zone = set(range(prev_test_idx.max() + 1, prev_test_idx.max() + 1 + embargo_window))
            leaked = embargo_zone & set(this_train_idx)
            assert not leaked, f"fold {i}: embargo-zone indices leaked into train: {sorted(leaked)[:10]}"

    def test_c_train_strictly_precedes_test(self, folds):
        for i, (train_idx, test_idx) in enumerate(folds):
            assert train_idx.max() < test_idx.min(), (
                f"fold {i}: train reaches into or past the test block "
                f"(train max={train_idx.max()}, test min={test_idx.min()}) -- "
                "sequential walk-forward must never train on data at or after "
                "its own test period."
            )

    def test_test_blocks_are_sequential_and_non_overlapping(self, folds):
        test_blocks = [test_idx for _, test_idx in folds]
        for a, b in zip(test_blocks, test_blocks[1:]):
            assert a.max() < b.min(), "test blocks must be strictly increasing in time"

    def test_expanding_train_grows_across_folds(self, folds):
        sizes = [len(train_idx) for train_idx, _ in folds]
        assert sizes == sorted(sizes), f"expanding train sizes should be non-decreasing: {sizes}"
        assert sizes[-1] > sizes[0]

    def test_rolling_train_size_is_bounded(self, price_index):
        cv = PurgedWalkForwardCV(
            n_splits=5, train_size=150, test_size=100, purge_window=24, embargo_window=24, expanding=False
        )
        folds = list(cv.split(price_index))
        for train_idx, _ in folds:
            assert len(train_idx) <= 150

    def test_fractional_sizes_resolve_relative_to_n_samples(self, price_index):
        n = len(price_index)
        cv = PurgedWalkForwardCV(n_splits=3, test_size=0.05, purge_window=10, embargo_window=10)
        folds = list(cv.split(price_index))
        expected_test_size = max(1, round(0.05 * n))
        for _, test_idx in folds:
            assert len(test_idx) == expected_test_size

    def test_zero_purge_embargo_still_no_overlap(self, price_index):
        cv = PurgedWalkForwardCV(n_splits=4, test_size=50, purge_window=0, embargo_window=0)
        folds = list(cv.split(price_index))
        for train_idx, test_idx in folds:
            assert not (set(train_idx) & set(test_idx))

    def test_indices_are_valid_positions(self, price_index, folds):
        n = len(price_index)
        for train_idx, test_idx in folds:
            assert train_idx.min() >= 0
            assert test_idx.max() < n


# ---------------------------------------------------------------------------
# generate_combinatorial_splits (CPCV)
# ---------------------------------------------------------------------------


class TestCombinatorialSplitsValidation:
    def test_n_groups_too_small(self):
        with pytest.raises(ValueError, match="n_groups"):
            list(generate_combinatorial_splits(n_samples=100, n_groups=1, n_test_groups=1))

    def test_n_test_groups_out_of_range(self):
        with pytest.raises(ValueError, match="n_test_groups"):
            list(generate_combinatorial_splits(n_samples=100, n_groups=5, n_test_groups=5))
        with pytest.raises(ValueError, match="n_test_groups"):
            list(generate_combinatorial_splits(n_samples=100, n_groups=5, n_test_groups=0))

    def test_purge_embargo_too_large_for_group_size(self):
        with pytest.raises(ValueError, match="does not leave room"):
            list(
                generate_combinatorial_splits(
                    n_samples=100, n_groups=10, n_test_groups=2, purge_window=8, embargo_window=8
                )
            )


class TestCombinatorialSplitsNoLeakage:
    N_SAMPLES = 600
    N_GROUPS = 6
    N_TEST_GROUPS = 2
    PURGE = 5
    EMBARGO = 5

    @pytest.fixture
    def all_splits(self):
        return list(
            generate_combinatorial_splits(
                n_samples=self.N_SAMPLES,
                n_groups=self.N_GROUPS,
                n_test_groups=self.N_TEST_GROUPS,
                purge_window=self.PURGE,
                embargo_window=self.EMBARGO,
            )
        )

    def test_yields_all_combinations(self, all_splits):
        expected = len(list(combinations(range(self.N_GROUPS), self.N_TEST_GROUPS)))
        assert len(all_splits) == expected

    def test_a_no_train_test_overlap(self, all_splits):
        for train_idx, test_idx, group_ids in all_splits:
            overlap = set(train_idx) & set(test_idx)
            assert not overlap, f"groups {group_ids}: train/test overlap"

    def test_b_purge_and_embargo_zones_excluded_from_train(self, all_splits):
        group_bounds = np.linspace(0, self.N_SAMPLES, self.N_GROUPS + 1, dtype=int)
        group_ranges = [(int(group_bounds[i]), int(group_bounds[i + 1])) for i in range(self.N_GROUPS)]

        for train_idx, test_idx, test_group_ids in all_splits:
            train_set = set(train_idx)
            test_group_set = set(test_group_ids)
            for g in test_group_set:
                start, end = group_ranges[g]
                # purge zone: PURGE bars before this test group
                purge_zone = set(range(max(0, start - self.PURGE), start))
                leaked_purge = purge_zone & train_set
                assert not leaked_purge, (
                    f"groups {test_group_ids}: purge zone before test-group {g} "
                    f"leaked into train: {sorted(leaked_purge)[:10]}"
                )
                # embargo zone: EMBARGO bars after this test group
                embargo_zone = set(range(end, min(self.N_SAMPLES, end + self.EMBARGO)))
                leaked_embargo = embargo_zone & train_set
                assert not leaked_embargo, (
                    f"groups {test_group_ids}: embargo zone after test-group {g} "
                    f"leaked into train: {sorted(leaked_embargo)[:10]}"
                )

    def test_c_cpcv_explicitly_allows_train_both_before_and_after_test(self, all_splits):
        """Unlike sequential walk-forward, CPCV legitimately has train groups
        chronologically *after* a test group -- this is the explicit,
        intentional exception the task spec refers to ("ohne explizite
        CPCV-Logik"). Assert this actually occurs for at least one split,
        proving the two code paths are genuinely different, not that CPCV
        happens to degenerate into sequential walk-forward here."""
        found_train_after_test = False
        for train_idx, test_idx, _ in all_splits:
            if train_idx.max() > test_idx.min():
                found_train_after_test = True
                break
        assert found_train_after_test, (
            "expected at least one CPCV combination with train data chronologically "
            "after a test block"
        )

    def test_test_group_ids_match_declared_combination_count(self, all_splits):
        seen = {group_ids for _, _, group_ids in all_splits}
        assert len(seen) == len(all_splits), "every combination of test groups should be unique"

    def test_all_indices_within_bounds(self, all_splits):
        for train_idx, test_idx, _ in all_splits:
            assert train_idx.min() >= 0
            assert test_idx.max() < self.N_SAMPLES
            assert train_idx.max() < self.N_SAMPLES

    def test_train_and_test_together_cover_most_of_the_timeline(self, all_splits):
        # For the single-test-group case (n_test_groups=1), train+test+purge+embargo
        # should cover the vast majority of n_samples (only purge/embargo bars are ever "lost").
        single_test_splits = list(
            generate_combinatorial_splits(
                n_samples=self.N_SAMPLES,
                n_groups=self.N_GROUPS,
                n_test_groups=1,
                purge_window=self.PURGE,
                embargo_window=self.EMBARGO,
            )
        )
        for train_idx, test_idx, _ in single_test_splits:
            covered = len(set(train_idx) | set(test_idx))
            assert covered >= self.N_SAMPLES - 2 * (self.PURGE + self.EMBARGO)
