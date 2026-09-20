"""Konfluenz-Score-Test (5m-Basis) -- siehe compute_confluence_5m.py fuer
die Score-Konstruktion. Je Richtung x Phase x Fenster (2x3x3 = 18 Zellen)
EIN stetiger Regressionstest (HAC-Logit/OLS, `evaluate_continuous_predictor`)
statt der 1328 Einzelsignal-/Paar-Zellen aus run_stage_b_5m.py -- gepoolte
BH-FDR ueber nur 36 Tests (18 Zellen x 2 Ziel-Typen) statt 1988, deutlich
mehr Power pro Test. TRAIN_VAL/OOS-Split + Embargo identisch zu
run_stage_b_5m.py (576 Bars = 48h @5m)."""
import time

import pandas as pd
from statsmodels.stats.multitest import multipletests

from signal_stats import evaluate_continuous_predictor, split_train_val_oos

WINDOWS = ["w15m", "w1h", "w4h"]
PHASES = ["AUFWAERTS", "ABWAERTS", "SEITWAERTS"]
ALPHA = 0.05
VERTICAL_BARS = 576
BLOCK_LENGTH = max(10, 2 * VERTICAL_BARS)  # 1152
EMBARGO_BARS = VERTICAL_BARS

t0 = time.time()
all_results = []
oos_cache = {}

for direction in ["long", "short"]:
    outcomes = pd.read_csv(f"output/signals_with_outcomes_{direction}_20x_5m.csv")
    outcomes["entry_time"] = pd.to_datetime(outcomes["entry_time"], utc=True)

    confluence = pd.read_csv(f"output/confluence_{direction}_5m.csv")
    confluence["entry_time"] = pd.to_datetime(confluence["entry_time"], utc=True)

    score_cols = [f"confluence_score__{w}" for w in WINDOWS]
    df = outcomes.merge(confluence[["entry_time"] + score_cols], on="entry_time", how="inner")
    df = df.sort_values("entry_time").reset_index(drop=True)
    assert df["entry_time"].is_monotonic_increasing

    train_val, oos = split_train_val_oos(df, oos_fraction=0.20, embargo_bars=EMBARGO_BARS)
    oos_cache[direction] = oos
    print(f"{direction}: TRAIN_VAL n={len(train_val)}, OOS n={len(oos)}")

    for phase in PHASES:
        sub = train_val[train_val["phase"] == phase]
        for window in WINDOWS:
            score = sub[f"confluence_score__{window}"]
            result = evaluate_continuous_predictor(sub, score, direction, phase, window, block_length=BLOCK_LENGTH)
            all_results.append(result)

print(f"\n{len(all_results)} TRAIN_VAL-Zellen ausgewertet ({time.time()-t0:.1f}s). Wende BH-FDR an (ein Pool) ...")

results_df = pd.DataFrame([r.__dict__ for r in all_results])
results_df.to_csv("output/confluence_train_val_results_5m.csv", index=False)

ok = results_df[results_df["status"] == "OK"]
pooled_p = pd.concat([
    ok[["p_value_binary"]].rename(columns={"p_value_binary": "p"}).assign(outcome="binary", row_id=ok.index),
    ok[["p_value_continuous"]].rename(columns={"p_value_continuous": "p"}).assign(outcome="continuous", row_id=ok.index),
], ignore_index=True)
pooled_p = pooled_p.dropna(subset=["p"])

reject, adjusted, _, _ = multipletests(pooled_p["p"].to_numpy(), alpha=ALPHA, method="fdr_bh")
pooled_p["reject"] = reject
pooled_p["p_adj"] = adjusted

n_status = results_df["status"].value_counts()
print(f"Status-Verteilung: {dict(n_status)}")
print(f"Gepoolte Tests (beide Ziel-Typen zusammen): {len(pooled_p)}, davon BH-signifikant: {pooled_p['reject'].sum()}")

survivors_binary = set(pooled_p[(pooled_p["outcome"] == "binary") & pooled_p["reject"]]["row_id"])
survivors_continuous = set(pooled_p[(pooled_p["outcome"] == "continuous") & pooled_p["reject"]]["row_id"])
results_df["bh_significant_binary"] = results_df.index.isin(survivors_binary)
results_df["bh_significant_continuous"] = results_df.index.isin(survivors_continuous)
results_df["bh_significant_any"] = results_df["bh_significant_binary"] | results_df["bh_significant_continuous"]
results_df.to_csv("output/confluence_train_val_results_5m.csv", index=False)

print(results_df[["direction", "phase", "window", "n", "mean_score", "coef_continuous", "p_value_continuous",
                   "coef_binary", "p_value_binary", "rate_high", "rate_low", "mean_mfe_high", "mean_mfe_low",
                   "bh_significant_any"]].to_string(index=False))

survivors = results_df[results_df["bh_significant_any"]].copy()
survivors.to_csv("output/confluence_train_val_survivors_5m.csv", index=False)
print(f"\n{len(survivors)} Zellen ueberleben BH-FDR (TRAIN_VAL).")

# --- OOS-Bestaetigung, unveraendertes Nachrechnen -------------------------
if len(survivors) > 0:
    oos_results = []
    for _, row in survivors.iterrows():
        oos = oos_cache[row["direction"]]
        sub = oos[oos["phase"] == row["phase"]]
        score = sub[f"confluence_score__{row['window']}"]
        result = evaluate_continuous_predictor(sub, score, row["direction"], row["phase"], row["window"], block_length=BLOCK_LENGTH)
        oos_results.append(result)
    oos_df = pd.DataFrame([r.__dict__ for r in oos_results])
    oos_df["train_val_coef_continuous"] = survivors["coef_continuous"].to_numpy()
    oos_df["oos_reproduces_direction"] = (
        (oos_df["coef_continuous"] > 0) == (survivors["coef_continuous"] > 0).to_numpy()
    )
    oos_df["oos_p_below_005"] = oos_df["p_value_continuous"] < 0.05
    oos_df.to_csv("output/confluence_oos_confirmation_5m.csv", index=False)
    print("\n--- OOS-Bestaetigung ---")
    print(oos_df[["direction", "phase", "window", "n", "coef_continuous", "p_value_continuous",
                   "oos_reproduces_direction", "oos_p_below_005"]].to_string(index=False))
    n_reproduced = (oos_df["oos_reproduces_direction"] & oos_df["oos_p_below_005"]).sum()
    print(f"\n{n_reproduced} von {len(oos_df)} reproduzieren Richtung UND p<0.05 auf OOS.")
else:
    print("(keine Ueberlebenden -- keine OOS-Bestaetigung noetig)")
