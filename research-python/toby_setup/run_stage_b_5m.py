"""5m-Variante von run_stage_b.py: identische Methodik (Einzelsignale +
gruppenuebergreifende Paare, gepoolte BH-FDR ueber alle Zellen UND beide
Ziel-Typen, wtrade als kontaminiertes Fenster ausgeschlossen), aber auf der
5m-Setup-Basis. block_length auf 1152 skaliert (= max(10, 2*576), 576 Bars
= 48h @5m, identische Herleitungsregel wie im 15m-Lauf mit block_length=384
= max(10, 2*192))."""
import time

import pandas as pd
from statsmodels.stats.multitest import multipletests

from signal_stats import evaluate_cell, split_train_val_oos

SIGNAL_GROUPS = {
    "Momentum": ["momentum_divergence"],
    "Orderflow": ["cvd_bullish", "cvd_bearish", "vwap_above", "vwap_below"],
    "Entry-Muster": [
        "doji", "hammer", "hanging_man", "bullish_engulfing", "bearish_engulfing",
        "morning_star", "evening_star", "guss_signal",
    ],
}
ALL_SIGNALS = [s for sigs in SIGNAL_GROUPS.values() for s in sigs]
WINDOWS = ["w15m", "w1h", "w4h", "wtrade"]
PHASES = ["AUFWAERTS", "ABWAERTS", "SEITWAERTS"]
ALPHA = 0.05
VERTICAL_BARS = 576  # 48h @ 5m
BLOCK_LENGTH = max(10, 2 * VERTICAL_BARS)  # = 1152
EMBARGO_BARS = VERTICAL_BARS  # 48h Embargo, identische Begruendung wie 15m-Lauf

pair_candidates = pd.read_csv("output/frequency_stage_a_pair_candidates_5m.csv")

t0 = time.time()
all_results = []

for direction in ["long", "short"]:
    df = pd.read_csv(f"output/signals_with_outcomes_{direction}_20x_5m.csv")
    df["entry_time"] = pd.to_datetime(df["entry_time"], utc=True)
    df = df.sort_values("entry_time").reset_index(drop=True)
    train_val, oos = split_train_val_oos(df, oos_fraction=0.20, embargo_bars=EMBARGO_BARS)
    print(f"{direction}: TRAIN_VAL n={len(train_val)}, OOS n={len(oos)}")

    for phase in PHASES:
        sub = train_val[train_val["phase"] == phase]
        for window in WINDOWS:
            for signal in ALL_SIGNALS:
                col = f"{signal}__{window}"
                indicator = sub[col].astype(bool)
                result = evaluate_cell(sub, indicator, direction, phase, window, "single", signal, block_length=BLOCK_LENGTH)
                all_results.append(result)

            cell_pairs = pair_candidates[(pair_candidates["window"] == window) & (pair_candidates["phase"] == phase)]
            for _, row in cell_pairs.iterrows():
                col_a, col_b = f"{row['signal_a']}__{window}", f"{row['signal_b']}__{window}"
                indicator = sub[col_a].astype(bool) & sub[col_b].astype(bool)
                label = f"{row['signal_a']}+{row['signal_b']}"
                result = evaluate_cell(sub, indicator, direction, phase, window, "pair", label, block_length=BLOCK_LENGTH)
                all_results.append(result)

print(f"\n{len(all_results)} TRAIN_VAL-Zellen ausgewertet ({time.time()-t0:.1f}s). Wende BH-FDR an (ein Pool) ...")

results_df = pd.DataFrame([r.__dict__ for r in all_results])
results_df.to_csv("output/stage_b_train_val_results_5m.csv", index=False)

# WICHTIG: "wtrade" (Entry-Kerze selbst) wird NICHT in den BH-FDR-Pool
# aufgenommen -- identische Kontaminations-Begruendung wie im 15m-Lauf
# (run_stage_b.py): Signal und Outcome teilen Information aus derselben
# Entry-Kerze.
results_df.loc[results_df["window"] == "wtrade", "excluded_reason"] = (
    "wtrade: Signal und Outcome teilen Information aus derselben Entry-Kerze (Kontamination), nicht in BH-FDR-Pool"
)
pool_df = results_df[results_df["window"] != "wtrade"]

ok = pool_df[pool_df["status"] == "OK"]
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
results_df.to_csv("output/stage_b_train_val_results_5m.csv", index=False)

survivors = results_df[results_df["bh_significant_any"]].copy()
survivors.to_csv("output/stage_b_train_val_survivors_5m.csv", index=False)
print(f"\n{len(survivors)} Zellen ueberleben BH-FDR (TRAIN_VAL):")
if len(survivors) > 0:
    print(survivors[["direction", "phase", "window", "kind", "signal", "n", "rate_with", "rate_without",
                      "p_value_binary", "p_value_continuous", "bh_significant_binary", "bh_significant_continuous"]]
          .to_string(index=False))
else:
    print("(keine)")
