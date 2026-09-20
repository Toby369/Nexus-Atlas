"""5m-Variante von join_signals_with_outcomes.py: verknuepft
signal_windows_5m.csv mit den 5m-Setup-Outcomes (20x Hebel, gleiche
Begruendung wie im 15m-Lauf: Hebel aendert nur die absolute Schwellenbreite,
nicht die relative Verteilung)."""
import pandas as pd

TP20_OUTCOMES = {"STANDARD_4", "STANDARD_3", "STANDARD_2", "STANDARD_1_EXTENDED"}

signal_windows = pd.read_csv("output/signal_windows_5m.csv")
signal_windows["entry_time"] = pd.to_datetime(signal_windows["entry_time"], utc=True)
signal_cols = [c for c in signal_windows.columns if "__w" in c]

for direction in ["long", "short"]:
    outcomes = pd.read_csv(f"output/tiered_mfe_{direction}_20x_5m.csv")
    outcomes["entry_time"] = pd.to_datetime(outcomes["entry_time"], utc=True)
    outcomes["reached_tp20"] = outcomes["outcome"].isin(TP20_OUTCOMES)

    merged = signal_windows.merge(
        outcomes[["entry_time", "outcome", "reached_tp20", "final_mfe_margin_pct"]],
        on="entry_time", how="inner",
    )
    merged = merged.dropna(subset=["phase"])
    merged.to_csv(f"output/signals_with_outcomes_{direction}_20x_5m.csv", index=False)
    print(f"{direction}: {len(merged)} Zeilen, TP20+-Quote={merged['reached_tp20'].mean()*100:.2f}%")

print("\nFertig. output/signals_with_outcomes_{long,short}_20x_5m.csv")
