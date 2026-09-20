"""Manuelle Validierung von signal_stats.py::evaluate_continuous_predictor()
an synthetischen Daten, bevor der Konfluenz-Score-Test gegen die echten
5m-Setup-Daten laeuft (gleiche Konvention wie validate_signal_stats.py)."""
import numpy as np
import pandas as pd

from signal_stats import MIN_N, evaluate_continuous_predictor

# Test 1: starker, klar erkennbarer Effekt -- hoeherer Score erhoeht sowohl
# TP20+-Quote als auch mittleres MFE deutlich (linear im Score).
rng = np.random.default_rng(7)
n = 5000
score = pd.Series(rng.integers(0, 8, n))
p_tp = np.clip(0.2 + 0.05 * score, 0, 0.9)
reached = (rng.random(n) < p_tp).astype(bool)
mfe = rng.normal(2.0 * score, 10.0, n)
sub = pd.DataFrame({"reached_tp20": reached, "final_mfe_margin_pct": mfe})
result = evaluate_continuous_predictor(sub, score, "long", "TEST", "w1h")
assert result.status == "OK", result
assert result.p_value_binary < 0.01, result.p_value_binary
assert result.p_value_continuous < 0.01, result.p_value_continuous
assert result.coef_binary > 0
assert result.coef_continuous > 0
print("Test1 starker Effekt erkannt: OK", result.p_value_binary, result.p_value_continuous)

# Test 2: kein Effekt -- Score ist reines Rauschen, unabhaengig vom Outcome.
# Eigener Seed + groesseres n (wie validate_signal_stats.py Test2), damit
# der Test nicht durch die ueblichen ~5% falsch-positiven Ausreisser einer
# einzelnen Zufalls-Ziehung flackert.
rng2 = np.random.default_rng(123)
n2 = 20000
score2 = pd.Series(rng2.integers(0, 8, n2))
reached2 = (rng2.random(n2) < 0.3).astype(bool)
mfe2 = rng2.normal(0.0, 10.0, n2)
sub2 = pd.DataFrame({"reached_tp20": reached2, "final_mfe_margin_pct": mfe2})
result2 = evaluate_continuous_predictor(sub2, score2, "long", "TEST", "w1h")
assert result2.status == "OK"
assert result2.p_value_binary > 0.05, result2.p_value_binary
assert result2.p_value_continuous > 0.05, result2.p_value_continuous
print("Test2 kein Effekt korrekt nicht signifikant: OK", result2.p_value_binary, result2.p_value_continuous)

# Test 3: zu wenig Beobachtungen in der High-Gruppe -> INSUFFICIENT_DATA.
rng3 = np.random.default_rng(5)
n3 = 5000
score3 = pd.Series([0] * (n3 - 10) + [5] * 10)
sub3 = pd.DataFrame({
    "reached_tp20": rng3.random(n3) < 0.3, "final_mfe_margin_pct": rng3.normal(0, 10, n3),
})
result3 = evaluate_continuous_predictor(sub3, score3, "long", "TEST", "w1h")
assert result3.status == "INSUFFICIENT_DATA"
print("Test3 INSUFFICIENT_DATA korrekt ausgeloest: OK")

print("\nAlle 3 Tests bestanden.")
