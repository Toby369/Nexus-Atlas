"""Manuelle Validierung von signal_stats.py an synthetischen Daten, bevor
der volle Testlauf gegen die echten Setup-Daten startet (gleiche
Konvention wie validate_against_swing_setup.py / validate_tiered_engine.py
in diesem Projekt)."""
import numpy as np
import pandas as pd

from signal_stats import MIN_N, evaluate_cell, split_train_val_oos

rng = np.random.default_rng(42)
n = 5000

# Test 1: starker, klar erkennbarer Effekt -- Signal erhoeht sowohl TP20+-
# Quote als auch mittleres MFE deutlich.
indicator = pd.Series(rng.random(n) < 0.3)
noise_bin = rng.random(n)
reached_tp20 = (noise_bin < np.where(indicator, 0.55, 0.30)).astype(bool)
final_mfe = rng.normal(np.where(indicator, 5.0, 0.0), 10.0, n)
sub = pd.DataFrame({"reached_tp20": reached_tp20, "final_mfe_margin_pct": final_mfe})
result = evaluate_cell(sub, indicator, "long", "AUFWAERTS", "w1h", "single", "test_signal")
assert result.status == "OK", result
assert result.p_value_binary < 0.01, result.p_value_binary
assert result.p_value_continuous < 0.01, result.p_value_continuous
assert result.rate_with > result.rate_without
print("Test1 starker Effekt erkannt: OK", result.p_value_binary, result.p_value_continuous)

# Test 2: kein Effekt -- Indikator ist reines Rauschen, unabhaengig vom Outcome.
# Eigener Seed + groesseres n, damit der Test nicht durch die ueblichen ~5%
# falsch-positiven Ausreisser eines einzelnen Zufalls-Ziehung flackert.
rng2 = np.random.default_rng(123)
n2 = 20000
indicator2 = pd.Series(rng2.random(n2) < 0.3)
reached_tp20_2 = (rng2.random(n2) < 0.30).astype(bool)
final_mfe_2 = rng2.normal(0.0, 10.0, n2)
sub2 = pd.DataFrame({"reached_tp20": reached_tp20_2, "final_mfe_margin_pct": final_mfe_2})
result2 = evaluate_cell(sub2, indicator2, "long", "AUFWAERTS", "w1h", "single", "test_signal_noeffect")
assert result2.status == "OK"
assert result2.p_value_binary > 0.05, result2.p_value_binary
assert result2.p_value_continuous > 0.05, result2.p_value_continuous
print("Test2 kein Effekt korrekt nicht signifikant: OK", result2.p_value_binary, result2.p_value_continuous)

# Test 3: zu wenig Beobachtungen mit Signal -> INSUFFICIENT_DATA.
indicator3 = pd.Series([True] * (MIN_N - 1) + [False] * (n - (MIN_N - 1)))
sub3 = pd.DataFrame({
    "reached_tp20": rng.random(n) < 0.3, "final_mfe_margin_pct": rng.normal(0, 10, n),
})
result3 = evaluate_cell(sub3, indicator3, "long", "AUFWAERTS", "w1h", "single", "test_rare")
assert result3.status == "INSUFFICIENT_DATA"
print("Test3 INSUFFICIENT_DATA korrekt ausgeloest: OK")

# Test 4: split_train_val_oos -- Embargo entfernt exakt die letzten
# `embargo_bars` Zeilen vor der 80%-Grenze, OOS bleibt unveraendert.
idx = pd.date_range("2022-01-01", periods=1000, freq="15min", tz="UTC")
df4 = pd.DataFrame({"entry_time": idx, "value": range(1000)})
train, oos = split_train_val_oos(df4, oos_fraction=0.2, embargo_bars=192)
split_idx = int(round(1000 * 0.8))
assert len(oos) == 1000 - split_idx
assert len(train) == split_idx - 192
assert train["entry_time"].max() < oos["entry_time"].min()
assert (oos["entry_time"].min() - train["entry_time"].max()) >= pd.Timedelta(minutes=15) * 192
print("Test4 TRAIN_VAL/OOS-Split + Embargo korrekt: OK")

print("\nAlle 4 Tests bestanden.")
