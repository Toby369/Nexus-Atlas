"""Stufe 3 des Toby-Setup-Phasen-Projekts (siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md): verknuepft die 1h-
Phasenreihe (Stufe 2, output/phase_segmentation_1h.csv) mit den 15m-Setup-
Events (Stufe 1, output/tiered_mfe_{direction}_{leverage}x.csv) --
look-ahead-sicher per `confirmed_asof_join` aus
`wave_anchor_research/mtf_join.py` (wiederverwendet, nicht neu
implementiert -- bereits fuer genau diesen Zweck gebaut und getestet).

Fuer jeden Setup-Entry wird die Phase der zuletzt BESTAETIGTEN 1h-Kerze
zum Entry-Zeitpunkt zugeordnet (Entry-Zeitpunkt = Close der 15m-Signal-Kerze,
identische Konvention wie im Wave-Anchor-Projekt: `entry_time` einer
15m-Kerze i ist zugleich deren eigener Close-Zeitpunkt, siehe
tiered_mfe_engine.py). Vor der ersten bestaetigten 1h-Kerze (erste volle
Stunde des Datensatzes): keine Phase zuordenbar (NaN, kein kuenstliches
Auffuellen).

Reiner Verknuepfungs-/Zaehllauf (Setups pro Phase, Tier-Verteilung pro
Phase) -- die Signal-Zeitfenster-Analyse (welche Nexus-Signale wann vor
Entry) ist der naechste Schritt danach.
"""
import sys
import time
from pathlib import Path

import pandas as pd

TOBY_SETUP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOBY_SETUP_DIR.parents[0] / "wave_anchor_research"))  # fuer mtf_join.py

from mtf_join import confirmed_asof_join  # noqa: E402

LEVERAGES = [20.0, 25.0, 30.0]
DIRECTIONS = ["LONG", "SHORT"]
PHASE_COLS = ["phase", "regime", "swing_structure"]
OUTCOME_ORDER = [
    "SL", "TIMEOUT_NO_TIER", "BREAK_EVEN", "STANDARD_4", "STANDARD_3",
    "STANDARD_2", "STANDARD_1_EXTENDED",
]

phase_df = pd.read_csv("output/phase_segmentation_1h.csv")
phase_df["time"] = pd.to_datetime(phase_df["time"], utc=True)
phase_df = phase_df.set_index("time").sort_index()
print(f"Phasenreihe: {phase_df.index[0]} bis {phase_df.index[-1]}, {len(phase_df)} 1h-Bars\n")

all_joined = {}
for leverage in LEVERAGES:
    for direction in DIRECTIONS:
        t0 = time.time()
        key = f"{direction.lower()}_{int(leverage)}x"
        events = pd.read_csv(f"output/tiered_mfe_{key}.csv")
        events["entry_time"] = pd.to_datetime(events["entry_time"], utc=True)
        events = events.sort_values("entry_time").reset_index(drop=True)

        # confirmed_asof_join sortiert intern nach close_time -- entry_time ist
        # hier bereits chronologisch aufsteigend (siehe tiered_mfe_engine.py),
        # daher ist die interne Sortierung ein No-Op und die Zeilen bleiben
        # 1:1 positionsgleich zu `events`. Explizit geprueft statt angenommen.
        assert events["entry_time"].is_monotonic_increasing
        joined_phase = confirmed_asof_join(events["entry_time"], phase_df, "1h", PHASE_COLS).reset_index(drop=True)
        combined = pd.concat([events, joined_phase], axis=1)
        combined.to_csv(f"output/tiered_mfe_with_phase_{key}.csv", index=False)
        all_joined[key] = combined
        n_no_phase = combined["phase"].isna().sum()
        print(f"{key}: {time.time()-t0:.1f}s, n={len(combined)}, ohne zuordenbare Phase (vor erster 1h-Kerze): {n_no_phase}")

print("\n--- Setups pro Phase (ueber alle 6 Kombinationen gepoolt, zur Orientierung) ---")
pooled = pd.concat(all_joined.values(), ignore_index=True)
phase_counts = pooled["phase"].value_counts(dropna=False)
for phase, n in phase_counts.items():
    label = phase if pd.notna(phase) else "(keine Phase, vor erster 1h-Kerze)"
    print(f"  {label:<12} n={n:>7}  ({n/len(pooled)*100:5.2f}%)")

print("\n--- Tier-Verteilung je Phase, gepoolt ueber alle 6 Hebel/Richtungs-Kombinationen ---")
pooled_valid = pooled.dropna(subset=["phase"])
cross = pd.crosstab(pooled_valid["phase"], pooled_valid["outcome"], normalize="index") * 100
cross = cross.reindex(columns=OUTCOME_ORDER, fill_value=0.0).reindex(["AUFWAERTS", "ABWAERTS", "SEITWAERTS"])
n_per_phase = pooled_valid.groupby("phase").size().reindex(["AUFWAERTS", "ABWAERTS", "SEITWAERTS"])
cross.insert(0, "n_setups", n_per_phase)
print(cross.round(2))

cross_full = pd.crosstab(pooled_valid["phase"], pooled_valid["outcome"], normalize="index") * 100
cross_full.reindex(columns=OUTCOME_ORDER, fill_value=0.0).reindex(["AUFWAERTS", "ABWAERTS", "SEITWAERTS"]).to_csv(
    "output/setup_tier_distribution_by_phase.csv"
)
print("\nFertig. Verknuepfte Events in output/tiered_mfe_with_phase_*.csv, Uebersicht in output/setup_tier_distribution_by_phase.csv")
