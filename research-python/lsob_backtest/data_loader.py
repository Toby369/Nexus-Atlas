"""OHLCV-Datenbeschaffung. Zwei Quellen:

1. CSV (Standardfall in dieser Sandbox -- kein Netzwerkzugriff zu
   Boersen-APIs moeglich, siehe README "Warum CSV statt Live-ccxt-Fetch").
   Erwartetes Dateischema: data/BTCUSDT_<tf>.csv (tf in 15m/1h/4h), Spalten
   flexibel benannt (siehe _normalize_columns), Zeit als Unix-Timestamp
   (s oder ms) oder ISO-String.

2. ccxt (Binance Futures Perpetual) -- nur nutzbar, wenn dieses Skript auf
   einer Maschine mit echtem Netzwerkzugriff laeuft. Hier bewusst nur als
   fertiger, aber in dieser Sandbox ungetesteter Pfad hinterlegt.
"""

from __future__ import annotations

import glob
import os

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SYMBOL = "BTC/USDT:USDT"  # ccxt-Notation fuer Binance USDT-M Perpetual
SYMBOL_FILENAME = "BTCUSDT"

_COLUMN_ALIASES = {
    "open": ["open", "Open", "o"],
    "high": ["high", "High", "h"],
    "low": ["low", "Low", "l"],
    "close": ["close", "Close", "c"],
    "volume": ["volume", "Volume", "vol", "v"],
    "time": ["time", "timestamp", "Timestamp", "date", "Date", "datetime", "Datetime", "open_time"],
}


def _find_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    time_col = _find_column(df, _COLUMN_ALIASES["time"])
    if time_col is None:
        raise ValueError(
            f"Keine Zeit-Spalte gefunden (erwartet eine von {_COLUMN_ALIASES['time']}). "
            f"Vorhandene Spalten: {list(df.columns)}"
        )

    raw_time = df[time_col]
    if pd.api.types.is_numeric_dtype(raw_time):
        # Unix-Timestamp -- Heuristik s vs. ms anhand der Groessenordnung
        # (ms-Timestamps sind fuer heutige Daten > 10^12, s-Timestamps ~10^9).
        unit = "ms" if raw_time.iloc[0] > 10**12 else "s"
        out["time"] = pd.to_datetime(raw_time, unit=unit, utc=True)
    else:
        out["time"] = pd.to_datetime(raw_time, utc=True)

    for target, candidates in _COLUMN_ALIASES.items():
        if target == "time":
            continue
        col = _find_column(df, candidates)
        if col is None:
            if target == "volume":
                out["volume"] = float("nan")  # Volumen optional, nicht Teil der LSOB-Logik
                continue
            raise ValueError(f"Keine Spalte fuer '{target}' gefunden. Vorhandene Spalten: {list(df.columns)}")
        out[target] = df[col].astype(float)

    out = out.set_index("time").sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out[["open", "high", "low", "close", "volume"]]


def load_ohlcv_csv(timeframe: str) -> pd.DataFrame:
    pattern = os.path.join(DATA_DIR, f"{SYMBOL_FILENAME}_{timeframe}.csv")
    matches = glob.glob(pattern)
    if not matches:
        raise FileNotFoundError(
            f"Keine CSV fuer Timeframe '{timeframe}' gefunden (erwartet: {pattern}). "
            f"Siehe README, Abschnitt 'Eigene Daten einspielen'."
        )
    raw = pd.read_csv(matches[0])
    return _normalize_columns(raw)


def load_ohlcv_ccxt(timeframe: str, since_ms: int, until_ms: int | None = None, limit_per_call: int = 1500) -> pd.DataFrame:
    """Nur fuer den Einsatz AUSSERHALB dieser Sandbox (echter Netzwerkzugriff
    zu Binance Futures noetig). Paginiert ueber `since`, bis `until_ms`
    erreicht ist oder keine neuen Kerzen mehr zurueckkommen.
    """
    import ccxt  # Import hier, damit das Modul auch ohne installiertes ccxt importierbar bleibt (CSV-Pfad).

    exchange = ccxt.binance({"options": {"defaultType": "future"}})
    all_rows: list[list[float]] = []
    cursor = since_ms

    while True:
        batch = exchange.fetch_ohlcv(SYMBOL, timeframe=timeframe, since=cursor, limit=limit_per_call)
        if not batch:
            break
        all_rows.extend(batch)
        last_ts = batch[-1][0]
        if last_ts == cursor:
            break  # keine Fortschritt mehr, Abbruch statt Endlosschleife
        cursor = last_ts + 1
        if until_ms is not None and last_ts >= until_ms:
            break
        if len(batch) < limit_per_call:
            break

    raw = pd.DataFrame(all_rows, columns=["time", "open", "high", "low", "close", "volume"])
    return _normalize_columns(raw)


def load_ohlcv(timeframe: str, source: str = "csv", **kwargs) -> pd.DataFrame:
    if source == "csv":
        return load_ohlcv_csv(timeframe)
    if source == "ccxt":
        return load_ohlcv_ccxt(timeframe, **kwargs)
    raise ValueError(f"Unbekannte Datenquelle: {source!r} (erwartet 'csv' oder 'ccxt').")
