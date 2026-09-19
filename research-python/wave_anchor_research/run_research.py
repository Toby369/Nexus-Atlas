"""Orchestriert die vollstaendige Wave-Anchor-Statistik-Batterie
(Aufgabenstellung Abschnitt 10-15): Tests A-G je Studien-Setup x
WaveTrend-Preset, TRAIN_VAL/OOS-Split (80/20, chronologisch, OOS bis zum
Freeze unberuehrt), gepoolte BH-FDR-Korrektur, OOS-Bestaetigung der
ueberlebenden Zellen, Regime-Aufschluesselung der bestaetigten Zellen.

Aufruf: python run_research.py
"""

from __future__ import annotations

import itertools
import os
import pickle
import time

import pandas as pd

from assemble import STUDY_SETUPS, assemble
from data_loader import load_ohlc
from mtf_join import close_time_of, confirmed_asof_join
from regime import compute_daily_regimes
from stats_battery import CellResult, apply_bh_fdr, cells_to_dataframe, evaluate_condition_vs_complement, evaluate_rank_ic
from targets import HORIZON_LABELS, horizon_bars_for_timeframe
from wavetrend import LAZYBEAR_ORIGINAL, VUMANCHU_DEFAULT

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
WT_PRESETS = {"LazyBear": LAZYBEAR_ORIGINAL, "VuManChu": VUMANCHU_DEFAULT}
OOS_FRACTION = 0.20
N_REPLICATES_CONDITION = 1000
N_REPLICATES_IC = 200
SEED_BASE = 20260919  # heutiges Datum als fixer, dokumentierter Seed


