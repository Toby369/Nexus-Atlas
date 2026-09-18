"""1:1-Port von Supabase-RPC `research_swing_setup_events()` (siehe
docs/research/SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md) nach Python --
notwendig, weil die RPC pro Signal einen teuren Lateral-Join macht und
selbst 1-Monats-Fenster am 60s-Tool-Timeout des SQL-Interfaces scheitern.

Semantik exakt wie die RPC (siehe `pg_get_functiondef` der Live-Funktion,
im Report zitiert):
- Jede Kerze ist ein Signal. Entry = Open der NAECHSTEN Kerze (kein
  Lookahead). LONG und SHORT getrennt.
- TP/SL-Preise aus Entry + tp_pct/sl_pct (Prozent, Kursbewegung).
- Vertikale Barriere: p_vertical_bars Kerzen ab (inkl.) der Entry-Kerze.
- Erste Kerze in diesem Fenster, die TP ODER SL beruehrt, entscheidet
  Stage 1. Beruehrt dieselbe Kerze BEIDE Level: SL gewinnt (konservativ,
  gleiche Konvention wie ueberall in diesem Projekt).
- SL-Ausgang: mfe_pct aus dem TATSAECHLICHEN Kerzentief/-hoch der
  ausloesenden Kerze (nicht dem nominellen SL-Preis) -- das war der
  zentrale Befund des SWING-SETUP-TRAILING-Reports.
- TP beruehrt (und nicht im selben Bar durch SL ueberschrieben):
  Trailing-Phase beginnt AB der Beruehrungs-Kerze (inklusive). Laufender
  Peak (Cumulative Max High fuer LONG / Min Low fuer SHORT, die
  Beruehrungs-Kerze selbst eingeschlossen). Erste Kerze im verbleibenden
  Fenster, deren Low (LONG) / High (SHORT) retrace_pct vom bisherigen
  Peak zurueckfaellt: TRAIL_EXIT. Kein Retrace bis Fensterende:
  OPEN_AT_HORIZON (Peak am Fensterende).
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class SetupEvent:
    signal_time: pd.Timestamp
    entry_time: pd.Timestamp
    entry_price: float
    direction: str  # "LONG" | "SHORT"
    outcome: str  # "SL" | "TIMEOUT" | "TRAIL_EXIT" | "OPEN_AT_HORIZON"
    resolution_time: pd.Timestamp | None
    bars_to_resolution: int | None
    mfe_pct: float | None


def run_toby_setup(
    df: pd.DataFrame,
    direction: str,
    tp_pct: float,
    sl_pct: float,
    retrace_pct: float,
    vertical_bars: int,
) -> list[SetupEvent]:
    """df: OHLC-DataFrame mit DatetimeIndex, aufsteigend sortiert, konstanter
    Bar-Abstand (keine Luecken -- sonst stimmt die `vertical_bars`-Fenster-
    grenze nicht mit der RPC ueberein, die rein zeitbasiert filtert)."""
    is_long = direction == "LONG"
    n = len(df)
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    times = df.index.to_numpy()

    events: list[SetupEvent] = []

    for i in range(n - 1):
        entry_idx = i + 1
        entry_price = opens[entry_idx]
        window_end = min(entry_idx + vertical_bars, n)  # exklusiv

        if is_long:
            tp_price = entry_price * (1 + tp_pct / 100.0)
            sl_price = entry_price * (1 - sl_pct / 100.0)
        else:
            tp_price = entry_price * (1 - tp_pct / 100.0)
            sl_price = entry_price * (1 + sl_pct / 100.0)

        # Stage 1: erste Beruehrung von TP oder SL im Fenster.
        touch_idx = None
        for j in range(entry_idx, window_end):
            if is_long:
                hit = highs[j] >= tp_price or lows[j] <= sl_price
            else:
                hit = lows[j] <= tp_price or highs[j] >= sl_price
            if hit:
                touch_idx = j
                break

        if touch_idx is None:
            events.append(
                SetupEvent(times[i], times[entry_idx], entry_price, direction, "TIMEOUT", None, None, None)
            )
            continue

        if is_long:
            hit_sl = lows[touch_idx] <= sl_price
        else:
            hit_sl = highs[touch_idx] >= sl_price

        if hit_sl:
            mfe = (lows[touch_idx] / entry_price - 1) * 100 if is_long else (1 - highs[touch_idx] / entry_price) * 100
            bars = touch_idx - entry_idx
            events.append(
                SetupEvent(times[i], times[entry_idx], entry_price, direction, "SL", times[touch_idx], bars, mfe)
            )
            continue

        # Stage 2: Trailing ab touch_idx (inklusive), laufender Peak.
        exit_idx = None
        peak = highs[touch_idx] if is_long else lows[touch_idx]
        for j in range(touch_idx, window_end):
            if is_long:
                if highs[j] > peak:
                    peak = highs[j]
                if lows[j] <= peak * (1 - retrace_pct / 100.0):
                    exit_idx = j
                    break
            else:
                if lows[j] < peak:
                    peak = lows[j]
                if highs[j] >= peak * (1 + retrace_pct / 100.0):
                    exit_idx = j
                    break

        mfe = (peak / entry_price - 1) * 100 if is_long else (1 - peak / entry_price) * 100
        if exit_idx is not None:
            bars = exit_idx - entry_idx
            events.append(
                SetupEvent(times[i], times[entry_idx], entry_price, direction, "TRAIL_EXIT", times[exit_idx], bars, mfe)
            )
        else:
            last_idx = window_end - 1
            bars = last_idx - entry_idx
            events.append(
                SetupEvent(times[i], times[entry_idx], entry_price, direction, "OPEN_AT_HORIZON", times[last_idx], bars, mfe)
            )

    return events


def events_to_dataframe(events: list[SetupEvent]) -> pd.DataFrame:
    return pd.DataFrame([e.__dict__ for e in events])
