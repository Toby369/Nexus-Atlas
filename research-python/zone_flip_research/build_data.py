"""Baut data/BTCUSDT_<tf>.csv aus den Binance-Archiv-Zips (data/raw)."""
import csv, io, sys, zipfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
RAW = HERE / "data" / "raw"
for tf in ("1h", "4h", "1d"):
    rows = {}
    for z in sorted(RAW.glob(f"BTCUSDT-{tf}-*.zip")):
        with zipfile.ZipFile(z) as zf:
            for name in zf.namelist():
                for r in csv.reader(io.TextIOWrapper(zf.open(name), "utf-8")):
                    if not r or not r[0].isdigit():
                        continue  # Kopfzeile
                    t = int(r[0]); t = t // 1000 if t > 10**14 else t  # us -> ms
                    rows[t] = (t, r[1], r[2], r[3], r[4], r[5], r[7], r[9])
    out = HERE / "data" / f"BTCUSDT_{tf}.csv"
    with out.open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["open_time_ms","open","high","low","close","volume","quote_volume","taker_buy_volume"])
        for t in sorted(rows): w.writerow(rows[t])
    print(tf, len(rows))
