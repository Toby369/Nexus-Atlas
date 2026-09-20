"""5m-Variante von run_stage_b_oos.py: OOS-Bestaetigung der BH-FDR-
Ueberlebenden aus run_stage_b_5m.py, unveraendertes Nachrechnen auf dem
eingefrorenen OOS-Anteil (keine Nach-Optimierung, keine neue Zellauswahl)."""
import pandas as pd

from signal_stats import evaluate_cell, split_train_val_oos

VERTICAL_BARS = 576  # 48h @ 5m
BLOCK_LENGTH = max(10, 2 * VERTICAL_BARS)  # = 1152
EMBARGO_BARS = VERTICAL_BARS

survivors = pd.read_csv("output/stage_b_train_val_survivors_5m.csv")
survivors = survivors[survivors["window"] != "wtrade"]
print(f"{len(survivors)} TRAIN_VAL-Ueberlebende werden auf OOS nachgerechnet.\n")

oos_results = []
data_cache = {}
for direction in survivors["direction"].unique():
    df = pd.read_csv(f"output/signals_with_outcomes_{direction}_20x_5m.csv")
    df["entry_time"] = pd.to_datetime(df["entry_time"], utc=True)
    df = df.sort_values("entry_time").reset_index(drop=True)
    _, oos = split_train_val_oos(df, oos_fraction=0.20, embargo_bars=EMBARGO_BARS)
    data_cache[direction] = oos

for _, row in survivors.iterrows():
    oos = data_cache[row["direction"]]
    sub = oos[oos["phase"] == row["phase"]]
    if row["kind"] == "single":
        indicator = sub[f"{row['signal']}__{row['window']}"].astype(bool)
    else:
        a, b = row["signal"].split("+")
        indicator = sub[f"{a}__{row['window']}"].astype(bool) & sub[f"{b}__{row['window']}"].astype(bool)
    result = evaluate_cell(sub, indicator, row["direction"], row["phase"], row["window"], row["kind"], row["signal"], block_length=BLOCK_LENGTH)
    oos_results.append(result)

oos_df = pd.DataFrame([r.__dict__ for r in oos_results])
oos_df["train_val_bh_significant_continuous"] = survivors["bh_significant_continuous"].to_numpy()
oos_df["oos_reproduces_direction"] = (
    (oos_df["mean_mfe_with"] > oos_df["mean_mfe_without"])
    == (survivors["mean_mfe_with"] > survivors["mean_mfe_without"]).to_numpy()
)
oos_df["oos_p_below_005"] = oos_df["p_value_continuous"] < 0.05
oos_df.to_csv("output/stage_b_oos_confirmation_5m.csv", index=False)

print(oos_df[["direction", "phase", "window", "kind", "signal", "n", "mean_mfe_with", "mean_mfe_without",
              "p_value_continuous", "oos_reproduces_direction", "oos_p_below_005"]].to_string(index=False))

n_reproduced = (oos_df["oos_reproduces_direction"] & oos_df["oos_p_below_005"]).sum()
print(f"\n{n_reproduced} von {len(oos_df)} reproduzieren Richtung UND p<0.05 auf OOS (unkorrigiert, da nur noch {len(oos_df)} Zellen).")
