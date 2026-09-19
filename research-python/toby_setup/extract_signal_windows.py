"""Stufe 4 des Toby-Setup-Phasen-Projekts: Signal-Zeitfenster-Extraktion.

Fuer jeden 15m-Zeitpunkt (= jedes Setup-Signal, unabhaengig von Richtung/
Hebel -- die Signalzustaende VOR dem Entry sind fuer LONG und SHORT sowie
alle 3 Hebel identisch, nur der Outcome unterscheidet sich) wird je Signal
x Zeitfenster ausgewertet, ob das Signal in diesem Fenster aufgetreten ist.

Zeitfenster (Nutzer-Vorgabe, urspruengliche Formulierung: "signale davor:
bis 4h, bis 1h, bis 15m und 15m schon im trade laufend"), als KUMULATIVE
Fenster gelesen, alle endend an der Signal-Kerze S (deren Close = Entry-
Zeitpunkt E, identische Konvention wie tiered_mfe_engine.py):
- w_15m: nur die Signal-Kerze S selbst (die letzte VOR dem Entry
  geschlossene 15m-Kerze).
- w_1h: die letzten 4 15m-Kerzen bis und mit S (1h vor Entry).
- w_4h: die letzten 16 15m-Kerzen bis und mit S (4h vor Entry).
- w_trade: die Entry-Kerze E selbst (laufender 15m-Trade).

GUSS (1H-nativ) wird zuerst point-in-time-sicher auf das 15m-Raster
projiziert (nur auf der EINEN 15m-Kerze pro Stunde, deren Schlusszeit mit
der 1H-Bestaetigung zusammenfaellt, sonst False) -- danach identische
Rolling-Window-Logik wie fuer die 15m-nativen Signale, keine gesonderte
Behandlung noetig.

Ausgabe: output/signal_windows.csv, eine Zeile pro 15m-Zeitpunkt (141'667),
Spalten signal_time/entry_time/phase + 13 Signale x 4 Fenster = 52
boolesche Spalten.
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

signals_15m = pd.read_csv("output/signals_15m.csv")
signals_15m["time"] = pd.to_datetime(signals_15m["time"], utc=True)
signals_15m = signals_15m.set_index("time").sort_index()
signal_cols_15m = list(signals_15m.columns)

signals_1h = pd.read_csv("output/signals_1h.csv")
signals_1h["time"] = pd.to_datetime(signals_1h["time"], utc=True)
signals_1h = signals_1h.set_index("time").sort_index()

# GUSS auf das 15m-Raster projizieren: nur auf der 15m-Kerze, deren
# Schlusszeit (open_time+15m) mit der 1H-Bestaetigungszeit (open_time+1h)
# der jeweiligen Stunde zusammenfaellt -- sonst False (nicht bekannt).
guss_confirm = signals_1h["guss_signal"].copy()
guss_confirm.index = guss_confirm.index + pd.Timedelta(hours=1)
guss_close_time = signals_15m.index + pd.Timedelta(minutes=15)
guss_on_15m = guss_confirm.reindex(guss_close_time).fillna(False).to_numpy()
signals_15m["guss_signal"] = guss_on_15m
signal_cols = signal_cols_15m + ["guss_signal"]

print(f"Signale geladen ({time.time()-t0:.1f}s): {len(signal_cols)} Signale, {len(signals_15m)} 15m-Bars")

# Rolling "irgendwann im Fenster aufgetreten" -- Fenster enden jeweils an
# der aktuellen Bar (inklusive), min_periods=1 damit die ersten Bars des
# Datensatzes ein (kleineres, aber echtes) Fenster statt NaN bekommen.
sig_bool = signals_15m[signal_cols].astype(bool)
w_15m = sig_bool  # Fenster = genau 1 Bar = die Bar selbst
w_1h = sig_bool.rolling(window=4, min_periods=1).max().astype(bool)
w_4h = sig_bool.rolling(window=16, min_periods=1).max().astype(bool)

w_15m.columns = [f"{c}__w15m" for c in signal_cols]
w_1h.columns = [f"{c}__w1h" for c in signal_cols]
w_4h.columns = [f"{c}__w4h" for c in signal_cols]

# w_trade: Rohwert an der ENTRY-Kerze (Signal-Kerze + 15m) -- per Shift(-1),
# da Entry = naechste Kerze (identische Konvention wie ueberall im Projekt).
w_trade = sig_bool.shift(-1)
w_trade.columns = [f"{c}__wtrade" for c in signal_cols]

result = pd.concat([w_15m, w_1h, w_4h, w_trade], axis=1)
result.insert(0, "signal_time", signals_15m.index)
result.insert(1, "entry_time", signals_15m.index + pd.Timedelta(minutes=15))
result = result.iloc[:-1]  # letzte Zeile hat keine Entry-Kerze (kein n+1. Bar)

# Phase per point-in-time-Join anhaengen (wie join_phase_to_setups.py).
phase_df = pd.read_csv("output/phase_segmentation_1h.csv")
phase_df["time"] = pd.to_datetime(phase_df["time"], utc=True)
phase_df = phase_df.set_index("time").sort_index()
assert result["entry_time"].is_monotonic_increasing
joined_phase = confirmed_asof_join(result["entry_time"], phase_df, "1h", ["phase"]).reset_index(drop=True)
result = result.reset_index(drop=True)
result.insert(2, "phase", joined_phase["phase"])

result.to_csv("output/signal_windows.csv", index=False)
n_no_phase = result["phase"].isna().sum()
print(f"Fertig ({time.time()-t0:.1f}s): {len(result)} Zeilen, {result.shape[1]} Spalten, "
      f"{n_no_phase} ohne zuordenbare Phase. -> output/signal_windows.csv")
