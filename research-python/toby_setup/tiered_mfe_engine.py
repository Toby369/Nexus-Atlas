"""Retroaktive MFE-Tier-Klassifikation ueber alle 4 Toby-Setup-Standards plus
Break-Even-Stufe, parametrisiert nach Hebel (20x/25x/30x) -- siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md fuer die Herleitung dieser
Regeln aus der Nutzer-Diskussion vom 19.09.2026.

Regeln (Nutzer-Vorgabe, woertlich):
- Jede 15m-Kerze ist ein hypothetischer Entry (Open der naechsten Kerze),
  LONG und SHORT getrennt, Fenster 192 Bars (48h).
- SL bei ALLEN Trades 10% Marge (= 10/Hebel % Kursbewegung), unabhaengig
  vom Hebel.
- TP-Tiers in % Marge: 15 (Break-Even-Schwelle, NEU 19.09.2026), 20
  (Standard 4), 25 (Standard 3), 30 (Standard 2), 35 (Standard 1) -- alle
  ebenfalls Hebel-abhaengig in Kursbewegung umgerechnet (tier_pct/Hebel).
- Klassifikation = HOECHSTER je erreichter Tier, nicht der Tier beim
  eigentlichen Exit -- Nutzer-Vorgabe "trades mit hoeherem tp muessen in
  report ausgewiesen werden" (19.09.2026). Ein Trade, der 25% erreicht und
  erst danach den nominellen SL beruehrt, wird als Standard 3 ausgewiesen,
  NICHT als Verlust -- Begruendung des Nutzers: in seinem realen System
  zieht er den SL nach, sobald ein Trade ueber TP15 laeuft ("in meinem
  system ziehe ich sl nach, wenn trade ueber 15tp laeuft"), ein echter
  Verlust nach TP15-Beruehrung ist in der Praxis dadurch ausgeschlossen --
  diese Engine bildet daher die REALISTISCHE Tier-Erreichung ab, nicht eine
  naive Stage1/Stage2-Exit-Simulation mit fixem SL ueber die gesamte
  Trade-Laufzeit.
- SL (= echter Verlust) gilt nur, wenn nicht einmal Break-Even (15%) je
  erreicht wurde, bevor der nominelle SL beruehrt wird.
- Ab TP35 (Standard 1): Trailing-Exit exakt wie in toby_setup_engine.py
  (laufender Peak seit TP35-Beruehrung, Exit bei 10% Marge Ruecksetzer vom
  Peak) -- "Standard 1 Extended". Der tatsaechlich erreichte Peak (auch
  wenn er weit ueber 35% liegt) wird als final_mfe_margin_pct ausgewiesen.
- Gleiche Tie-Break-Konvention wie toby_setup_engine.py: beruehrt eine
  Kerze im selben Bar SL UND einen Tier, gewinnt SL fuer diesen Bar (der
  Tier-Touch in genau diesem Bar zaehlt nicht).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

SL_MARGIN_PCT = 10.0
RETRACE_MARGIN_PCT = 10.0

# Aufsteigend nach Marge-% -- Reihenfolge wird fuer den "hoechster Tier
# zuerst pruefen"-Kurzschluss pro Bar genutzt (absteigend durchlaufen).
TIERS: list[tuple[str, float]] = [
    ("BREAK_EVEN", 15.0),
    ("STANDARD_4", 20.0),
    ("STANDARD_3", 25.0),
    ("STANDARD_2", 30.0),
    ("STANDARD_1", 35.0),
]
TIER_RANK = {name: i + 1 for i, (name, _) in enumerate(TIERS)}


@dataclass
class TieredSetupEvent:
    signal_time: pd.Timestamp
    entry_time: pd.Timestamp
    entry_price: float
    direction: str  # "LONG" | "SHORT"
    leverage: float
    outcome: str
    # "SL" | "TIMEOUT_NO_TIER" | "BREAK_EVEN" | "STANDARD_4" | "STANDARD_3"
    # | "STANDARD_2" | "STANDARD_1" | "STANDARD_1_EXTENDED"
    final_mfe_margin_pct: float
    resolution_time: pd.Timestamp
    bars_to_resolution: int


def run_tiered_setup(
    df: pd.DataFrame,
    direction: str,
    leverage: float,
    vertical_bars: int = 192,
) -> list[TieredSetupEvent]:
    """df: OHLC-DataFrame mit DatetimeIndex, aufsteigend sortiert, konstanter
    Bar-Abstand (gleiche Anforderung wie toby_setup_engine.run_toby_setup)."""
    is_long = direction == "LONG"
    n = len(df)
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    times = df.index.to_numpy()

    sl_move = SL_MARGIN_PCT / leverage
    retrace_move = RETRACE_MARGIN_PCT / leverage
    tier_moves = [(name, pct / leverage) for name, pct in TIERS]  # aufsteigend

    events: list[TieredSetupEvent] = []

    for i in range(n - 1):
        entry_idx = i + 1
        entry_price = opens[entry_idx]
        window_end = min(entry_idx + vertical_bars, n)

        if is_long:
            sl_price = entry_price * (1 - sl_move / 100.0)
            tier_prices = [(name, entry_price * (1 + mv / 100.0)) for name, mv in tier_moves]
        else:
            sl_price = entry_price * (1 + sl_move / 100.0)
            tier_prices = [(name, entry_price * (1 - mv / 100.0)) for name, mv in tier_moves]
        # Absteigend fuer den Kurzschluss-Vergleich pro Bar (hoechster Tier zuerst).
        tier_prices_desc = list(reversed(tier_prices))

        best_rank = 0
        best_tier: str | None = None
        sl_idx: int | None = None
        touch35_idx: int | None = None

        for j in range(entry_idx, window_end):
            hi = highs[j]
            lo = lows[j]
            sl_hit = (lo <= sl_price) if is_long else (hi >= sl_price)
            if sl_hit:
                sl_idx = j
                break

            bar_tier = None
            for name, price in tier_prices_desc:
                touched = (hi >= price) if is_long else (lo <= price)
                if touched:
                    bar_tier = name
                    break
            if bar_tier is not None and TIER_RANK[bar_tier] > best_rank:
                best_rank = TIER_RANK[bar_tier]
                best_tier = bar_tier
                if best_tier == "STANDARD_1":
                    touch35_idx = j
                    break

        if touch35_idx is not None:
            peak = highs[touch35_idx] if is_long else lows[touch35_idx]
            exit_idx = None
            for j in range(touch35_idx, window_end):
                if is_long:
                    if highs[j] > peak:
                        peak = highs[j]
                    if lows[j] <= peak * (1 - retrace_move / 100.0):
                        exit_idx = j
                        break
                else:
                    if lows[j] < peak:
                        peak = lows[j]
                    if highs[j] >= peak * (1 + retrace_move / 100.0):
                        exit_idx = j
                        break
            final_move_pct = (peak / entry_price - 1) * 100 if is_long else (1 - peak / entry_price) * 100
            final_margin_pct = final_move_pct * leverage
            resolve_idx = exit_idx if exit_idx is not None else window_end - 1
            bars = resolve_idx - entry_idx
            events.append(
                TieredSetupEvent(
                    times[i], times[entry_idx], entry_price, direction, leverage,
                    "STANDARD_1_EXTENDED", final_margin_pct, times[resolve_idx], bars,
                )
            )
            continue

        if best_tier is None:
            if sl_idx is not None:
                mfe_move = (lows[sl_idx] / entry_price - 1) * 100 if is_long else (1 - highs[sl_idx] / entry_price) * 100
                mfe_margin = mfe_move * leverage
                bars = sl_idx - entry_idx
                events.append(
                    TieredSetupEvent(
                        times[i], times[entry_idx], entry_price, direction, leverage,
                        "SL", mfe_margin, times[sl_idx], bars,
                    )
                )
            else:
                last_idx = window_end - 1
                if is_long:
                    peak = highs[entry_idx:window_end].max()
                    mfe_move = (peak / entry_price - 1) * 100
                else:
                    peak = lows[entry_idx:window_end].min()
                    mfe_move = (1 - peak / entry_price) * 100
                mfe_margin = mfe_move * leverage
                bars = last_idx - entry_idx
                events.append(
                    TieredSetupEvent(
                        times[i], times[entry_idx], entry_price, direction, leverage,
                        "TIMEOUT_NO_TIER", mfe_margin, times[last_idx], bars,
                    )
                )
        else:
            last_idx = window_end - 1
            if is_long:
                peak = highs[entry_idx:window_end].max()
                mfe_move = (peak / entry_price - 1) * 100
            else:
                peak = lows[entry_idx:window_end].min()
                mfe_move = (1 - peak / entry_price) * 100
            mfe_margin = mfe_move * leverage
            bars = last_idx - entry_idx
            events.append(
                TieredSetupEvent(
                    times[i], times[entry_idx], entry_price, direction, leverage,
                    best_tier, mfe_margin, times[last_idx], bars,
                )
            )

    return events


def events_to_dataframe(events: list[TieredSetupEvent]) -> pd.DataFrame:
    return pd.DataFrame([e.__dict__ for e in events])
