"""Orchestriert die vollstaendige Wave-Anchor-Statistik-Batterie v2
(Aufgabenstellung v2, Abschnitt 14 "TESTMATRIX", TEST 1-12): je Studien-Setup
x WaveTrend-Preset, TRAIN_VAL/OOS-Split (80/20, chronologisch, OOS bis zum
Freeze unberuehrt), gepoolte BH-FDR-Korrektur, OOS-Bestaetigung der
ueberlebenden Zellen, Regime-Aufschluesselung der bestaetigten Zellen.

WICHTIG (v2-Neuerung): WT1 UND WT2 werden vollstaendig getrennt getestet
(Abschnitt 5), sowie -- wo die Nutzer-Testmatrix es nicht explizit auf ein
Level (±60) einschraenkt -- alle drei aus der Primaerquelle bestaetigten
Threshold-Paare (Abschnitt 6). Dokumentierte Scope-Entscheidung (aus
Rechenzeitgruenden, VOR jeder Ergebnisbetrachtung festgelegt, siehe
WAVE-ANCHOR-FEATURE-SPECIFICATION.md):
  - TEST 3/4 (State):      alle 3 Level (Abschnitt 6 verlangt das explizit)
  - TEST 5 (Cross):        nur Level 2 (±60, wie in der Nutzer-Nummerierung
                             "TEST 5: Cross ±60" explizit benannt)
  - TEST 7 (Distance):     nur Level 2 (Distanz ist eine kontinuierliche
                             Transformation der Rohwelle -- TEST 1/2 deckt
                             die Rohwert-Korrelation bereits ab)
  - TEST 8 (Duration):     nur Level 2
  - TEST 9/10 (Konfluenz): nur Level 2 (Hauptfokus laut allen gefundenen
                             oeffentlichen Beschreibungen)
  - TEST 11 (State x Slope): nur Level 2, HTF A only
  - TEST 12 (vs. Momentum): eigene IC-Zellenserie auf den bereits
                             vorhandenen baseline_*-Spalten, im Report
                             explizit numerisch gegen TEST-1/2/3/4-IC/Effekt-
                             groessen gestellt

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
from features import THRESHOLD_LEVELS, WAVE_NAMES
from mtf_join import close_time_of, confirmed_asof_join
from regime import compute_daily_regimes
from stats_battery import CellResult, apply_bh_fdr, cells_to_dataframe, evaluate_condition_vs_complement, evaluate_rank_ic
from targets import HORIZON_LABELS, horizon_bars_for_timeframe
from wavetrend import LAZYBEAR_ORIGINAL, VUMANCHU_DEFAULT

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
WT_PRESETS = {"LazyBear": LAZYBEAR_ORIGINAL, "VuManChu": VUMANCHU_DEFAULT}
OOS_FRACTION = 0.20
N_REPLICATES_CONDITION = 1000
N_REPLICATES_IC = 1000  # nach Rang-Vorberechnung (stats_battery.py) kein Kostenunterschied mehr zu Condition-Zellen
SEED_BASE = 20260919  # heutiges Datum als fixer, dokumentierter Seed

L2 = "L2"  # ±60, Hauptfokus-Level fuer TEST 5/7/8/9/10/11 (siehe Modul-Docstring)
BASELINE_COLS = ["baseline_momentum", "baseline_ema_trend", "baseline_rsi", "baseline_macd_hist"]


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
        # TEST 1/2: WT1/WT2 Rohwert (Rank-IC), je HTF A/B.
        for wave, test_cat in [("wt1", "TEST1"), ("wt2", "TEST2")]:
            for prefix in ["htfA", "htfB"]:
                cells.append(ic_cell(f"{prefix}_{wave}", f"{prefix}_{wave}", test_cat, horizon))

        # TEST 3/4: WT1/WT2-State (OB/OS vs. Rest), je HTF A/B, ALLE 3 Level.
        for wave, test_cat in [("wt1", "TEST3"), ("wt2", "TEST4")]:
            for prefix in ["htfA", "htfB"]:
                for level in THRESHOLD_LEVELS:
                    colname = f"{prefix}_{wave}_{level}_state"
                    for state in ["OB", "OS"]:
                        cells.append(cond_cell(f"{prefix}_{wave}_{level}_state", state, df[colname] == state, test_cat, horizon))

        # TEST 5: Cross-Events, nur Level 2 (±60), je HTF A/B, je Welle.
        for prefix in ["htfA", "htfB"]:
            for wave in WAVE_NAMES:
                for event in ["cross_up_ob", "cross_down_ob", "cross_down_os", "cross_up_os"]:
                    col = f"{prefix}_{wave}_{L2}_{event}"
                    cells.append(cond_cell(f"{prefix}_{wave}_{L2}_{event}", event, df[col].astype(bool), "TEST5", horizon))

        # TEST 6: Slope, je HTF A/B, je Welle (level-unabhaengig).
        for prefix in ["htfA", "htfB"]:
            for wave in WAVE_NAMES:
                colname = f"{prefix}_{wave}_direction"
                for d in ["RISING", "FALLING"]:
                    cells.append(cond_cell(f"{prefix}_{wave}_direction", d, df[colname] == d, "TEST6", horizon))

        # TEST 7: Distance (Rank-IC), nur Level 2, je HTF A/B, je Welle, je ob/os.
        for prefix in ["htfA", "htfB"]:
            for wave in WAVE_NAMES:
                for dist_col in [f"{prefix}_{wave}_{L2}_dist_from_ob", f"{prefix}_{wave}_{L2}_dist_from_os"]:
                    cells.append(ic_cell(dist_col, dist_col, "TEST7", horizon))

        # TEST 8: Anchor Duration (Rank-IC), nur Level 2, je HTF A/B, je Welle, je ob/os.
        for prefix in ["htfA", "htfB"]:
            for wave in WAVE_NAMES:
                for dur_col in [f"{prefix}_{wave}_{L2}_anchor_duration_ob", f"{prefix}_{wave}_{L2}_anchor_duration_os"]:
                    cells.append(ic_cell(dur_col, dur_col, "TEST8", horizon))

        # TEST 9/10: MTF-Konfluenz, nur Level 2, je Welle (welches Setup
        # "9" bzw. "10" entspricht, ergibt sich aus setup_label selbst).
        for wave in WAVE_NAMES:
            colname = f"mtf_confluence_{wave}_{L2}"
            for state in ["OB", "OS", "MIXED"]:
                cells.append(cond_cell(colname, state, df[colname] == state, "TEST9_10", horizon))

        # TEST 11: State x Slope, nur Level 2, HTF A only.
        for wave in WAVE_NAMES:
            state_col = f"htfA_{wave}_{L2}_state"
            dir_col = f"htfA_{wave}_direction"
            for state in ["OB", "OS", "NEUTRAL"]:
                for d in ["RISING", "FALLING"]:
                    combo_mask = (df[state_col] == state) & (df[dir_col] == d)
                    cells.append(cond_cell(f"htfA_{wave}_{L2}_state_x_direction", f"{state}+{d}", combo_mask, "TEST11", horizon))

        # TEST 12: Baseline-Vergleichsgroessen (Momentum/EMA/RSI/MACD),
        # Rank-IC -- im Report explizit gegen TEST1-4 gestellt.
        for col in BASELINE_COLS:
            cells.append(ic_cell(col, col, "TEST12_BASELINE", horizon))

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

        if c.test_category in ("TEST1", "TEST2", "TEST7", "TEST8", "TEST12_BASELINE"):
            oos_result = evaluate_rank_ic(
                oos_df[c.feature], oos_df[f"forward_return_{c.horizon}"], horizon_bars[c.horizon],
                seed=next(seed_counter), n_replicates=5000,
                study_setup=setup_label, wt_preset=preset_label, split="OOS",
                test_category=c.test_category, feature=c.feature, horizon=c.horizon,
            )
        else:
            if c.test_category == "TEST11":
                state, direction = c.condition.split("+")
                wave = "wt1" if "wt1" in c.feature else "wt2"
                mask = (oos_df[f"htfA_{wave}_{L2}_state"] == state) & (oos_df[f"htfA_{wave}_direction"] == direction)
            elif c.test_category == "TEST5":
                mask = oos_df[c.feature].astype(bool)
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
