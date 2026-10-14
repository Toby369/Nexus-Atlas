"""Trade-Simulation und Kettenregeln (Protokoll Abschnitt 5).

Ein Setup liefert Einstiegsposition, Stop und die Ziel-Kandidaten. Ob daraus
ein Trade wird (Ziel 1 ueber dem Einstieg, Mindest-CRV, keine Kursluecke unter
den Stop), entscheidet sich erst beim Einstieg, weil der Einstiegspreis das
Open der Folgekerze ist.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from orderflow_4step import config as C
from orderflow_4step.features import next_anchor_after

COST_PER_SIDE = C.FEE_PER_SIDE + C.SLIPPAGE_PER_SIDE


@dataclass(frozen=True)
class Bars:
    """15m-Kerzen als Arrays (schneller Zugriff in der Simulation)."""

    open_time: pd.DatetimeIndex
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    bar: pd.Timedelta = pd.Timedelta(minutes=15)

    @classmethod
    def from_frame(cls, df15: pd.DataFrame, bar: pd.Timedelta = pd.Timedelta(minutes=15)) -> "Bars":
        return cls(df15.index, df15["open"].to_numpy(), df15["high"].to_numpy(), df15["low"].to_numpy(),
                   df15["close"].to_numpy(), bar)


@dataclass(frozen=True)
class Trade:
    entry_pos: int
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    exit_pos: int
    entry: float
    stop: float
    t1: float
    t2: float
    r: float
    is_loss: bool
    exit_reason: str


def pick_targets(entry: float, vwap: float, poc: float, swing_prices: np.ndarray) -> tuple[float, float]:
    """Ziel 1 = naeherer von VWAP/POC ueber dem Einstieg; Ziel 2 = letztes Swing-Hoch ueber Ziel 1.

    `swing_prices`: Preise der zum Einstieg bestaetigten Swing-Hochs, nach
    Pivot-Zeit aufsteigend. NaN, wenn es kein Ziel gibt.
    """
    above = [p for p in (vwap, poc) if np.isfinite(p) and p > entry]
    if not above:
        return np.nan, np.nan
    t1 = min(above)
    higher = swing_prices[swing_prices > t1]
    t2 = float(higher[-1]) if len(higher) else np.nan
    return t1, t2


def _funding_cost(funding: pd.Series, start: pd.Timestamp, end: pd.Timestamp,
                  fallback: float = C.FUNDING_FALLBACK) -> float:
    """Summe der Funding-Raten fuer alle 8h-Zeitpunkte in (start, end]; Long zahlt positive Raten.

    Fuer Short wird die gespiegelte (negierte) Reihe mit negiertem Ersatzwert uebergeben.
    """
    first = start.floor("8h") + pd.Timedelta(hours=8)
    if first > end:
        return 0.0
    times = pd.date_range(first, end, freq="8h")
    rates = funding.reindex(times)
    return float(rates.fillna(fallback).sum())


def _half_return(entry: float, exit_price: float, funding_paid: float) -> float:
    """Netto-Rendite einer Haelfte. Mit abs(entry) gilt die Formel auch fuer gespiegelte
    (negierte) Short-Preise: (-X + E) / E = Short-Gewinn."""
    return (exit_price - entry) / abs(entry) - COST_PER_SIDE * (1.0 + exit_price / entry) - funding_paid


def simulate_trade(bars: Bars, funding: pd.Series, entry_pos: int, stop: float, t1: float, t2: float,
                   funding_fallback: float = C.FUNDING_FALLBACK, timeout_bars: int = C.TF_15M.timeout_bars
                   ) -> Trade | None:
    """Einen Trade ab Open von `entry_pos` durchspielen. None, wenn er nach den Einstiegsregeln entfaellt."""
    n = len(bars.open)
    if entry_pos >= n:
        return None
    entry = float(bars.open[entry_pos])
    if not np.isfinite(t1) or entry <= stop or t1 <= entry:
        return None
    risk = entry - stop
    if (t1 - entry) < C.MIN_CRV * risk:
        return None

    last_pos = min(entry_pos + timeout_bars - 1, n - 1)
    exits: list[tuple[float, int]] = []  # (Preis, Position) je Haelfte
    reason = "timeout"
    is_loss = False
    b = entry_pos
    # Phase A: ganze Position, bis Stop oder Ziel 1
    while b <= last_pos:
        if bars.low[b] <= stop:
            fill = min(stop, bars.open[b])
            exits = [(fill, b), (fill, b)]
            reason, is_loss = "stop", True
            break
        if bars.high[b] >= t1:
            if not np.isfinite(t2):
                exits = [(t1, b), (t1, b)]
                reason = "t1_full"
            else:
                exits = [(t1, b)]
            break
        b += 1
    if not exits:
        exits = [(bars.close[last_pos], last_pos), (bars.close[last_pos], last_pos)]
    elif len(exits) == 1:
        # Phase B: Rest mit Stop auf Einstand, Pruefung ab der Folgekerze
        b += 1
        while b <= last_pos:
            if bars.low[b] <= entry:
                exits.append((min(entry, bars.open[b]), b))
                reason = "t1_then_breakeven"
                break
            if bars.high[b] >= t2:
                exits.append((t2, b))
                reason = "t1_then_t2"
                break
            b += 1
        if len(exits) == 1:
            exits.append((bars.close[last_pos], last_pos))
            reason = "t1_then_timeout"

    entry_time = bars.open_time[entry_pos]
    r_total = 0.0
    for price, pos in exits:
        exit_time = bars.open_time[pos] + bars.bar
        paid = _funding_cost(funding, entry_time, exit_time, funding_fallback)
        r_total += C.PARTIAL_SHARE * _half_return(entry, price, paid) / (risk / abs(entry))
    final_pos = max(pos for _, pos in exits)
    return Trade(entry_pos, entry_time, bars.open_time[final_pos] + bars.bar, final_pos, entry,
                 stop, t1, t2, r_total, is_loss, reason)


def run_chain(bars: Bars, funding: pd.Series, setups: pd.DataFrame, swing_highs: pd.DataFrame,
              daily_rule: bool, funding_fallback: float = C.FUNDING_FALLBACK, anchor: str = "us",
              timeout_bars: int = C.TF_15M.timeout_bars) -> list[Trade]:
    """Setups sequenziell abarbeiten: hoechstens ein offener Trade, optional Tagesregel.

    `setups` braucht Spalten entry_pos, stop, target_a, target_b (Kandidaten fuer Ziel 1,
    NaN = keiner), sortiert nach entry_pos.
    """
    confirm_ns = swing_highs["confirm_time"].values.astype("datetime64[ns]")
    order = np.argsort(swing_highs["pivot_time"].values)
    pivot_prices = swing_highs["price"].to_numpy()[order]
    pivot_confirm = confirm_ns[order]

    trades: list[Trade] = []
    free_from = 0
    losses_in_row = 0
    locked_until: pd.Timestamp | None = None
    for row in setups.itertuples(index=False):
        e = int(row.entry_pos)
        if e < free_from or e >= len(bars.open):
            continue
        entry_time = bars.open_time[e]
        if daily_rule and locked_until is not None and entry_time < locked_until:
            continue
        known = pivot_prices[pivot_confirm <= entry_time.to_datetime64()]
        t1, t2 = pick_targets(float(bars.open[e]), row.target_a, row.target_b, known)
        trade = simulate_trade(bars, funding, e, float(row.stop), t1, t2, funding_fallback, timeout_bars)
        if trade is None:
            continue
        trades.append(trade)
        free_from = trade.exit_pos + 1
        if daily_rule:
            losses_in_row = losses_in_row + 1 if trade.is_loss else 0
            if losses_in_row >= C.MAX_CONSECUTIVE_LOSSES:
                locked_until = next_anchor_after(trade.exit_time, anchor)
                losses_in_row = 0
    return trades


def trades_frame(trades: list[Trade]) -> pd.DataFrame:
    """Preise als Betraege (bei Short liegen sie in der Simulation gespiegelt/negiert vor)."""
    df = pd.DataFrame([t.__dict__ for t in trades])
    for col in ("entry", "stop", "t1", "t2"):
        if col in df:
            df[col] = df[col].abs()
    return df


def daily_r(trades: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    """Summe R je UTC-Tag (Tag des Trade-Endes), Tage ohne Trade = 0, Bereich [start, end)."""
    last_day = end - pd.Timedelta(days=1)
    if not trades.empty:
        # Trades, die im Abschnitt beginnen, zaehlen bis zu ihrem Ende mit
        last_day = max(last_day, trades["exit_time"].max().floor("D"))
    days = pd.date_range(start, last_day, freq="D")
    if trades.empty:
        return pd.Series(0.0, index=days)
    by_day = trades.groupby(trades["exit_time"].dt.floor("D"))["r"].sum()
    return by_day.reindex(days, fill_value=0.0)