def _split_train_oos(df: pd.DataFrame, oos_fraction: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    n = len(df)
    split_idx = int(round(n * (1 - oos_fraction)))
    return df.iloc[:split_idx], df.iloc[split_idx:]


def _generate_cells(
    df: pd.DataFrame,
    setup_label: str,
    wt_preset_label: str,
    split_name: str,
    horizon_bars: dict[str, int],
    seed_counter: itertools.count,
    n_replicates_condition: int,
    n_replicates_ic: int,
) -> list[CellResult]:
    cells: list[CellResult] = []

    def cond_cell(feature_name, condition_label, condition_bool, test_category, horizon):
        return evaluate_condition_vs_complement(
            df[f"forward_return_{horizon}"], condition_bool, horizon_bars[horizon],
            seed=next(seed_counter), n_replicates=n_replicates_condition,
            study_setup=setup_label, wt_preset=wt_preset_label, split=split_name,
            test_category=test_category, feature=feature_name, condition=condition_label, horizon=horizon,
        )

    def ic_cell(feature_col, feature_name, test_category, horizon):
        return evaluate_rank_ic(
            df[feature_col], df[f"forward_return_{horizon}"], horizon_bars[horizon],
            seed=next(seed_counter), n_replicates=n_replicates_ic,
            study_setup=setup_label, wt_preset=wt_preset_label, split=split_name,
            test_category=test_category, feature=feature_name, horizon=horizon,
        )

    for horizon in HORIZON_LABELS:
        # A: Raw WaveTrend (Rank-IC)
        cells.append(ic_cell("htfA_wt2", "htfA_wt2", "A", horizon))
        cells.append(ic_cell("htfB_wt2", "htfB_wt2", "A", horizon))

        # B: Anchor State (OB/OS vs. Rest), je htfA/htfB/kombiniert
        for prefix, colname in [("htfA", "htfA_state"), ("htfB", "htfB_state"), ("combined", "mtf_confluence_combined")]:
            for state in ["OB", "OS"]:
                cells.append(cond_cell(f"{prefix}_state", state, df[colname] == state, "B", horizon))

        # C: Cross Events, je htfA/htfB
        for prefix in ["htfA", "htfB"]:
            for event in ["cross_up_60", "cross_down_60", "cross_down_minus60", "cross_up_minus60"]:
                col = f"{prefix}_{event}"
                cells.append(cond_cell(f"{prefix}_{event}", event, df[col].astype(bool), "C", horizon))

        # D: Slope, je htfA/htfB
        for prefix in ["htfA", "htfB"]:
            colname = f"{prefix}_direction"
            for d in ["RISING", "FALLING"]:
                cells.append(cond_cell(f"{prefix}_direction", d, df[colname] == d, "D", horizon))

        # E: Distance (Rank-IC), je htfA/htfB, je ob/os
        for prefix in ["htfA", "htfB"]:
            for dist_col in [f"{prefix}_dist_from_ob60", f"{prefix}_dist_from_os60"]:
                cells.append(ic_cell(dist_col, dist_col, "E", horizon))

        # F: State x Slope (htfA only, Scope-Entscheidung siehe Report)
        for state in ["OB", "OS", "NEUTRAL"]:
            for d in ["RISING", "FALLING"]:
                combo_mask = (df["htfA_state"] == state) & (df["htfA_direction"] == d)
                cells.append(
                    cond_cell("htfA_state_x_direction", f"{state}+{d}", combo_mask, "F", horizon)
                )

        # G: MTF-Konfluenz -- MIXED-Zusatzfall (OB/OS-kombiniert bereits unter B erfasst)
        cells.append(
            cond_cell(
                "mtf_confluence_combined", "MIXED",
                df["mtf_confluence_combined"] == "MIXED", "G", horizon,
            )
        )

    return cells


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    t_start = time.time()

    print("Lade Daten ...")
    dfs = {tf: load_ohlc(tf) for tf in ["15m", "1h", "4h", "1d"]}
    for tf, df in dfs.items():
        print(f"  {tf}: {len(df)} Kerzen, {df.index[0]} bis {df.index[-1]}")

    daily_regimes = compute_daily_regimes(dfs["1d"])

    all_train_cells: list[CellResult] = []
    assembled_by_combo: dict[tuple[str, str], pd.DataFrame] = {}
    seed_counter = itertools.count(SEED_BASE)

    for setup in STUDY_SETUPS:
        horizon_bars = horizon_bars_for_timeframe(setup.ltf)
        for preset_label, wt_params in WT_PRESETS.items():
            combo_label = f"{setup.label} | {preset_label}"
            t0 = time.time()
            full_df = assemble(dfs[setup.ltf], dfs[setup.htf_a], dfs[setup.htf_b], setup, wt_params)

            regime_joined = confirmed_asof_join(
                close_time_of(full_df, setup.ltf), daily_regimes, "1d", ["trend_regime", "vol_regime"],
            ).reset_index(drop=True)
            regime_joined.index = full_df.index
            full_df = pd.concat([full_df, regime_joined], axis=1)

            assembled_by_combo[(setup.label, preset_label)] = full_df
            train_df, oos_df = _split_train_oos(full_df, OOS_FRACTION)
            print(
                f"[{combo_label}] assembled in {time.time()-t0:.1f}s, "
                f"n={len(full_df)} (train={len(train_df)}, oos={len(oos_df)})"
            )

            t1 = time.time()
            cells = _generate_cells(
                train_df, setup.label, preset_label, "TRAIN_VAL", horizon_bars, seed_counter,
                N_REPLICATES_CONDITION, N_REPLICATES_IC,
            )
            all_train_cells.extend(cells)
            print(f"[{combo_label}] {len(cells)} TRAIN_VAL-Zellen in {time.time()-t1:.1f}s")

    print(f"\nGesamt TRAIN_VAL-Zellen: {len(all_train_cells)}. Wende BH-FDR an (EIN Pool) ...")
    apply_bh_fdr(all_train_cells, alpha=0.05)
    n_ok = sum(1 for c in all_train_cells if c.status == "OK")
    n_bh_sig = sum(1 for c in all_train_cells if c.bh_significant)
    print(f"  {n_ok} evaluierbare Zellen, {n_bh_sig} ueberleben BH-FDR (alpha=0.05).")

    train_df_out = cells_to_dataframe(all_train_cells)
    train_df_out.to_csv(os.path.join(OUTPUT_DIR, "cells_train_val.csv"), index=False)

    # OOS-Bestaetigung NUR fuer BH-signifikante Zellen.
    survivors = [c for c in all_train_cells if c.bh_significant]
    oos_cells: list[CellResult] = []
    print(f"\nOOS-Bestaetigung fuer {len(survivors)} ueberlebende Zellen ...")
    for c in survivors:
        setup_label = c.study_setup
        preset_label = c.wt_preset
        full_df = assembled_by_combo[(setup_label, preset_label)]
        _, oos_df = _split_train_oos(full_df, OOS_FRACTION)
        setup = next(s for s in STUDY_SETUPS if s.label == setup_label)
        horizon_bars = horizon_bars_for_timeframe(setup.ltf)

        if c.test_category in ("A", "E"):
            oos_result = evaluate_rank_ic(
                oos_df[c.feature], oos_df[f"forward_return_{c.horizon}"], horizon_bars[c.horizon],
                seed=next(seed_counter), n_replicates=5000,
                study_setup=setup_label, wt_preset=preset_label, split="OOS",
                test_category=c.test_category, feature=c.feature, horizon=c.horizon,
            )
        else:
            if c.test_category == "F":
                state, direction = c.condition.split("+")
                mask = (oos_df["htfA_state"] == state) & (oos_df["htfA_direction"] == direction)
            elif c.test_category == "C":
                col = c.feature
                mask = oos_df[col].astype(bool)
            else:
                mask = oos_df[c.feature] == c.condition
            oos_result = evaluate_condition_vs_complement(
                oos_df[f"forward_return_{c.horizon}"], mask, horizon_bars[c.horizon],
                seed=next(seed_counter), n_replicates=5000,
                study_setup=setup_label, wt_preset=preset_label, split="OOS",
                test_category=c.test_category, feature=c.feature, condition=c.condition, horizon=c.horizon,
            )
        oos_cells.append(oos_result)

    oos_df_out = cells_to_dataframe(oos_cells)
    oos_df_out.to_csv(os.path.join(OUTPUT_DIR, "cells_oos.csv"), index=False)

    with open(os.path.join(OUTPUT_DIR, "_research_state.pkl"), "wb") as f:
        pickle.dump(
            {"train_cells": all_train_cells, "oos_cells": oos_cells, "daily_regimes": daily_regimes},
            f,
        )

    print(f"\nFertig in {time.time()-t_start:.1f}s. Zellen gespeichert in output/.")


if __name__ == "__main__":
    main()
