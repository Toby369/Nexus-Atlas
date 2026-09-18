"""Parameter fuer den "Old Money Stack"-Breakout-Backtest (Claudius Vertesi,
Support/Resistance-Ausbruch auf niedrigen Timeframes).

OmsParams stammt 1:1 aus dem Strategie-Bericht des Nutzers (18.09.2026,
Tabelle "Parameter fuer den eigenen TradingView-Indikator"). BacktestParams
sind eigene, dokumentierte Annahmen (die Strategie selbst spezifiziert SL/TP/
Break-Even bereits vollstaendig -- anders als bei LSOB gibt es hier kein
reines Indikator-ohne-Handelslogik-Problem, Fees/Positionsgroesse bleiben
trotzdem eigene Backtest-Zusaetze).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class OmsParams:
    pivot_length: int = 2  # Pivot High/Low auf CLOSE (nicht High/Low!), siehe oms_engine.py
    body_out_threshold: float = 0.50  # Mindestanteil des Kerzenkoerpers jenseits der SR-Linie
    max_wick_ratio: float = 0.30  # Max. erlaubter Docht-Anteil in Ausbruchsrichtung
    max_candle_multiplier: float = 2.5  # Max. Range im Vergleich zum SMA(20) der Range
    range_sma_period: int = 20


@dataclass(frozen=True)
class BacktestParams:
    crv: float = 2.0  # Target CRV 1:2 (Nutzer-Vorgabe, wie bei LSOB bestaetigt: "1:2 passt")
    # Break-Even-Schwelle als Anteil des Wegs von Entry zu TP (Nutzer-Tabelle:
    # "30% des TP-Wegs") -- sobald erreicht, SL auf Entry nachgezogen.
    be_threshold_pct: float = 0.30
    fee_pct_per_side: float = 0.0006
    risk_per_trade_pct: float = 1.0
    initial_equity: float = 10_000.0


TIMEFRAMES = ["1m", "5m"]  # Strategie-Vorgabe: "bevorzugt 1m bis 5m bei volatilen Crypto-Pairs"
DIRECTIONS = ["long", "short"]
