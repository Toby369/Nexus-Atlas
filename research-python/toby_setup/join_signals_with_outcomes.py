"""Stufe B Vorbereitung: verknuepft signal_windows.csv mit den Setup-
Outcomes fuer die statistische Testung (Frage B). Nur 20x Hebel (Stufe 1
zeigte: Hebel veraendert nur die absolute Schwellenbreite, nicht die
relative Verteilung -- identische Ergebnisse fuer 25x/30x waeren
redundante Rechenzeit ohne neue Information, siehe TOBY-SETUP-PHASEN-
DEFINITION.md Stufe 1). LONG und SHORT bleiben getrennt (ein Signal kann
fuer die beiden Richtungen gegensaetzliche Effekte haben).

Outcome-Definitionen:
- `reached_tp20`: bool, outcome in {STANDARD_4, STANDARD_3, STANDARD_2,
  STANDARD_1_EXTENDED} (mind. Standard 4 erreicht).
- `final_mfe_margin_pct`: float, wie in tiered_mfe_engine.py (bereits
  vorhanden je Event).
"""
import pandas as pd

TP20_OUTCOMES = {"STANDARD_4", "STANDARD_3", "STANDARD_2", "STANDARD_1_EXTENDED"}

signal_windows = pd.read_csv("output/signal_windows.csv")
signal_windows["entry_time"] = pd.to_datetime(signal_windows["entry_time"], utc=True)
signal_cols = [c for c in signal_windows.columns if "__w" in c]

for direction in ["long", "short"]:
    outcomes = pd.read_csv(f"output/tiered_mfe_{direction}_20x.csv")
    outcomes["entry_time"] = pd.to_datetime(outcomes["entry_time"], utc=True)
    outcomes["reached_tp20"] = outcomes["outcome"].isin(TP20_OUTCOMES)

    merged = signal_windows.merge(
        outcomes[["entry_time", "outcome", "reached_tp20", "final_mfe_margin_pct"]],
        on="entry_time", how="inner",
    )
    merged = merged.dropna(subset=["phase"])
    merged.to_csv(f"output/signals_with_outcomes_{direction}_20x.csv", index=False)
    print(f"{direction}: {len(merged)} Zeilen, TP20+-Quote={merged['reached_tp20'].mean()*100:.2f}%")

print("\nFertig. output/signals_with_outcomes_{long,short}_20x.csv")
