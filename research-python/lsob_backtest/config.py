"""Parameter fuer den LSOB-Backtest.

Alle Werte unter LsobParams sind 1:1 aus LSOB_Rekonstruktion.pine uebernommen
(siehe Kommentar bei jedem Feld, welcher Pine-Input er entspricht). Die
Backtest-Parameter darunter (Fees, Risiko, CRV) sind NICHT im Pine-Script
enthalten -- das ist ein Indikator, kein strategy()-Skript, daher keine
Positionsgroessen-/Fee-Logik dort vorhanden. Diese Werte sind explizit
dokumentierte Annahmen dieses Backtests, keine Uebernahme aus der Pine-Datei.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LsobParams:
    # --- Core Logic (Pine group "Core Logic") ---
    pivot_len: int = 15  # pivotLen
    box_invalid_tol_pc: float = 20.0  # boxInvalidTolPc
    retest_tol_pc: float = 10.0  # retestTolPc
    strict_wick_inval: bool = False  # strictWickInval
    max_wick_pen_pc: float = 50.0  # maxWickPenPc
    max_history_bars: int = 2000  # maxHistoryBars


@dataclass(frozen=True)
class BacktestParams:
    # Reward:Risk 1:2, wie vom Nutzer vorgegeben ("TP bei CRV 1:2").
    crv: float = 2.0
    # SL-Puffer ueber/unter der Rejection-Wick der Confirmation-Kerze. 0.0 =
    # SL exakt AM Wick-Extrempunkt (keine im Pine-Script vorgegebene Distanz
    # vorhanden -- "unter/ueber" impliziert einen kleinen Puffer, hier
    # bewusst 0 als konservativste, nicht erfundene Annahme; ueber
    # sl_buffer_pc anpassbar).
    sl_buffer_pc: float = 0.0
    # Taker-Fee pro Seite (Nutzer-Vorgabe: 0.06-0.1%) -- unterer Rand als
    # Default, ueber CLI/Aufruf anpassbar.
    fee_pct_per_side: float = 0.0006
    # Risiko pro Trade als % des aktuellen Equity dieses Buckets (Timeframe x
    # Richtung) -- NICHT aus dem Pine-Script, eigene Annahme fuer eine
    # sinnvolle Equity-Kurve/Drawdown/Sharpe-Berechnung (siehe README,
    # Abschnitt "Methodische Annahmen").
    risk_per_trade_pct: float = 1.0
    initial_equity: float = 10_000.0


# Zeitrahmen, fuer die der Backtest getrennt ausgewertet wird.
TIMEFRAMES = ["15m", "1h", "4h"]
DIRECTIONS = ["long", "short"]
