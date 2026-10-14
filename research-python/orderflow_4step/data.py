"""Datenexport aus Supabase (oeffentlich lesbare Tabellen) und Laden der CSVs.

Export: `python -m orderflow_4step.data` aus research-python/. Braucht
SUPABASE_URL und SUPABASE_KEY (oeffentlicher anon-/publishable-Key, dieselben
Werte wie NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY der App). Die CSVs sind nicht
eingecheckt (Groesse); `data/MANIFEST.txt` haelt Zeilenzahl und SHA256 fest,
damit ein spaeterer Lauf pruefen kann, ob er auf denselben Daten rechnet.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"
PAGE_SIZE = 1000  # PostgREST-Deckel dieses Projekts
CANDLE_COLUMNS = "open_time,open,high,low,close,volume,taker_buy_base_vol"
INTERVALS = ("15m", "1h", "4h")


def _get(base_url: str, key: str, path: str, params: dict[str, str]) -> list[dict]:
    url = f"{base_url}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read())
        except Exception:  # noqa: BLE001 -- Netzwerkfehler: mit Backoff wiederholen
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
    return []


def _fetch_all(base_url: str, key: str, path: str, params: dict[str, str], time_col: str) -> pd.DataFrame:
    """Keyset-Paginierung ueber die Zeitspalte (stabil, kein OFFSET)."""
    rows: list[dict] = []
    last: str | None = None
    while True:
        page_params = dict(params, order=f"{time_col}.asc", limit=str(PAGE_SIZE))
        if last is not None:
            page_params[time_col] = f"gt.{last}"
        page = _get(base_url, key, path, page_params)
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        last = page[-1][time_col]
    return pd.DataFrame(rows)


def export(base_url: str, key: str) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    manifest = []
    for interval in INTERVALS:
        df = _fetch_all(
            base_url, key, "candles",
            {"select": CANDLE_COLUMNS, "exchange": "eq.binance", "symbol": "eq.BTCUSDT", "interval": f"eq.{interval}"},
            "open_time",
        )
        manifest.append(_write(df, f"BTCUSDT_{interval}.csv"))
    funding = _fetch_all(
        base_url, key, "research_funding_rate_history", {"select": "funding_time,funding_rate"}, "funding_time"
    )
    manifest.append(_write(funding, "funding.csv"))
    structure = _fetch_all(
        base_url, key, "market_features",
        {"select": "candle_open_time,structure_trend", "symbol": "eq.BTCUSDT", "interval": "eq.1h"},
        "candle_open_time",
    )
    manifest.append(_write(structure, "market_features_1h_structure.csv"))
    (DATA_DIR / "MANIFEST.txt").write_text("\n".join(manifest) + "\n")
    print("\n".join(manifest))


def export_candles_only(base_url: str, key: str, intervals: tuple[str, ...]) -> None:
    """Nur zusaetzliche Kerzen-Intervalle exportieren (z. B. 1d fuer Variante C),
    ohne die bestehenden Dateien zu ueberschreiben. Haengt an MANIFEST.txt an."""
    lines = []
    for interval in intervals:
        df = _fetch_all(
            base_url, key, "candles",
            {"select": CANDLE_COLUMNS, "exchange": "eq.binance", "symbol": "eq.BTCUSDT", "interval": f"eq.{interval}"},
            "open_time",
        )
        lines.append(_write(df, f"BTCUSDT_{interval}.csv"))
    with open(DATA_DIR / "MANIFEST.txt", "a") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def _write(df: pd.DataFrame, name: str) -> str:
    path = DATA_DIR / name
    df.to_csv(path, index=False)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"{name}\t{len(df)}\t{digest}"


def load_candles(interval: str) -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / f"BTCUSDT_{interval}.csv")
    df["open_time"] = pd.to_datetime(df["open_time"], utc=True, format="ISO8601")
    df = df.set_index("open_time").sort_index()
    return df.astype(float)


def load_funding() -> pd.Series:
    df = pd.read_csv(DATA_DIR / "funding.csv")
    df["funding_time"] = pd.to_datetime(df["funding_time"], utc=True, format="ISO8601")
    # Funding-Zeitpunkte auf die volle Stunde runden (Binance liefert ms-Versatz)
    df["funding_time"] = df["funding_time"].dt.round("h")
    return df.set_index("funding_time")["funding_rate"].astype(float).sort_index()


def load_stored_structure() -> pd.Series:
    """structure_trend (1h) wie in market_features gespeichert -- nur fuer den Abgleich."""
    df = pd.read_csv(DATA_DIR / "market_features_1h_structure.csv")
    df["candle_open_time"] = pd.to_datetime(df["candle_open_time"], utc=True, format="ISO8601")
    return df.set_index("candle_open_time")["structure_trend"].sort_index()


if __name__ == "__main__":
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL und SUPABASE_KEY setzen (oeffentlicher anon-/publishable-Key).")
    extra = sys.argv[1:]  # z. B. "1d": nur diese Intervalle zusaetzlich exportieren
    if extra:
        export_candles_only(url.rstrip("/"), key, tuple(extra))
    else:
        export(url.rstrip("/"), key)
