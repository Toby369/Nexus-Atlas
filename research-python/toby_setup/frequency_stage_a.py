"""Stufe A (Haeufigkeit): reine Zaehlung, kein Signifikanztest, siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md Abschnitt "Testmethode
Paar-/Dreier-Haeufigkeit". Dient als Vorfilter fuer die Paar-Stufe
(Nutzer-Vorgabe 19.09.2026: hierarchisch vorfiltern, NACH Haeufigkeit,
NICHT nach Outcome -- sonst Cherry-Picking) und als Grundlage fuer die
gruppenuebergreifende Paar-Prioritaet (Nutzer-Vorgabe: Paare
unterschiedlicher Signalgruppen sind das eigentliche Interesse).

Signalgruppen (siehe Definitions-Dokument, unabhaengig von der Phasen-
Konstruktion, Zirkularitaets-Ausschluss bereits in
extract_signal_windows.py beruecksichtigt):
- Momentum: momentum_divergence
- Orderflow: cvd_bullish, cvd_bearish, vwap_above, vwap_below
- Entry-Muster: doji, hammer, hanging_man, bullish_engulfing,
  bearish_engulfing, morning_star, evening_star, guss_signal
"""
import itertools

import pandas as pd

SIGNAL_GROUPS = {
    "Momentum": ["momentum_divergence"],
    "Orderflow": ["cvd_bullish", "cvd_bearish", "vwap_above", "vwap_below"],
    "Entry-Muster": [
        "doji", "hammer", "hanging_man", "bullish_engulfing", "bearish_engulfing",
        "morning_star", "evening_star", "guss_signal",
    ],
}
ALL_SIGNALS = [s for group in SIGNAL_GROUPS.values() for s in group]
SIGNAL_TO_GROUP = {s: g for g, sigs in SIGNAL_GROUPS.items() for s in sigs}
WINDOWS = ["w15m", "w1h", "w4h", "wtrade"]
PHASES = ["AUFWAERTS", "ABWAERTS", "SEITWAERTS"]

df = pd.read_csv("output/signal_windows.csv")
df = df.dropna(subset=["phase"])
print(f"Datenbasis: {len(df)} Zeitpunkte mit zuordenbarer Phase\n")

# --- Einzelsignal-Haeufigkeit je Phase x Fenster ------------------------
rows = []
for window in WINDOWS:
    for signal in ALL_SIGNALS:
        col = f"{signal}__{window}"
        for phase in PHASES:
            sub = df[df["phase"] == phase]
            n = int(sub[col].sum())
            total = len(sub)
            rows.append(
                {"window": window, "signal": signal, "group": SIGNAL_TO_GROUP[signal],
                 "phase": phase, "n": n, "total": total, "pct": round(n / total * 100, 2)}
            )
        n_all = int(df[col].sum())
        rows.append(
            {"window": window, "signal": signal, "group": SIGNAL_TO_GROUP[signal],
             "phase": "GESAMT", "n": n_all, "total": len(df), "pct": round(n_all / len(df) * 100, 2)}
        )

freq = pd.DataFrame(rows)
freq.to_csv("output/frequency_stage_a_singles.csv", index=False)

print("--- Einzelsignal-Haeufigkeit (Fenster w1h, alle Phasen) ---")
print(freq[freq["window"] == "w1h"].pivot(index="signal", columns="phase", values="pct")[PHASES + ["GESAMT"]].round(2))

# --- Vorfilter fuer Paar-Stufe: Mindesthaeufigkeit je Phase x Fenster ---
MIN_N_PER_PHASE = 500  # siehe Bericht fuer Herleitung aus der realen Verteilung
qualifying = freq[(freq["phase"] != "GESAMT") & (freq["n"] >= MIN_N_PER_PHASE)]
qualified_pairs_per_cell = qualifying.groupby(["window", "phase"])["signal"].apply(list)
print(f"\n--- Signale, die den Mindesthaeufigkeits-Vorfilter (n>={MIN_N_PER_PHASE}) je Phase x Fenster erreichen ---")
print(qualified_pairs_per_cell)

# --- Gruppenuebergreifende Kandidaten-Paare (nur aus qualifizierten Signalen) ---
pair_candidates = []
for (window, phase), signals in qualified_pairs_per_cell.items():
    for a, b in itertools.combinations(sorted(signals), 2):
        if SIGNAL_TO_GROUP[a] != SIGNAL_TO_GROUP[b]:
            pair_candidates.append({"window": window, "phase": phase, "signal_a": a, "signal_b": b,
                                     "group_a": SIGNAL_TO_GROUP[a], "group_b": SIGNAL_TO_GROUP[b]})
pair_candidates_df = pd.DataFrame(pair_candidates).drop_duplicates()
pair_candidates_df.to_csv("output/frequency_stage_a_pair_candidates.csv", index=False)
print(f"\nGruppenuebergreifende Paar-Kandidaten (aus qualifizierten Einzelsignalen): {len(pair_candidates_df)}")
print(pair_candidates_df.groupby(["group_a", "group_b"]).size())
