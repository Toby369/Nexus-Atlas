"""Trade-Simulation auf 15m-Kerzen.

- Einstieg zum Open der Kerze nach dem Signal (Market, Taker).
- Pro Variante hoechstens eine offene Position.
- Stop und TP intrabar: Beruehrt eine Kerze beide, zaehlt der Stop
  (konservativ, da die Reihenfolge innerhalb der Kerze unbekannt ist).
  Oeffnet eine Kerze schon jenseits des Stops, wird zum Open gefuellt.
- Zeitstopp nach `max_hold_bars` zum Close.
- Ergebnis in R (1R = Abstand Einstieg-Stop), Kosten bereits abgezogen.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from config import CostParams, StrategyParams
from signals import Setup


def _target(setup: Setup, entry: float, risk: float, tp_mode: str, p: StrategyParams) -> float | None:
    d = setup.direction
    if tp_mode == "fixed":
        return entry + d * p.fixed_rr * risk
    # "level": naechstes 4h-Level in Trade-Richtung mit Mindest-CRV.
    min_dist = p.level_min_rr * risk
    candidates = [t for t in setup.targets if d * (t - entry) >= min_dist]
    if not candidates:
        return None
    return min(candidates, key=lambda t: d * (t - entry))


def simulate(
    df: pd.DataFrame,
    setups: list[Setup],
    accept: Callable[[Setup], bool],
    tp_mode: str,
    p: StrategyParams,
    costs: CostParams,
) -> pd.DataFrame:
    o, h, l, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
    n = len(c)
    side_cost = costs.fee_pct_per_side + costs.slippage_pct_per_side
    rows = []
    free_from = 0  # erster Bar-Index, an dem eine neue Position erlaubt ist

    for s in setups:
        e = s.bar + 1
        if e <= free_from or e >= n or not accept(s):
            continue
        d = s.direction
        entry = o[e]
        risk = d * (entry - s.stop)
        if risk <= 0 or risk / entry < p.min_stop_pct:
            continue
        tp = _target(s, entry, risk, tp_mode, p)
        if tp is None:
            continue

        exit_price, reason, j = None, "time", min(e + p.max_hold_bars, n - 1)
        for k in range(e, min(e + p.max_hold_bars, n - 1) + 1):
            hit_stop = l[k] <= s.stop if d == 1 else h[k] >= s.stop
            hit_tp = h[k] >= tp if d == 1 else l[k] <= tp
            if hit_stop:
                gap = (o[k] < s.stop) if d == 1 else (o[k] > s.stop)
                exit_price, reason, j = (o[k] if gap else s.stop), "stop", k
                break
            if hit_tp:
                exit_price, reason, j = tp, "tp", k
                break
        if exit_price is None:
            exit_price = c[j]

        gross_r = d * (exit_price - entry) / risk
        cost_r = side_cost * (entry + exit_price) / risk
        rows.append(
            {
                "entry_time": df.index[e], "exit_time": df.index[j], "direction": "long" if d == 1 else "short",
                "entry": entry, "stop": s.stop, "tp": tp, "exit": exit_price, "reason": reason,
                "stop_pct": risk / entry, "gross_r": gross_r, "cost_r": cost_r, "r": gross_r - cost_r,
            }
        )
        free_from = j
    return pd.DataFrame(rows)
