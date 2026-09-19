"""Kanonische Referenz fuer Tobys 4 Setup-Standards (Korrektur 19.09.2026).

"Toby Setup" ist KEIN einzelnes Setup, sondern eine Familie von 4 benannten
Standards -- feste Parameter sind 20x Hebel, 10 USDT Marge/Trade (fix, NICHT
%-vom-Equity), SL 10% Marge (=-0,5% Kursbewegung), Trailing-Exit nach
TP-Beruehrung mit 10% Marge Ruecksetzer (=0,5% Kursbewegung) vom bisherigen
Hoch-/Tiefpunkt seit TP-Touch. Einzig variabler Parameter ist die
TP-Distanz.

Source of truth: Supabase `knowledge_base` (module='mein_system', section=
'Position-Sizing & CRV-Standards'). Diese Datei ist eine Code-Kopie fuer
research-python-Backtests -- bei Aenderung dort auch hier nachziehen.

Jeder neue Backtest MUSS explizit angeben, welcher Standard getestet wurde --
"Tobys Setup" ohne Standard-Nummer ist mehrdeutig (Fehler, der am 18.09.2026
in TOBY-SETUP-TRAILING-BACKTEST + AVWAP-PIVOT-CONFLUENCE-BACKTEST passierte:
beide testeten TP 30% = Standard 2, aber wurde als "das exakte Toby-Setup"
bezeichnet -- seither in beiden Berichten per Nachtrag korrigiert).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TobySetupStandard:
    number: int
    label: str
    tp_pct_of_margin: float  # TP als % der Marge
    tp_pct_price_move: float  # aequivalente Kursbewegung bei 20x
    crv: float  # TP:SL Verhaeltnis (SL ist bei allen Standards 10%/0,5%)


SL_PCT_OF_MARGIN = 10.0
SL_PCT_PRICE_MOVE = 0.5
RETRACE_PCT_OF_MARGIN = 10.0  # Trailing-Ruecksetzer nach TP-Touch, gleich fuer alle Standards
RETRACE_PCT_PRICE_MOVE = 0.5
LEVERAGE = 20.0
MARGIN_USDT_PER_TRADE = 10.0  # fix, nicht %-vom-Equity

STANDARDS = {
    1: TobySetupStandard(1, "Standard 1 (Referenz/Default)", 35.0, 1.75, 3.5),
    2: TobySetupStandard(2, "Standard 2", 30.0, 1.5, 3.0),
    3: TobySetupStandard(3, "Standard 3", 25.0, 1.25, 2.5),
    4: TobySetupStandard(4, "Standard 4", 20.0, 1.0, 2.0),
}
