"""Triple-Barrier-Backtest fuer die Radar-Signale -- Tobys Setup "wie bisher"
(identisch zu docs/research/RSI-REVERSAL-TRIPLE-BARRIER_2026-09-14.md):

- Entry am Open der naechsten Chart-Kerze nach dem Punkt (kein Look-Ahead).
- TP +1,5 % / SL -0,5 % Kursbewegung (= 3:1 CRV, bei 20x Hebel +30 % / -10 %
  auf die Margin), Timeout nach 48 h Wall-Clock.
- Pfad immer auf 15m-Kerzen (auch fuer 1h-/4h-Signale -- feiner als die
  Signal-Zeitebene, weniger Gleichstands-Faelle). Beruehren TP und SL dieselbe
  15m-Kerze: SL gewinnt (konservativ, Projekt-Konvention).
- Splits: train < 2026-01-14, validation 2026-01-14 bis < 2026-05-14,
  test >= 2026-05-15. Ein Trade, dessen 48-h-Fenster eine Split-Grenze oder das
  Datenende ueberschreitet, wird verworfen (Purging, kein zensierter Ausgang).
- Abweichung zum RSI-Backtest, bewusst: Trades einer Zelle ueberlappen NICHT
  (ein neues Signal zaehlt erst nach dem Ausstieg des vorherigen). Das entspricht
  einem einzelnen Trader und vermeidet, dass sich ueberlappende, voneinander
  abhaengige Trades die Signifikanz kuenstlich aufblaehen.
- Gebuehren/Funding/Slippage nicht modelliert (wie alle bisherigen Backtests);
  ein am Bruttoergebnis fehlender Vorteil wird dadurch nur schlechter.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

TP_PCT = 0.015
SL_PCT = 0.005
HOLD = pd.Timedelta(hours=48)
BREAKEVEN_TP_RATE = SL_PCT / (TP_PCT + SL_PCT)  # 25 %

SPLITS = (
    ("train", pd.Timestamp("2000-01-01", tz="UTC"), pd.Timestamp("2026-01-14", tz="UTC")),
    ("validation", pd.Timestamp("2026-01-14", tz="UTC"), pd.Timestamp("2026-05-14", tz="UTC")),
    ("test", pd.Timestamp("2026-05-15", tz="UTC"), pd.Timestamp("2100-01-01", tz="UTC")),
)


def split_of(ts: pd.Timestamp) -> str | None:
    for name, lo, hi in SPLITS:
        if lo <= ts < hi:
            return name
    return None  # Embargo-Tag 2026-05-14


@dataclass
class Path15m:
    times: np.ndarray  # open_time als int64 ns
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray

    @classmethod
    def from_df(cls, df: pd.DataFrame) -> "Path15m":
        return cls(df.index.asi8, df["open"].to_numpy(), df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy())


def simulate(path: Path15m, entry_time: pd.Timestamp, direction: int) -> tuple[str, float, pd.Timestamp] | None:
    """Ein Trade ab entry_time (Open der 15m-Kerze zu diesem Zeitpunkt).
    Gibt (Ausgang, Kursrendite in Trade-Richtung, Ausstiegszeit) zurueck, oder None
    wenn das 48-h-Fenster ueber das Datenende hinausreicht."""
    i0 = int(np.searchsorted(path.times, entry_time.value))
    if i0 >= len(path.times) or path.times[i0] != entry_time.value:
        return None
    end_ns = (entry_time + HOLD).value
    i1 = int(np.searchsorted(path.times, end_ns))  # erste Kerze ab Fensterende
    if i1 >= len(path.times):
        return None
    entry = path.open[i0]
    tp = entry * (1 + direction * TP_PCT)
    sl = entry * (1 - direction * SL_PCT)
    hi = path.high[i0:i1]
    lo = path.low[i0:i1]
    if direction > 0:
        sl_hit = lo <= sl
        tp_hit = hi >= tp
    else:
        sl_hit = hi >= sl
        tp_hit = lo <= tp
    first_sl = int(np.argmax(sl_hit)) if sl_hit.any() else None
    first_tp = int(np.argmax(tp_hit)) if tp_hit.any() else None
    if first_sl is not None and (first_tp is None or first_sl <= first_tp):
        return "SL", -SL_PCT, pd.Timestamp(path.times[i0 + first_sl] + 900 * 10**9, tz="UTC")
    if first_tp is not None:
        return "TP", TP_PCT, pd.Timestamp(path.times[i0 + first_tp] + 900 * 10**9, tz="UTC")
    ret = direction * (path.close[i1 - 1] / entry - 1)
    return "TIMEOUT", float(ret), pd.Timestamp(end_ns, tz="UTC")


def run_cell(signal_times: pd.DatetimeIndex, chart_seconds: int, direction: int, path: Path15m) -> pd.DataFrame:
    """Alle Trades einer Zelle, nicht ueberlappend. signal_times = open_time der
    Signal-Kerze; Entry = deren close_time = open_time + Chart-Intervall."""
    rows = []
    busy_until = pd.Timestamp.min.tz_localize("UTC")
    for t in signal_times:
        entry_time = t + pd.Timedelta(seconds=chart_seconds)
        if entry_time < busy_until:
            continue
        sp = split_of(entry_time)
        if sp is None:
            continue
        if split_of(entry_time + HOLD) != sp:
            continue  # Purging an der Split-Grenze
        res = simulate(path, entry_time, direction)
        if res is None:
            continue
        outcome, ret, exit_time = res
        busy_until = exit_time
        rows.append({"signal_time": t, "entry_time": entry_time, "split": sp, "outcome": outcome, "ret": ret, "r": ret / SL_PCT})
    return pd.DataFrame(rows, columns=["signal_time", "entry_time", "split", "outcome", "ret", "r"])


def norm_sf(z: float) -> float:
    return 0.5 * math.erfc(z / math.sqrt(2))


def summarize(trades: pd.DataFrame) -> dict:
    """TP-Rate gegen die Gewinnschwelle 25 % (normalapproximierter, zweiseitiger
    Einstichproben-Test, wie im RSI-Backtest) plus Erwartungswert in R."""
    n = len(trades)
    if n == 0:
        return {"n": 0, "tp_rate": float("nan"), "sl_rate": float("nan"), "timeout_rate": float("nan"), "exp_r": float("nan"), "p": float("nan"), "status": "NO_TRADES"}
    k = int((trades["outcome"] == "TP").sum())
    p0 = BREAKEVEN_TP_RATE
    rate = k / n
    z = (rate - p0) / math.sqrt(p0 * (1 - p0) / n)
    p = min(1.0, 2 * norm_sf(abs(z)))
    return {
        "n": n,
        "tp_rate": rate,
        "sl_rate": float((trades["outcome"] == "SL").mean()),
        "timeout_rate": float((trades["outcome"] == "TIMEOUT").mean()),
        "exp_r": float(trades["r"].mean()),
        "p": p,
        "status": "OK" if n >= 30 else "INSUFFICIENT_DATA",
    }


def bh_fdr(pvalues: list[float], alpha: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg, gibt pro p-Wert zurueck, ob er die Korrektur besteht."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    passed_rank = 0
    for rank, i in enumerate(order, start=1):
        if pvalues[i] <= alpha * rank / m:
            passed_rank = rank
    keep = set(order[:passed_rank])
    return [i in keep for i in range(m)]
