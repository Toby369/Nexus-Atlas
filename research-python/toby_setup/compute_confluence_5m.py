"""Konfluenz-Score fuer die 5m-Setup-Basis, siehe Diskussion "testen wir
auch falsch?" -- statt 13 Einzelsignale + Paare einzeln gegen ~95%+
irrelevante "kein Setup"-Zeilen zu testen (run_stage_b_5m.py), wird hier je
Richtung EIN Score gebildet: Anzahl der gleichzeitig aktiven, RICHTUNGS-
KONFORMEN Signale im Fenster (0..7). Zwei Korrekturen gegenueber dem
bisherigen Aufbau:

1. Richtungs-Filterung: `momentum_divergence` und `guss_signal` wurden
   bisher als EIN Flag identisch fuer LONG und SHORT getestet, obwohl beide
   Signale intern eine Richtung tragen (GUSS: Pullback in einem Auf- oder
   Abwaertstrend; Momentum-Divergenz: DI-Richtung widerspricht MACD-
   Histogramm-Vorzeichen in die eine oder andere Richtung). Hier werden
   beide in ihre bullische/baerische Haelfte aufgesplittet und nur die zur
   getesteten Richtung passende Haelfte fliesst in den Score ein.
   `doji` bleibt aussen vor (kein inhaerenter Richtungsbezug).
2. Score statt Einzel-/Paar-Indikator: BULLISH_SIGNALS (7 Signale) fuer
   LONG, BEARISH_SIGNALS (7 Signale) fuer SHORT -- Score = Summe der im
   Fenster aktiven Signale dieser Gruppe (0..7), separat je Fenster
   (w15m/w1h/w4h, gleiche Bar-Zahlen wie extract_signal_windows_5m.py).

GUSS-Richtung wird NICHT durch Aenderung von src/signals/guss.py gewonnen
(die Funktion ist bereits validiert/gegen die offizielle Beschreibung
abgeglichen) -- stattdessen wird die Richtung post-hoc aus dem bereits in
der Funktion verwendeten Kriterium rekonstruiert: an der feuernden Bar gilt
close>EMA50 <=> Aufwaertstrend-Pullback (bullisch), close<EMA50 <=>
Abwaertstrend-Pullback (baerisch) -- exakt das Kriterium aus
compute_guss_signal() selbst, hier nur zusaetzlich mitgefuehrt statt
verworfen.
"""
import sys
import time
from pathlib import Path

import pandas as pd

TOBY_SETUP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOBY_SETUP_DIR.parents[0]))
sys.path.insert(0, str(TOBY_SETUP_DIR.parents[0] / "wave_anchor_research"))

from mtf_join import confirmed_asof_join  # noqa: E402
from src.features.momentum import adx, macd  # noqa: E402
from src.signals._common import ema_series  # noqa: E402
from src.signals.candlestick_patterns import detect_candlestick_patterns  # noqa: E402
from src.signals.guss import DEFAULT_EMA_PERIOD, compute_guss_signal  # noqa: E402
from src.signals.orderflow import compute_orderflow_signals  # noqa: E402

ESTABLISHED_TREND_ADX = 25.0
WINDOWS = {"w15m": 3, "w1h": 12, "w4h": 48}  # Bar-Zahlen wie extract_signal_windows_5m.py

t0 = time.time()

# --- 5m-native Bausteine -------------------------------------------------
df5 = pd.read_csv("data/BTCUSDT_5m_full_with_volume.csv")
df5["time"] = pd.to_datetime(df5["time"], utc=True)
df5 = df5.set_index("time").sort_index()
print(f"5m-Datenbasis: {df5.index[0]} bis {df5.index[-1]}, {len(df5)} Bars")

orderflow = compute_orderflow_signals(df5)  # cvd_bullish/cvd_bearish/vwap_above/vwap_below
patterns = detect_candlestick_patterns(df5)  # 7 Muster, doji ohne Richtung

adx5 = adx(df5, period=14)
macd5 = macd(df5["close"])
established = adx5["adx"] >= ESTABLISHED_TREND_ADX
di_bullish = adx5["plus_di"] > adx5["minus_di"]
di_bearish = adx5["minus_di"] > adx5["plus_di"]
complete = adx5["adx"].notna() & adx5["plus_di"].notna() & adx5["minus_di"].notna() & macd5["macd_histogram"].notna()
# Downtrend verliert Schwung (DI baerisch, MACD-Hist positiv) -> bullisches Reversal-Signal.
momentum_bullish = (established & di_bearish & (macd5["macd_histogram"] > 0) & complete).fillna(False)
# Uptrend verliert Schwung (DI bullisch, MACD-Hist negativ) -> baerisches Reversal-Signal.
momentum_bearish = (established & di_bullish & (macd5["macd_histogram"] < 0) & complete).fillna(False)

