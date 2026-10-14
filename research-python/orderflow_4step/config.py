"""Alle Parameter des vorregistrierten Protokolls an einer Stelle.

Quelle: docs/research/ORDERFLOW-4-SCHRITTE-PROTOCOL_2026-10-13.md. Jede
Konstante nennt den Protokoll-Abschnitt. Werte hier nur per datiertem
Nachtrag im Protokoll aendern, nie nach einem Ergebnis-Blick.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

# --- Abschnitt 1: Datenaufteilung -------------------------------------------
WARMUP_END = pd.Timestamp("2022-10-01", tz="UTC")
SPLITS: dict[str, tuple[pd.Timestamp, pd.Timestamp]] = {
    "train": (pd.Timestamp("2022-10-01", tz="UTC"), pd.Timestamp("2024-10-01", tz="UTC")),
    "validation": (pd.Timestamp("2024-10-01", tz="UTC"), pd.Timestamp("2025-10-01", tz="UTC")),
    "test": (pd.Timestamp("2025-10-01", tz="UTC"), pd.Timestamp("2026-10-01", tz="UTC")),
}
# Nachtrag 2 (14.10.2026): Bestaetigungsprobe = ganze Historie; SPLITS nur noch beschreibend
CONFIRMATORY = (pd.Timestamp("2022-10-01", tz="UTC"), pd.Timestamp("2026-10-01", tz="UTC"))

# --- Abschnitt 2: Umfeld ----------------------------------------------------
REGIMES_NORMAL = ("TREND_EXPANSION_BULLISH", "TREND_FORMING_BULLISH")
REGIMES_STRICT = ("VOLA_SQUEEZE_RANGING", "UNRESOLVED_NEUTRAL", "HIGH_VOLA_REVERSION")
# alle anderen (bearish, fehlend) -> kein Long
STRUCTURE_SWING_LOOKBACK = 5  # wie collect-candles SWING_LOOKBACK
FUNDING_Z_WINDOW = 90
FUNDING_Z_MAX = 2.5

# --- Abschnitt 3: Ort -------------------------------------------------------
US_TZ = "America/New_York"
US_ANCHOR_HOUR = 9
US_ANCHOR_MINUTE = 30
VWAP_MIN_BARS = 4
SIGMA_NORMAL = 0.5
SIGMA_STRICT = 1.0
PROFILE_BARS = 96
PROFILE_BUCKET_PCT = 0.001
VALUE_AREA_SHARE = 0.70

# --- Abschnitt 4: Bestaetigung ----------------------------------------------
DELTA_Z_WINDOW = 96
DELTA_Z_MAX = -1.0  # Nachtrag 2: vorher -1.5
NEW_LOW_LOOKBACK = 5  # Nachtrag 2: vorher 8
CLOSE_POSITION_MIN = 0.5
CONFIRM_WITHIN = 3

# --- Abschnitt 5: Risiko ----------------------------------------------------
ATR_PERIOD = 14
STOP_ATR_BUFFER = 0.1
MIN_CRV = 1.5
SWING_HIGH_LOOKBACK_1H = 20
PARTIAL_SHARE = 0.5
TIMEOUT = pd.Timedelta(hours=24)
MAX_CONSECUTIVE_LOSSES = 2
FEE_PER_SIDE = 0.0005
SLIPPAGE_PER_SIDE = 0.0001
FUNDING_FALLBACK = 0.0001  # je 8h, wenn keine Rate vorliegt

# Ziel-1-Modus: "vwap_poc" (Grund-Protokoll) oder "va_edge" (Variante B, explorativ)
TARGET_MODE = "vwap_poc"

# --- Abschnitt 6/7: Varianten und Statistik ---------------------------------
V0_RUNS = 1000
V0_STOP_LOOKBACK = 3
BOOTSTRAP_BLOCK_DAYS = 14
BOOTSTRAP_REPLICATES = 10_000
BOOTSTRAP_SEED = 20261013
FAMILY_ALPHA = 0.05
MIN_TRADES = 100

# --- Abschnitt 8: Sensitivitaet ---------------------------------------------
GRID_DELTA_Z = (-1.0, -1.5, -2.0)
GRID_SIGMA = (0.25, 0.5, 0.75)
GRID_NEW_LOW_LOOKBACK = (5, 8, 12)
PBO_GROUPS = 8


# --- Zeitrahmen-Profile (Variante C, ORDERFLOW-VARIANTE-C-1H_PROTOCOL_2026-10-14.md) ---


@dataclass(frozen=True)
class Timeframe:
    """Welche Kerzen wofuer, und alle davon abhaengigen Fenster."""

    name: str
    trigger: str  # Ausloeser, Ausfuehrung, ATR, VWAP, Profil
    structure: str  # Struktur-Filter und Ziel-2-Swings
    regime: str  # Regime-Filter
    bar: pd.Timedelta
    structure_bar: pd.Timedelta
    regime_bar: pd.Timedelta
    anchor: str  # "us" (09:30 New York, Mo-Fr) oder "weekly" (Montag 00:00 UTC)
    profile_bars: int
    bucket_pct: float
    delta_z_window: int
    timeout_bars: int


TF_15M = Timeframe("15m", "15m", "1h", "4h", pd.Timedelta(minutes=15), pd.Timedelta(hours=1), pd.Timedelta(hours=4),
                   "us", PROFILE_BARS, PROFILE_BUCKET_PCT, DELTA_Z_WINDOW, int(TIMEOUT / pd.Timedelta(minutes=15)))
TF_1H = Timeframe("1h", "1h", "4h", "1d", pd.Timedelta(hours=1), pd.Timedelta(hours=4), pd.Timedelta(days=1),
                  "weekly", 168, 0.002, 168, 96)
TIMEFRAMES = {"15m": TF_15M, "1h": TF_1H}
