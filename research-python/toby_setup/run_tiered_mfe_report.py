"""Zaehlungslauf (Stufe 1 des Toby-Setup-Phasen-Projekts, siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md): fuer jede Kombination aus
Richtung (LONG/SHORT) x Hebel (20x/25x/30x) wird jede 15m-Kerze als
hypothetischer Entry simuliert (tiered_mfe_engine.run_tiered_setup, Fenster
192 Bars = 48h) und die Verteilung ueber die 7 Ergebnis-Klassen ausgezaehlt:
SL, TIMEOUT_NO_TIER, BREAK_EVEN, STANDARD_4, STANDARD_3, STANDARD_2,
STANDARD_1, STANDARD_1_EXTENDED.

Reiner Zaehl-/Uebersichtslauf -- KEINE Signal-/Phasen-Analyse, das ist der
naechste Schritt nach Rueckmeldung dieser Zahlen an den Nutzer.
"""
import time

import pandas as pd

from tiered_mfe_engine import events_to_dataframe, run_tiered_setup

LEVERAGES = [20.0, 25.0, 30.0]
DIRECTIONS = ["LONG", "SHORT"]
VERTICAL_BARS = 192

OUTCOME_ORDER = [
    "SL", "TIMEOUT_NO_TIER", "BREAK_EVEN", "STANDARD_4", "STANDARD_3",
    "STANDARD_2", "STANDARD_1", "STANDARD_1_EXTENDED",
]

df = pd.read_csv("data/BTCUSDT_15m_full.csv")
df["time"] = pd.to_datetime(df["time"], utc=True, format="mixed")
df = df.set_index("time").sort_index()
print(f"Datenbasis: {df.index[0]} bis {df.index[-1]}, {len(df)} Kerzen\n")

rows = []
for leverage in LEVERAGES:
    for direction in DIRECTIONS:
        t0 = time.time()
        events = run_tiered_setup(df, direction, leverage, vertical_bars=VERTICAL_BARS)
        edf = events_to_dataframe(events)
        edf.to_csv(f"output/tiered_mfe_{direction.lower()}_{int(leverage)}x.csv", index=False)
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
summary.to_csv("output/tiered_mfe_summary.csv", index=False)
print("Fertig. Events in output/tiered_mfe_{direction}_{leverage}x.csv, Uebersicht in output/tiered_mfe_summary.csv")
