"""Parameter fuer den AVWAP-Pivot-Konfluenz-Rejection-Backtest (Tobys eigene
Setup-Idee, 18.09.2026): "avwap von Pivots markiert, diese werden
angetestet und Kurs laeuft mit meinem Setup in entgegengesetzte Richtung"
-- ein Mean-Reversion/Rejection-Setup an dynamischen, volumen-gewichteten
Unterstuetzungs-/Widerstandslinien.

Kein Original-Indikator, keine einzelne Quelle -- Formalisierung aus
etabliertem AVWAP-Trading-Wissen (siehe Recherche-Quellen im Report) plus
drei Nutzer-Entscheidungen per AskUserQuestion (18.09.2026): kurze
Pivot-Laenge, einzelne Docht-Kerze als Rejection-Bestaetigung, MEHRERE
gleichzeitig aktive AVWAP-Linien (Konfluenz-Zonen) statt nur der jeweils
letzten wie bei LSOB/Old Money Stack.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class AvwapPivotParams:
    pivot_length: int = 3  # Pivot High/Low auf CLOSE, Nutzer-Wahl "kurz"
    max_active_lines_per_side: int = 5  # Cap fuer Konfluenz-Linien (eigene, dokumentierte Grenze)


@dataclass(frozen=True)
class BacktestParams:
    # Toby-Setup-Exit-Parameter, 1:1 identisch zu toby_setup/config.py:
    # SL 10%/TP 30%/Trailing-Ruecksetzer 10% Marge bei 20x Hebel.
    tp_pct: float = 1.5
    sl_pct: float = 0.5
    retrace_pct: float = 0.5
    max_hold_hours: float = 48.0  # vertikale Barriere; vertical_bars = max_hold_hours*60/tf_minutes je Timeframe
    fee_pct_per_side: float = 0.0006
    initial_equity: float = 10_000.0
    risk_per_trade_pct: float = 1.0
    max_leverage: float = 10.0


TIMEFRAMES = ["5m", "15m", "1h"]
DIRECTIONS = ["LONG", "SHORT"]
