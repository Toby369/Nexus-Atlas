"""Parameter fuer den Elliott-Wave-Impuls-Backtest (Tobys Vorgabe,
19.09.2026): fraktale Pivot-Ermittlung + Fibonacci-Proportionen +
Vergleichsregeln zur automatischen Erkennung von Impulswellen (1-2-3-4-5),
danach Reversal-Signal in Erwartung der A-B-C-Korrektur -- getestet mit
Tobys Setup-Exit-Logik (siehe backtest.py).

Parameter-Werte exakt aus Tobys Spezifikation (Abschnitt 2, Tabelle) --
NICHT die abweichenden Prozentangaben aus dem Fliesstext (Abschnitt "Schritt
C", 50-61.8%), da die Tabelle explizit als "Parameter fuer die Pine-Script-
Umsetzung" gekennzeichnet ist.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ElliottWaveParams:
    pivot_depth: int = 8  # Bars links/rechts, Tobys empfohlener Bereich 5-12, Mittelwert
    wave2_retrace_min: float = 0.382  # Toleranzbereich Ruecksetzer Welle 2 relativ zu Welle 1
    wave2_retrace_max: float = 0.786
    wave3_extension_min: float = 1.618  # Mindestfaktor Welle 3 relativ zu Welle 1
    wave4_retrace_max: float = 0.50  # Max. Ruecksetzer Welle 4 relativ zu Welle 3


# Tobys 4 Setup-Standards (siehe ../TOBY_SETUP_STANDARDS.py, kanonische
# Quelle: Supabase knowledge_base module='mein_system'). Hier dupliziert,
# gleiche Konvention wie pivots.py -- Standalone-Projekt, kein
# Cross-Projekt-Import. IMMER alle 4 Standards testen und explizit
# benennen, "Toby Setup" ohne Nummer ist mehrdeutig.
@dataclass(frozen=True)
class TobyStandard:
    number: int
    label: str
    tp_pct: float  # Kursbewegung, nicht Marge
    sl_pct: float
    retrace_pct: float


TOBY_STANDARDS = {
    1: TobyStandard(1, "Standard 1 (Referenz/Default)", 1.75, 0.5, 0.5),
    2: TobyStandard(2, "Standard 2", 1.5, 0.5, 0.5),
    3: TobyStandard(3, "Standard 3", 1.25, 0.5, 0.5),
    4: TobyStandard(4, "Standard 4", 1.0, 0.5, 0.5),
}


@dataclass(frozen=True)
class BacktestParams:
    max_hold_hours: float = 48.0
    fee_pct_per_side: float = 0.0006
    initial_equity: float = 10_000.0


TIMEFRAMES = ["5m", "15m", "1h"]
DIRECTIONS = ["LONG", "SHORT"]