bullish_5m = pd.DataFrame({
    "cvd_bullish": orderflow["cvd_bullish"],
    "vwap_above": orderflow["vwap_above"],
    "hammer": patterns["hammer"],
    "bullish_engulfing": patterns["bullish_engulfing"],
    "morning_star": patterns["morning_star"],
    "momentum_bullish": momentum_bullish,
})
bearish_5m = pd.DataFrame({
    "cvd_bearish": orderflow["cvd_bearish"],
    "vwap_below": orderflow["vwap_below"],
    "hanging_man": patterns["hanging_man"],
    "bearish_engulfing": patterns["bearish_engulfing"],
    "evening_star": patterns["evening_star"],
    "momentum_bearish": momentum_bearish,
})

# --- GUSS (1H-nativ), Richtung post-hoc rekonstruiert ---------------------
df1h = pd.read_csv("data/BTCUSDT_1h.csv")
df1h["time"] = pd.to_datetime(df1h["time"], utc=True)
df1h = df1h.set_index("time").sort_index()

guss_signal_1h = compute_guss_signal(df1h, ema_period=DEFAULT_EMA_PERIOD, swing_lookback=20)
ema50_1h = pd.Series(ema_series(df1h["close"].to_numpy(), DEFAULT_EMA_PERIOD), index=df1h.index)
guss_bullish_1h = guss_signal_1h & (df1h["close"] > ema50_1h)
guss_bearish_1h = guss_signal_1h & (df1h["close"] < ema50_1h)

# Projektion auf 5m-Raster: identisches Vorgehen wie extract_signal_windows_5m.py
# (nur auf der EINEN 5m-Kerze pro Stunde, deren Schlusszeit mit der
# 1H-Bestaetigung zusammenfaellt).
guss_close_time = df5.index + pd.Timedelta(minutes=5)


def _project_guss(series_1h: pd.Series) -> pd.Series:
    confirm = series_1h.copy()
    confirm.index = confirm.index + pd.Timedelta(hours=1)
    return confirm.reindex(guss_close_time).fillna(False).set_axis(df5.index)


bullish_5m["guss_bullish"] = _project_guss(guss_bullish_1h)
bearish_5m["guss_bearish"] = _project_guss(guss_bearish_1h)

print(f"Richtungskonforme Signalgruppen gebildet ({time.time()-t0:.1f}s): "
      f"{len(bullish_5m.columns)} bullisch, {len(bearish_5m.columns)} baerisch")

# --- Konfluenz-Score je Fenster: Summe der im Fenster aktiven Signale -----
phase_df = pd.read_csv("output/phase_segmentation_1h.csv")
phase_df["time"] = pd.to_datetime(phase_df["time"], utc=True)
phase_df = phase_df.set_index("time").sort_index()

entry_time = df5.index + pd.Timedelta(minutes=5)

for label, group_df in [("long", bullish_5m), ("short", bearish_5m)]:
    result = pd.DataFrame(index=df5.index)
    for window, bars in WINDOWS.items():
        rolled = group_df.astype(bool).rolling(window=bars, min_periods=1).max().astype(bool)
        result[f"confluence_score__{window}"] = rolled.sum(axis=1).astype(int)
    result.insert(0, "signal_time", df5.index)
    result.insert(1, "entry_time", entry_time)
    result = result.iloc[:-1]  # letzte Zeile hat keine Entry-Kerze

    joined_phase = confirmed_asof_join(result["entry_time"], phase_df, "1h", ["phase"]).reset_index(drop=True)
    result = result.reset_index(drop=True)
    result.insert(2, "phase", joined_phase["phase"])

    result.to_csv(f"output/confluence_{label}_5m.csv", index=False)
    print(f"{label}: {len(result)} Zeilen -> output/confluence_{label}_5m.csv")
    for window in WINDOWS:
        col = f"confluence_score__{window}"
        print(f"  {window}: mean={result[col].mean():.2f}, max={result[col].max()}, "
              f"Anteil Score>=3: {(result[col] >= 3).mean()*100:.2f}%")

print(f"\nFertig ({time.time()-t0:.1f}s).")
