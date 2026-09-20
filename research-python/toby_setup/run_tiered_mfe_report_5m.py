"""5m-Variante von run_tiered_mfe_report.py (Stufe 1, siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md, Abschnitt "Pivot auf 5m"):
identische Methodik, aber Setup-Basis = jede 5m-Kerze statt jede 15m-Kerze
(Nutzer-Entscheid 2026-09-20: 5m passt naeher an sein reales Entry-
Verhalten). VERTICAL_BARS auf 576 skaliert (48h = 576 Bars @5m statt 192
Bars @15m, identisches 48h-Zeitfenster).
"""
import time

import pandas as pd

from tiered_mfe_engine import events_to_dataframe, run_tiered_setup

LEVERAGES = [20.0, 25.0, 30.0]
DIRECTIONS = ["LONG", "SHORT"]
VERTICAL_BARS = 576  # 48h @ 5m (= 192 Bars @ 15m im 15m-Lauf)

OUTCOME_ORDER = [
    "SL", "TIMEOUT_NO_TIER", "BREAK_EVEN", "STANDARD_4", "STANDARD_3",
    "STANDARD_2", "STANDARD_1", "STANDARD_1_EXTENDED",
]

df = pd.read_csv("data/BTCUSDT_5m_full_with_volume.csv")
df["time"] = pd.to_datetime(df["time"], utc=True, format="mixed")
df = df.set_index("time").sort_index()
print(f"Datenbasis: {df.index[0]} bis {df.index[-1]}, {len(df)} Kerzen\n")

rows = []
for leverage in LEVERAGES:
    for direction in DIRECTIONS:
        t0 = time.time()
        events = run_tiered_setup(df, direction, leverage, vertical_bars=VERTICAL_BARS)
        edf = events_to_dataframe(events)
        edf.to_csv(f"output/tiered_mfe_{direction.lower()}_{int(leverage)}x_5m.csv", index=False)
        counts = edf["outcome"].value_counts().reindex(OUTCOME_ORDER, fill_value=0)
        pct = (counts / len(edf) * 100).round(2)
        print(f"--- {direction} {int(leverage)}x ({time.time()-t0:.1f}s, n={len(edf)}) ---")
        for outcome in OUTCOME_ORDER:
            print(f"  {outcome:<22} n={counts[outcome]:>7}  ({pct[outcome]:>5.2f}%)")
        print()
        for outcome in OUTCOME_ORDER:
            rows.append({
                "direction": direction, "leverage": leverage, "outcome": outcome,
                "n": int(counts[outcome]), "pct": float(pct[outcome]),
            })

summary = pd.DataFrame(rows)
summary.to_csv("output/tiered_mfe_summary_5m.csv", index=False)
print("Fertig. Events in output/tiered_mfe_{direction}_{leverage}x_5m.csv, Uebersicht in output/tiered_mfe_summary_5m.csv")
