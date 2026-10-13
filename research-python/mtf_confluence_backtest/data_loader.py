"""BTCUSDT-15m-Klines von data.binance.vision (Spot + USDT-M Perpetual).

Binance-Klines enthalten pro Kerze das Taker-Buy-Volumen. Daraus ergibt sich
das exakte Taker-Delta der Kerze:

    delta = taker_buy - (volume - taker_buy) = 2 * taker_buy - volume

Die kumulierte Summe ist der CVD -- ohne Tick-Daten, aber auch nicht
geschaetzt (anders als TradingViews Lower-Timeframe-Naeherung).

Die Monats-ZIPs werden unter data/raw/ gecacht, die zusammengefuehrten
Reihen als data/BTCUSDT_<market>_15m.csv.
"""

from __future__ import annotations

import io
import os
import urllib.request
import zipfile

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
SYMBOL = "BTCUSDT"

_BASE_URL = {
    "spot": "https://data.binance.vision/data/spot/monthly/klines",
    "perp": "https://data.binance.vision/data/futures/um/monthly/klines",
}
_COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy", "taker_buy_quote", "ignore",
]


def _month_range(start: str, end: str) -> list[str]:
    return [p.strftime("%Y-%m") for p in pd.period_range(start, end, freq="M")]


def _download_month(market: str, month: str, interval: str = "15m") -> bytes:
    os.makedirs(RAW_DIR, exist_ok=True)
    name = f"{SYMBOL}-{interval}-{month}.zip"
    path = os.path.join(RAW_DIR, f"{market}_{name}")
    if not os.path.exists(path):
        url = f"{_BASE_URL[market]}/{SYMBOL}/{interval}/{name}"
        with urllib.request.urlopen(url, timeout=60) as resp:
            payload = resp.read()
        with open(path, "wb") as fh:
            fh.write(payload)
    with open(path, "rb") as fh:
        return fh.read()


def parse_kline_zip(payload: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        with zf.open(zf.namelist()[0]) as fh:
            raw = pd.read_csv(fh, header=None, names=_COLUMNS)
    # Futures-Dateien haben teils eine Kopfzeile, Spot nicht.
    raw = raw[pd.to_numeric(raw["open_time"], errors="coerce").notna()]
    return normalize_klines(raw)


def normalize_klines(raw: pd.DataFrame) -> pd.DataFrame:
    ts = raw["open_time"].astype("int64")
    # Spot-Dateien ab 2025 liefern Mikrosekunden statt Millisekunden.
    ts = ts.where(ts < 10**14, ts // 1000)
    out = pd.DataFrame(
        {
            "open": raw["open"].astype(float).to_numpy(),
            "high": raw["high"].astype(float).to_numpy(),
            "low": raw["low"].astype(float).to_numpy(),
            "close": raw["close"].astype(float).to_numpy(),
            "volume": raw["volume"].astype(float).to_numpy(),
            "taker_buy": raw["taker_buy"].astype(float).to_numpy(),
        },
        index=pd.to_datetime(ts.to_numpy(), unit="ms", utc=True),
    )
    out.index.name = "time"
    out["delta"] = 2 * out["taker_buy"] - out["volume"]
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def load_15m(market: str, start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Laedt 15m-Klines (Index = Open-Time UTC) fuer `market` in {spot, perp}."""
    cache = os.path.join(DATA_DIR, f"{SYMBOL}_{market}_15m.csv")
    if os.path.exists(cache) and not refresh:
        df = pd.read_csv(cache, index_col="time", parse_dates=["time"])
        if df.index.min() <= pd.Timestamp(f"{start}-01", tz="UTC") and df.index.max() >= pd.Timestamp(
            f"{end}-01", tz="UTC"
        ):
            return df.loc[f"{start}-01":]
    frames = [parse_kline_zip(_download_month(market, m)) for m in _month_range(start, end)]
    df = pd.concat(frames).sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df.to_csv(cache)
    return df


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Aggregiert 15m-Kerzen zu `rule` (z.B. '1h', '4h'). Index = Open-Time.
    Unvollstaendige Kerzen (fehlende 15m-Bars) werden verworfen."""
    agg = df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last",
         "volume": "sum", "taker_buy": "sum", "delta": "sum"}
    )
    expected = pd.Timedelta(rule) // pd.Timedelta("15min")
    counts = df["close"].resample(rule, label="left", closed="left").count()
    return agg[counts == expected].dropna()
