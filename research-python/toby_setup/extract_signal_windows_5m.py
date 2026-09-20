"""5m-Variante von extract_signal_windows.py (Stufe 4): identische
Fensterdefinitionen (Nutzer-Vorgabe "bis 4h, bis 1h, bis 15m und 15m schon
im trade laufend"), aber auf das 5m-Setup-Raster projiziert -- die
Fenstergroessen in BARS skalieren mit dem 3x feineren Grid (5m statt 15m):
- w_15m: letzte 3 5m-Kerzen bis und mit der Signal-Kerze S (statt 1 Kerze @15m).
- w_1h: letzte 12 5m-Kerzen (statt 4 @15m).
- w_4h: letzte 48 5m-Kerzen (statt 16 @15m).
- w_trade: die Entry-Kerze E selbst (unveraendertes Konzept).

GUSS-Projektion auf das 5m-Raster: identische Logik wie im 15m-Lauf (nur
auf der EINEN 5m-Kerze pro Stunde, deren Schlusszeit mit der 1H-
Bestaetigung zusammenfaellt), lediglich der Timedelta-Offset auf 5 Minuten
(Bar-Dauer) statt 15 Minuten angepasst.
"""
import sys
import time
from pathlib import Path

import pandas as pd

TOBY_SETUP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOBY_SETUP_DIR.parents[0]))
sys.path.insert(0, str(TOBY_SETUP_DIR.parents[0] / "wave_anchor_research"))

from mtf_join import confirmed_asof_join  # noqa: E402

t0 = time.time()

signals_5m = pd.read_csv("output/signals_5m.csv")
signals_5m["time"] = pd.to_datetime(signals_5m["time"], utc=True)
signals_5m = signals_5m.set_index("time").sort_index()
signal_cols_5m = list(signals_5m.columns)

signals_1h = pd.read_csv("output/signals_1h.csv")
signals_1h["time"] = pd.to_datetime(signals_1h["time"], utc=True)
signals_1h = signals_1h.set_index("time").sort_index()

# GUSS auf das 5m-Raster projizieren: nur auf der 5m-Kerze, deren
# Schlusszeit (open_time+5m) mit der 1H-Bestaetigungszeit (open_time+1h)
# der jeweiligen Stunde zusammenfaellt -- sonst False (nicht bekannt).
guss_confirm = signals_1h["guss_signal"].copy()
guss_confirm.index = guss_confirm.index + pd.Timedelta(hours=1)
guss_close_time = signals_5m.index + pd.Timedelta(minutes=5)
guss_on_5m = guss_confirm.reindex(guss_close_time).fillna(False).to_numpy()
signals_5m["guss_signal"] = guss_on_5m
signal_cols = signal_cols_5m + ["guss_signal"]

print(f"Signale geladen ({time.time()-t0:.1f}s): {len(signal_cols)} Signale, {len(signals_5m)} 5m-Bars")

# Rolling "irgendwann im Fenster aufgetreten" -- Fenster enden jeweils an
# der aktuellen Bar (inklusive), min_periods=1 damit die ersten Bars des
# Datensatzes ein (kleineres, aber echtes) Fenster statt NaN bekommen.
sig_bool = signals_5m[signal_cols].astype(bool)
w_15m = sig_bool.rolling(window=3, min_periods=1).max().astype(bool)
w_1h = sig_bool.rolling(window=12, min_periods=1).max().astype(bool)
w_4h = sig_bool.rolling(window=48, min_periods=1).max().astype(bool)

w_15m.columns = [f"{c}__w15m" for c in signal_cols]
w_1h.columns = [f"{c}__w1h" for c in signal_cols]
w_4h.columns = [f"{c}__w4h" for c in signal_cols]

# w_trade: Rohwert an der ENTRY-Kerze (Signal-Kerze + 5m) -- per Shift(-1),
# da Entry = naechste Kerze (identische Konvention wie ueberall im Projekt).
w_trade = sig_bool.shift(-1)
w_trade.columns = [f"{c}__wtrade" for c in signal_cols]

result = pd.concat([w_15m, w_1h, w_4h, w_trade], axis=1)
result.insert(0, "signal_time", signals_5m.index)
result.insert(1, "entry_time", signals_5m.index + pd.Timedelta(minutes=5))
result = result.iloc[:-1]  # letzte Zeile hat keine Entry-Kerze (kein n+1. Bar)

# Phase per point-in-time-Join anhaengen (wie join_phase_to_setups_5m.py).
phase_df = pd.read_csv("output/phase_segmentation_1h.csv")
phase_df["time"] = pd.to_datetime(phase_df["time"], utc=True)
phase_df = phase_df.set_index("time").sort_index()
assert result["entry_time"].is_monotonic_increasing
joined_phase = confirmed_asof_join(result["entry_time"], phase_df, "1h", ["phase"]).reset_index(drop=True)
result = result.reset_index(drop=True)
result.insert(2, "phase", joined_phase["phase"])

result.to_csv("output/signal_windows_5m.csv", index=False)
n_no_phase = result["phase"].isna().sum()
print(f"Fertig ({time.time()-t0:.1f}s): {len(result)} Zeilen, {result.shape[1]} Spalten, "
      f"{n_no_phase} ohne zuordenbare Phase. -> output/signal_windows_5m.csv")
