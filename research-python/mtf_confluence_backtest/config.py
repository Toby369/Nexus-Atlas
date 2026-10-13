"""Parameter des Multi-Timeframe-Confluence-Backtests (BTC/USDT).

Alle Regeln sind VOR dem ersten Lauf festgelegt und werden nicht optimiert --
der Backtest prueft das Konzept (4h-Struktur + 4h-Volume-Profile + 1h-
Momentum + Spot/Perp-CVD + 15m-Sweep/CHoCH) so, wie es formuliert wurde,
nicht eine im Nachhinein angepasste Variante. Jeder Wert, der im
Ursprungskonzept nicht genannt war, ist hier als eigene Annahme markiert.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class StrategyParams:
    # Alle Laengen sind in Kerzen des jeweiligen Timeframes angegeben und
    # skalieren daher mit dem Timeframe-Set (siehe TIMEFRAME_SETS).

    # --- Hoher Timeframe: Marktstruktur ---
    # Pivot-Laenge links/rechts fuer Swing-Hochs/-Tiefs. Ein Pivot ist erst
    # nach `pivot_len_high` weiteren Kerzen bestaetigt (Annahme).
    pivot_len_high: int = 3

    # --- Hoher Timeframe: Volume Profile ---
    # "FRVP ueber den letzten signifikanten Trendabschnitt" ist nicht
    # mechanisch definiert -> Annahme: rollierendes Profil ueber die letzten
    # 90 Kerzen des hohen Timeframes (4h: 15 Tage, 1D: 90 Tage), aus
    # 15m-Kerzen aufgebaut.
    vp_lookback_high: int = 90
    vp_bins: int = 120
    vp_value_area: float = 0.70
    # Zone = Level +/- zone_atr_mult * ATR(14, hoher TF). Ersetzt die starren
    # +/-0.5 % aus dem Konzept durch eine volatilitaetsabhaengige Breite.
    zone_atr_mult: float = 0.5

    # --- Mittlerer Timeframe: Momentum ---
    rsi_len: int = 14
    # "RSI-Reset Richtung 40-50": Long nur, wenn der RSI in den letzten
    # `rsi_reset_lookback` Kerzen <= rsi_reset_long war (Short gespiegelt).
    rsi_reset_long: float = 45.0
    rsi_reset_short: float = 55.0
    rsi_reset_lookback: int = 8

    # --- Orderflow (Spot vs. Perp) ---
    # Fenster in Kerzen des mittleren TF fuer die Delta-Summen (Annahme).
    cvd_window_mid: int = 8

    # --- Base-Timeframe: Trigger ---
    pivot_len_base: int = 2
    # Wie viele Base-Kerzen nach dem Sweep der CHoCH noch zaehlt (Annahme).
    sweep_valid_bars: int = 12
    vol_spike_mult: float = 1.5
    vol_spike_len: int = 20

    # --- Risiko / Ausstieg ---
    # Stop knapp unter/ueber dem Sweep-Extrem: Puffer in ATR(14, Base-TF).
    sl_atr_buffer: float = 0.1
    # Stops, die enger als dieser Anteil vom Preis sind, werden nicht
    # gehandelt (sonst fressen Gebuehren den Grossteil von 1R).
    min_stop_pct: float = 0.0015
    fixed_rr: float = 2.0
    # TP-Modus "level": naechstes Level des hohen TF (POC/VAH/VAL/Pivot) mit mindestens
    # diesem CRV, sonst wird der Trade ausgelassen.
    level_min_rr: float = 1.5
    # Zeitstopp in Base-Kerzen (15m: 48 h, 1h: 8 Tage), Annahme.
    max_hold_bars: int = 192


@dataclass(frozen=True)
class CostParams:
    # Taker-Gebuehr Binance USDT-M Futures (VIP 0) pro Seite.
    fee_pct_per_side: float = 0.0005
    # Slippage pro Seite bei Markt-/Stop-Orders (Annahme).
    slippage_pct_per_side: float = 0.0002


# Timeframe-Sets: Trigger (base), Filter (mid), Trend/Zone (high).
TIMEFRAME_SETS = {
    "15m": {"base": "15min", "mid": "1h", "high": "4h"},
    "1h": {"base": "1h", "mid": "4h", "high": "1D"},
}
TF_LABELS = {"15min": "15m", "1h": "1h", "4h": "4h", "1D": "1D"}

START_MONTH = "2020-01"
END_MONTH = "2026-09"
# Out-of-Sample-Grenze: alles ab diesem Datum zaehlt als OOS. Da keine
# Parameter optimiert werden, dient der Split als Stabilitaetscheck.
OOS_START = "2024-01-01"
