"""Walk-Forward-Validierung der CRV-Wahl (1:1.5 / 1:2 / 1:3), getrennt pro
Timeframe und Richtung.

Warum CRV und nicht die LSOB-Parameter selbst? Pivot Length/Toleranzen/etc.
stammen 1:1 aus der Pine-Datei -- sie sind keine "auf diesen Daten gewaehlte"
Grosse, es gibt hier also nichts zu optimieren/zu validieren. CRV dagegen ist
eine EIGENE Backtest-Annahme (siehe config.py) -- genau die richtige Stelle,
um Walk-Forward statt einer einzelnen In-Sample-Auswahl zu verwenden.

Ablauf pro Fold (Train strikt vor Test in der Zeit):
  1. Fuer jede CRV-Kandidatin: Trades simulieren, deren Entry im Train-
     Fenster liegt -- aber nur die Trades zaehlen fuer die AUSWAHL, deren
     Exit AUCH noch im Train-Fenster liegt (Purge: Trades, die ueber die
     Grenze ins Test-Fenster hinein aufloesen, wuerden sonst Test-Perioden-
     Information in die Auswahl einschleusen).
  2. Die CRV mit dem besten Total Return auf diesen gepurgten Train-Trades
     wird gewaehlt.
  3. Diese gewaehlte CRV wird auf die Test-Fenster-Trades angewendet, deren
     PnL auf das ueber alle Folds LAUFENDE Equity aufgeschlagen wird (kein
     Neustart pro Fold) -- das ergibt eine durchgehende Out-of-Sample-
     Equity-Kurve.

Fold-Einteilung uebernimmt PurgedWalkForwardCV (bereits vorhandenes,
getestetes Tooling aus research-python/src/validation/walk_forward.py) --
nur fuer die Bar-Index-/Zeit-Grenzen der Folds, nicht fuer das trade-genaue
Purging (das braucht Kenntnis der tatsaechlichen Exit-Zeit jedes Trades,
die eine feste Bar-Anzahl nicht abbilden kann).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # .../research-python
from src.validation.walk_forward import PurgedWalkForwardCV  # noqa: E402

from backtest import Trade, simulate_bucket  # noqa: E402
from config import BacktestParams  # noqa: E402
from lsob_engine import Signal  # noqa: E402
from metrics import compute_bucket_metrics  # noqa: E402

CRV_CANDIDATES = [1.5, 2.0, 3.0]
N_SPLITS = 4
TRAIN_SIZE_FRACTION = 0.25
TEST_SIZE_FRACTION = 0.15
IS_INITIAL_EQUITY = 10_000.0  # nur fuer den IS-Vergleich der Kandidaten, nicht die OOS-Kurve


@dataclass
class FoldResult:
    fold: int
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    is_return_pct_by_crv: dict[float, float]
    is_trades_by_crv: dict[float, int]
    selected_crv: float
    oos_trades: list[Trade]


@dataclass
class WalkForwardResult:
    timeframe: str
    direction: str
    folds: list[FoldResult]
    oos_trades_chained: list[Trade]  # ueber alle Folds durchgehend, EINE Equity-Kurve


def _filter_by_entry(signals: list[Signal], start: pd.Timestamp, end: pd.Timestamp) -> list[Signal]:
    return [s for s in signals if start <= pd.Timestamp(s.time) < end]


def purge_boundary_crossing(trades: list[Trade], train_end: pd.Timestamp) -> list[Trade]:
    """Behaelt nur Trades, deren Exit-Zeit noch VOR/AM Ende des Train-
    Fensters liegt -- ein Trade, dessen Entry im Train-Fenster liegt, aber
    dessen SL/TP erst im (zeitlich anschliessenden) Test-Fenster ausgeloest
    wird, wuerde sonst Test-Perioden-Preisverhalten in die IS-Auswahl
    einschleusen (Label-Leakage-Analogon zum bar-basierten purge_window in
    PurgedWalkForwardCV, hier trade-genau statt bar-genau)."""
    return [t for t in trades if pd.Timestamp(t.exit_time) <= train_end]


def select_best_crv(is_return_pct_by_crv: dict[float, float], fallback: float = 2.0) -> float:
    """Waehlt die CRV-Kandidatin mit dem hoechsten (gepurgten) In-Sample-
    Total-Return. Faellt auf `fallback` zurueck, wenn KEINE Kandidatin
    ueberhaupt gepurgte Train-Trades hatte (alle Werte NaN/-inf) -- eine
    Auswahl ohne jede Datenbasis waere keine echte Auswahl, sondern Zufall."""
    finite = {k: v for k, v in is_return_pct_by_crv.items() if np.isfinite(v)}
    if not finite:
        return fallback
    return max(finite, key=lambda c: finite[c])


def run_crv_walk_forward(df: pd.DataFrame, signals: list[Signal], timeframe: str, direction: str) -> WalkForwardResult:
    cv = PurgedWalkForwardCV(
        n_splits=N_SPLITS,
        train_size=TRAIN_SIZE_FRACTION,
        test_size=TEST_SIZE_FRACTION,
        purge_window=0,  # bar-genaues Purging hier bewusst 0 -- das trade-genaue Purging unten uebernimmt die Aufgabe
        embargo_window=0,
        expanding=True,
    )

    folds: list[FoldResult] = []
    running_equity = BacktestParams().initial_equity
    oos_trades_chained: list[Trade] = []

    for i, (train_idx, test_idx) in enumerate(cv.split(df)):
        train_start, train_end = df.index[train_idx[0]], df.index[train_idx[-1]]
        test_start, test_end = df.index[test_idx[0]], df.index[test_idx[-1]]

        train_signals = _filter_by_entry(signals, train_start, train_end)
        is_return_by_crv: dict[float, float] = {}
        is_trades_by_crv: dict[float, int] = {}

        for crv in CRV_CANDIDATES:
            params = BacktestParams(crv=crv, initial_equity=IS_INITIAL_EQUITY)
            all_train_trades = simulate_bucket(df, train_signals, params)
            purged = purge_boundary_crossing(all_train_trades, train_end)
            is_trades_by_crv[crv] = len(purged)
            if purged:
                m = compute_bucket_metrics(timeframe, direction, purged, IS_INITIAL_EQUITY)
                is_return_by_crv[crv] = m.total_return_pct
            else:
                is_return_by_crv[crv] = float("nan")  # keine Datenbasis -> darf nicht gewinnen

        selected_crv = select_best_crv(is_return_by_crv)

        test_signals = _filter_by_entry(signals, test_start, test_end)
        oos_params = BacktestParams(crv=selected_crv, initial_equity=running_equity)
        oos_trades = simulate_bucket(df, test_signals, oos_params)

        if oos_trades:
            running_equity = oos_trades[-1].equity_after
        oos_trades_chained.extend(oos_trades)

        folds.append(
            FoldResult(
                fold=i,
                train_start=train_start,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                is_return_pct_by_crv=is_return_by_crv,
                is_trades_by_crv=is_trades_by_crv,
                selected_crv=selected_crv,
                oos_trades=oos_trades,
            )
        )

    return WalkForwardResult(timeframe=timeframe, direction=direction, folds=folds, oos_trades_chained=oos_trades_chained)


def run_fixed_crv_oos_baseline(df: pd.DataFrame, signals: list[Signal], crv: float, fold_boundaries: list[tuple[pd.Timestamp, pd.Timestamp]]) -> list[Trade]:
    """Vergleichs-Baseline: dieselben Test-Fenster wie beim Walk-Forward,
    aber mit EINER fest gewaehlten CRV durchgehend (keine Fold-Auswahl) --
    zeigt, ob die Walk-Forward-Auswahl gegenueber "einfach eine CRV fest
    nehmen" ueberhaupt einen Unterschied macht.
    """
    equity = BacktestParams().initial_equity
    chained: list[Trade] = []
    for test_start, test_end in fold_boundaries:
        test_signals = _filter_by_entry(signals, test_start, test_end)
        params = BacktestParams(crv=crv, initial_equity=equity)
        trades = simulate_bucket(df, test_signals, params)
        if trades:
            equity = trades[-1].equity_after
        chained.extend(trades)
    return chained
