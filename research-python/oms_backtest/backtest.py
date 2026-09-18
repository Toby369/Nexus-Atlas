"""Trade-Simulation: SL/TP-Aufloesung inkl. Break-Even-Nachziehen, Fees,
Equity-Kurve pro Bucket (Timeframe x Richtung).

Anders als bei LSOB (`lsob_backtest/backtest.py`, einfache SL/TP-Aufloesung
ohne Stop-Bewegung) spezifiziert der "Old Money Stack"-Bericht selbst einen
Break-Even-Mechanismus: sobald der Kurs 30% des Wegs von Entry zu TP
zurueckgelegt hat (`BacktestParams.be_threshold_pct`), wird der SL auf den
Entry-Preis nachgezogen. Das TP-Ziel selbst bleibt der feste CRV-1:2-Preis
(siehe oms_engine.py-Docstring zur SR-Linien-Konsequenz).
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import BacktestParams
from oms_engine import Signal


@dataclass
class Trade:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    direction: str
    entry_price: float
    sl_price: float  # urspruenglicher SL (Ausbruchskerzen-Docht), bestimmt die Positionsgroesse
    tp_price: float
    exit_price: float
    exit_reason: str  # "sl" | "tp" | "breakeven" | "end_of_data"
    moved_to_breakeven: bool
    risk_price_distance: float  # auf Basis des URSPRUENGLICHEN SL (Positionsgroesse aendert sich nicht)
    leverage_capped: bool  # True, wenn max_leverage die Positionsgroesse unter das Ziel-Risiko gedrueckt hat
    r_multiple_gross: float
    equity_before: float
    equity_after: float
    net_pnl: float
    net_return_pct: float


# Cache fuer _resolve_exit_with_be -- gleiches Prinzip wie in
# lsob_backtest/backtest.py (id(df)+len(df) als Schluessel, da DataFrames
# nicht hashbar sind; len(df) zusaetzlich als Schutz gegen id()-Wiederver-
# wendung durch den Garbage Collector zwischen verschiedenen DataFrames).
# Hier zusaetzlich entry/be_threshold_pct im Schluessel, da der Break-Even-
# Trigger-Preis von beiden abhaengt (nicht nur von sl/tp wie bei LSOB).
_resolve_exit_cache: dict[tuple[int, int, int, bool, float, float, float, float], tuple[float, str, object]] = {}


def clear_resolve_exit_cache() -> None:
    _resolve_exit_cache.clear()


def _resolve_exit_with_be(
    df: pd.DataFrame,
    entry_idx: int,
    is_long: bool,
    entry: float,
    sl: float,
    tp: float,
    be_threshold_pct: float,
):
    """Sucht ab der Bar NACH dem Entry die erste Bar, die den (ggf. bereits
    nachgezogenen) SL oder das TP beruehrt.

    Reihenfolge pro Bar (gleiche Konvention wie LSOB's "SL first bei
    Kollision"): zuerst wird gegen den AKTUELLEN Stop (Stand VOR dieser Bar)
    sowie TP geprueft; erst danach wird geschaut, ob diese Bar den
    Break-Even-Trigger erreicht -- eine Aktualisierung des Stops wirkt sich
    also fruehestens auf die NAECHSTE Bar aus. Das vermeidet eine neue
    Intrabar-Ordnungs-Ambiguitaet (wurde der BE-Trigger vor oder nach einem
    Ruecksetzer auf den alten SL innerhalb derselben Bar erreicht?).
    """
    cache_key = (id(df), len(df), entry_idx, is_long, entry, sl, tp, be_threshold_pct)
    cached = _resolve_exit_cache.get(cache_key)
    if cached is not None:
        return cached

    n = len(df)
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()
    times = df.index.to_numpy()

    reward_dist = abs(tp - entry)
    be_trigger = entry + be_threshold_pct * reward_dist if is_long else entry - be_threshold_pct * reward_dist

    current_stop = sl
    breakeven_active = False

    for j in range(entry_idx + 1, n):
        h, l = highs[j], lows[j]
        if is_long:
            hit_sl = l <= current_stop
            hit_tp = h >= tp
        else:
            hit_sl = h >= current_stop
            hit_tp = l <= tp

        if hit_sl:
            exit_reason = "breakeven" if breakeven_active else "sl"
            result = (current_stop, exit_reason, times[j], breakeven_active)
            _resolve_exit_cache[cache_key] = result
            return result
        if hit_tp:
            result = (tp, "tp", times[j], breakeven_active)
            _resolve_exit_cache[cache_key] = result
            return result

        if not breakeven_active:
            reached_be = h >= be_trigger if is_long else l <= be_trigger
            if reached_be:
                current_stop = entry
                breakeven_active = True

    result = (closes[-1], "end_of_data", times[-1], breakeven_active)
    _resolve_exit_cache[cache_key] = result
    return result


def simulate_bucket(df: pd.DataFrame, signals: list[Signal], params: BacktestParams) -> list[Trade]:
    """Simuliert alle Signale EINER Richtung sequenziell nach Entry-Zeit,
    mit prozentualer Risiko-Positionsgroesse auf das jeweils aktuelle Equity
    dieses Buckets. Jeder Bucket startet unabhaengig bei
    params.initial_equity (gleiche Limitation wie im LSOB-Projekt, siehe
    README "getrennte Kapitalpools").

    Die Positionsgroesse wird bei Entry EINMAL anhand des urspruenglichen
    SL-Abstands festgelegt und danach nicht mehr veraendert -- das
    Break-Even-Nachziehen bewegt nur den Exit-Preis im Verlustfall, nicht
    das eingesetzte Risiko-Kapital.
    """
    trades: list[Trade] = []
    equity = params.initial_equity

    for sig in sorted(signals, key=lambda s: s.bar_index):
        is_long = sig.direction == "long"
        sl = sig.sl_price
        risk_dist = abs(sig.entry_price - sl)
        if risk_dist <= 0:
            continue  # degenerierter Fall (SL == Entry), kein gueltiger Trade

        reward_dist = risk_dist * params.crv
        tp = sig.entry_price + reward_dist if is_long else sig.entry_price - reward_dist

        exit_price, exit_reason, exit_time, moved_to_be = _resolve_exit_with_be(
            df, sig.bar_index, is_long, sig.entry_price, sl, tp, params.be_threshold_pct
        )

        risk_amount = equity * params.risk_per_trade_pct / 100
        position_size_uncapped = risk_amount / risk_dist
        # Hebel-Deckel: verhindert eine absurd grosse Notional, wenn der
        # SL-Abstand (Docht der Ausbruchskerze) extrem klein ist -- siehe
        # config.py BacktestParams.max_leverage. In diesem Fall wird
        # bewusst WENIGER als das Ziel-Risiko riskiert (realistische
        # Boersen-Beschraenkung), statt eine ueberzogene Position zu erlauben.
        max_position_size = params.max_leverage * equity / sig.entry_price
        position_size = min(position_size_uncapped, max_position_size)
        leverage_capped = position_size < position_size_uncapped

        gross_pnl = position_size * (exit_price - sig.entry_price) * (1 if is_long else -1)
        entry_fee = position_size * sig.entry_price * params.fee_pct_per_side
        exit_fee = position_size * exit_price * params.fee_pct_per_side
        net_pnl = gross_pnl - entry_fee - exit_fee

        r_multiple_gross = (exit_price - sig.entry_price) / risk_dist * (1 if is_long else -1)

        equity_before = equity
        equity += net_pnl

        trades.append(
            Trade(
                entry_time=sig.time,
                exit_time=exit_time,
                direction=sig.direction,
                entry_price=sig.entry_price,
                sl_price=sl,
                tp_price=tp,
                exit_price=exit_price,
                exit_reason=exit_reason,
                moved_to_breakeven=moved_to_be,
                risk_price_distance=risk_dist,
                leverage_capped=leverage_capped,
                r_multiple_gross=r_multiple_gross,
                equity_before=equity_before,
                equity_after=equity,
                net_pnl=net_pnl,
                net_return_pct=net_pnl / equity_before if equity_before else np.nan,
            )
        )

    return trades


def trades_to_dataframe(trades: list[Trade]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(
            columns=[
                "entry_time", "exit_time", "direction", "entry_price", "sl_price", "tp_price",
                "exit_price", "exit_reason", "moved_to_breakeven", "risk_price_distance",
                "leverage_capped", "r_multiple_gross", "equity_before", "equity_after",
                "net_pnl", "net_return_pct",
            ]
        )
    return pd.DataFrame([t.__dict__ for t in trades])
