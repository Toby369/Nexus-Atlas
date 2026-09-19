"""GUSS-Signal, Python-Implementierung fuer die Signalgruppe "Entry-Muster",
siehe docs/research/TOBY-SETUP-PHASEN-DEFINITION.md.

Kategorie A -- basiert auf der offiziellen GUSS-Indikator-Beschreibung
(TradingView-Changelog-Screenshots, vom Nutzer am 19.09.2026 nachgereicht,
nachdem die vorherige Version dieses Moduls -- ein 1:1-Port der internen
`lib/tradingIndicatorsContext.ts`-Rekonstruktion ohne einsehbares
Original -- auf dem vollen Datensatz NIE feuerte, siehe Git-Historie):

    "Der GUSS-Indikator erkennt Trend-Pullbacks zur EMA 50 (optional auch
    an der EMA 21 oder EMA 200) ... Funktionsweise: 1) Der Markt bildet
    zunaechst ein neues Hoch (fuer Long) oder neues Tief (fuer Short).
    2) Darauf folgt eine zusammenhaengende Gegenbewegung, die an der EMA 50
    (bzw. EMA 21/200) landet oder sie beruehrt. 3) In diesem Moment
    entsteht ein GUSS-Signal, und der moegliche Entry erfolgt an bzw. um
    die EMA 50."

Korrekturen gegenueber der fruehreren Version:
- Standard-EMA ist 50 (nicht 21 -- die TS-Rekonstruktion war hier
  unsicher, "EMA 50 oder 21, je nach Kontext"; die offizielle Beschreibung
  nennt EMA50 zuerst/als Standard, EMA21/200 als Varianten).
- "zusammenhaengende Gegenbewegung" (Kategorie C, hier operationalisiert):
  NICHT die fruehere "clean"-Regel (jede einzelne Kerze im gesamten, oft
  50+ Bars langen Segment muss richtungskonform schliessen -- bei 1h-BTC-
  Rauschen statistisch quasi unmoeglich, daher 0 Treffer auf dem vollen
  Datensatz). Stattdessen: der Ursprungs-Swing bleibt bis zur EMA-
  Beruehrung das Extrem des Segments (keine Kerze macht vorher ein neues
  Hoch ueber dem Ursprungs-Hoch bzw. ein neues Tief unter dem Ursprungs-
  Tief) -- das ist die direkte, unmittelbare Lesart von "zusammenhaengend"
  (kein Zick-Zack zu einem neuen Extrem und zurueck), ohne einen
  willkuerlichen Bar-fuer-Bar-Schwellenwert zu erfinden.
- Signal ist ein EREIGNIS ("in diesem Moment entsteht ein GUSS-Signal"),
  keine ueber viele Folge-Bars anhaltende "aktiv"-Flagge: feuert genau an
  der ersten Bar, an der die zusammenhaengende Gegenbewegung die EMA
  beruehrt, danach nicht erneut fuer denselben Ursprung.

Bewusst weiterhin OHNE das Produktions-Regime-Gate und OHNE die optionalen
ATR-Stop-Loss-Leitplanken (Risikomanagement-Zusatz, kein Bestandteil der
Signal-Erkennung selbst) -- siehe Zirkularitaets-Begruendung im
Definitions-Dokument.

1H-Kerzen, lookback=20 Bars (`GUSS_SWING_LOOKBACK`, unveraendert -- die
offizielle Beschreibung nennt keinen expliziten Swing-Lookback), point-in-
time sicher: ein Swing bei Index i ist erst ab Index i+lookback bekannt
(siehe `_common.py::detect_fractal_swings`).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.signals._common import detect_fractal_swings, ema_series

DEFAULT_EMA_PERIOD = 50
DEFAULT_SWING_LOOKBACK = 20


def _known_swing_index_series(is_swing: np.ndarray, lookback: int) -> np.ndarray:
    """Fuer jede Bar-Position i: Index des zuletzt BEKANNTEN (bestaetigten)
    Swings dieses Typs, oder -1 wenn noch keiner bekannt ist. Ein Swing bei
    Position j wird an Position j+lookback bekannt (Vorwaerts-Auffuellen ab
    dort) -- kein Blick in die Zukunft."""
    n = len(is_swing)
    known_at = np.full(n, -1, dtype=np.int64)
    for j in np.where(is_swing)[0]:
        confirm_idx = j + lookback
        if confirm_idx < n:
            known_at[confirm_idx] = j
    last = -1
    out = np.full(n, -1, dtype=np.int64)
    for i in range(n):
        if known_at[i] != -1:
            last = known_at[i]
        out[i] = last
    return out


def compute_guss_signal(
    ohlc: pd.DataFrame,
    ema_period: int = DEFAULT_EMA_PERIOD,
    swing_lookback: int = DEFAULT_SWING_LOOKBACK,
) -> pd.Series:
    """Boolesches GUSS-Ereignis-Signal je Bar (siehe Modul-Docstring).
    `True` genau an der Bar, an der eine zusammenhaengende Gegenbewegung
    vom letzten bestaetigten Swing-Extrem erstmals die EMA beruehrt.
    `False` (nie NaN) sonst -- inkl. waehrend der Anlaufzeit."""
    highs = ohlc["high"].to_numpy()
    lows = ohlc["low"].to_numpy()
    closes = ohlc["close"].to_numpy()
    n = len(ohlc)

    ema = ema_series(closes, ema_period)
    swings = detect_fractal_swings(highs, lows, swing_lookback)
    known_high_idx = _known_swing_index_series(swings["is_swing_high"].to_numpy(), swing_lookback)
    known_low_idx = _known_swing_index_series(swings["is_swing_low"].to_numpy(), swing_lookback)

    signal = np.zeros(n, dtype=bool)
    current_origin_idx = -1
    current_trend: str | None = None
    fired = False
    broken = False

    for i in range(n):
        ema_i = ema[i]
        close_i = closes[i]
        if np.isnan(ema_i):
            current_origin_idx, current_trend, fired, broken = -1, None, False, False
            continue
        if close_i > ema_i:
            trend = "up"
            origin_idx = known_high_idx[i]
        elif close_i < ema_i:
            trend = "down"
            origin_idx = known_low_idx[i]
        else:
            current_origin_idx, current_trend, fired, broken = -1, None, False, False
            continue
        if origin_idx == -1:
            current_origin_idx, current_trend, fired, broken = -1, None, False, False
            continue

        if origin_idx != current_origin_idx or trend != current_trend:
            current_origin_idx, current_trend = origin_idx, trend
            fired, broken = False, False

        if fired or broken:
            continue

        if trend == "up" and highs[i] > highs[origin_idx]:
            broken = True
            continue
        if trend == "down" and lows[i] < lows[origin_idx]:
            broken = True
            continue

        touched = (trend == "up" and lows[i] <= ema_i) or (trend == "down" and highs[i] >= ema_i)
        if touched:
            signal[i] = True
            fired = True

    return pd.Series(signal, index=ohlc.index, name="guss_signal")
