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


def simulate_limit(path: Path15m, place_time: pd.Timestamp, level: float, direction: int, valid: pd.Timedelta) -> tuple[str, float, pd.Timestamp, pd.Timestamp] | None:
    """Limit-Order am VWAP-Vector-Level (Mo's Anleitung, Schritt 3: "Dorthin die
    Order"). Gueltig ab place_time fuer `valid`. Fuellung, sobald eine 15m-Kerze das
    Level erreicht; oeffnet sie schon jenseits des Levels, wird zum Open gefuellt.
    In der Fuell-Kerze zaehlt nur der SL (konservativ: ob TP vor oder nach der
    Fuellung lag, ist unbekannt), TP erst ab der Folgekerze.

    Rueckgabe (Ausgang, Rendite, Fuellzeit, Ausstiegszeit); Ausgang "NOFILL", wenn
    das Level nicht erreicht wurde; None, wenn Daten fuer das Fenster fehlen."""
    i0 = int(np.searchsorted(path.times, place_time.value))
    i_end = int(np.searchsorted(path.times, (place_time + valid).value))
    if i_end >= len(path.times):
        return None
    if direction > 0:
        touched = path.low[i0:i_end] <= level
    else:
        touched = path.high[i0:i_end] >= level
    if not touched.any():
        return "NOFILL", 0.0, place_time, place_time + valid
    fi = i0 + int(np.argmax(touched))
    entry = min(path.open[fi], level) if direction > 0 else max(path.open[fi], level)
    fill_time = pd.Timestamp(path.times[fi], tz="UTC")
    tp = entry * (1 + direction * TP_PCT)
    sl = entry * (1 - direction * SL_PCT)
    if (direction > 0 and path.low[fi] <= sl) or (direction < 0 and path.high[fi] >= sl):
        return "SL", -SL_PCT, fill_time, fill_time + pd.Timedelta(minutes=15)
    end_ns = (fill_time + HOLD).value
    i1 = int(np.searchsorted(path.times, end_ns))
    if i1 >= len(path.times):
        return None
    hi = path.high[fi + 1 : i1]
    lo = path.low[fi + 1 : i1]
    sl_hit = lo <= sl if direction > 0 else hi >= sl
    tp_hit = hi >= tp if direction > 0 else lo <= tp
    first_sl = int(np.argmax(sl_hit)) if sl_hit.any() else None
    first_tp = int(np.argmax(tp_hit)) if tp_hit.any() else None
    if first_sl is not None and (first_tp is None or first_sl <= first_tp):
        return "SL", -SL_PCT, fill_time, pd.Timestamp(path.times[fi + 1 + first_sl] + 900 * 10**9, tz="UTC")
    if first_tp is not None:
        return "TP", TP_PCT, fill_time, pd.Timestamp(path.times[fi + 1 + first_tp] + 900 * 10**9, tz="UTC")
    ret = direction * (path.close[i1 - 1] / entry - 1)
    return "TIMEOUT", float(ret), fill_time, pd.Timestamp(end_ns, tz="UTC")


def run_limit_cell(signal_close_times: pd.DatetimeIndex, direction: int, path: Path15m, levels: pd.DataFrame,
                   close_15m: pd.Series, reach: float, valid: pd.Timedelta) -> pd.DataFrame:
    """Signal am Schluss einer Chart-Kerze (signal_close_times) -> Limit-Order am
    naechsten Level in Reichweite. Nicht ueberlappend: waehrend eine Order offen oder
    ein Trade aktiv ist, werden neue Signale ignoriert. Kein Level in Reichweite =
    kein Trade (Mo: "Kein brauchbares Level in Reichweite = kein Trade")."""
    from vwap_vector import nearest_level

    lv = levels.to_numpy()
    lv_index = levels.index
    rows = []
    busy_until = pd.Timestamp.min.tz_localize("UTC")
    for t in signal_close_times:
        if t < busy_until:
            continue
        sp = split_of(t)
        if sp is None or split_of(t + valid + HOLD) != sp:
            continue
        k = lv_index.searchsorted(t)
        if k >= len(lv_index) or lv_index[k] != t:
            continue
        price = close_15m.iloc[k]
        level = nearest_level(lv[k], price, direction, reach)
        if level is None:
            rows.append({"signal_time": t, "split": sp, "outcome": "NOLEVEL", "ret": 0.0, "r": 0.0})
            continue
        res = simulate_limit(path, t, level, direction, valid)
        if res is None:
            continue
        outcome, ret, fill_time, exit_time = res
        busy_until = exit_time
        rows.append({"signal_time": t, "split": sp, "outcome": outcome, "ret": ret, "r": ret / SL_PCT})
    return pd.DataFrame(rows, columns=["signal_time", "split", "outcome", "ret", "r"])
