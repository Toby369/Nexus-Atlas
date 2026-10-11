"""Fuehrt den Momentum-Radar-Backtest aus (Phase 2,
docs/research/MOMENTUM-RADAR-PLAN_2026-10-11.md).

Aufruf: python run_backtest.py <datenverzeichnis>
Erwartet btc_15m.csv, btc_1h.csv, btc_4h.csv, btc_1d.csv (Spalten ts, open,
high, low, close, volume; Export aus Supabase `candles`, binance BTCUSDT Perp).
Schreibt output/cells.csv und output/trades.csv (gitignored).

Pre-registriert (vor dem ersten Blick auf den Test-Split festgelegt):
- PRIMAER: grosser Punkt, Long/Short getrennt, je 15m/1h/4h = 6 Zellen,
  eigene BH-FDR-Familie, Default-Einstellungen des Radars (kein Trendfilter).
- SEKUNDAER (eigene BH-Familie, 24 Zellen): kleiner Punkt, jeder Punkt,
  grosser Punkt + Trendfilter EMA50 (4h), grosser Punkt + Trendfilter Struktur (4h).
- BASELINE (deskriptiv): durchgehend im Markt, Einstieg stuendlich, gleiche
  Barrieren -- zeigt die reine Marktdrift-TP-Rate je Richtung und Split.
"""

from __future__ import annotations

import os
import sys

import pandas as pd

from backtest import Path15m, bh_fdr, run_cell, summarize
from radar import TF_SECONDS, load_ohlcv, radar_signals

CHART_TFS = ("15m", "1h", "4h")


def cell_definitions(sig: pd.DataFrame) -> dict[tuple[str, str], tuple[pd.Series, pd.Series]]:
    """Variante -> (Long-Maske, Short-Maske)."""
    return {
        ("primary", "big"): (sig["bull_big"], sig["bear_big"]),
        ("secondary", "small"): (sig["bull_dot"] & ~sig["bull_big"], sig["bear_dot"] & ~sig["bear_big"]),
        ("secondary", "any_dot"): (sig["bull_dot"], sig["bear_dot"]),
        ("secondary", "big_ema50_4h"): (sig["bull_big"] & (sig["ema_dir_4h"] > 0), sig["bear_big"] & (sig["ema_dir_4h"] < 0)),
        ("secondary", "big_bos_4h"): (sig["bull_big"] & (sig["bos_dir_4h"] > 0), sig["bear_big"] & (sig["bos_dir_4h"] < 0)),
    }


def main(data_dir: str) -> None:
    frames = {tf: load_ohlcv(os.path.join(data_dir, f"btc_{tf}.csv")) for tf in ("15m", "1h", "4h", "1d")}
    path = Path15m.from_df(frames["15m"])
    warmup_end = frames["15m"].index[0] + pd.Timedelta(days=60)  # Anlaufzeit aller EMAs/SMAs inkl. 1d

    cells = []
    trades_all = []
    for tf in CHART_TFS:
        sig = radar_signals(tf, frames)
        sig = sig[sig.index >= warmup_end]
        for (family, variant), (long_mask, short_mask) in cell_definitions(sig).items():
            for direction, mask in ((1, long_mask), (-1, short_mask)):
                times = sig.index[mask.fillna(False).to_numpy()]
                tr = run_cell(times, TF_SECONDS[tf], direction, path)
                tr["tf"], tr["variant"], tr["direction"] = tf, variant, "LONG" if direction > 0 else "SHORT"
                trades_all.append(tr)
                for split in ("train", "validation", "test"):
                    s = summarize(tr[tr["split"] == split])
                    cells.append({"family": family, "variant": variant, "tf": tf, "direction": "LONG" if direction > 0 else "SHORT", "split": split, "signals": int(len(times)), **s})

    # Baseline: durchgehend im Markt, stuendlicher Einstieg
    hourly = frames["1h"].index[frames["1h"].index >= warmup_end]
    for direction in (1, -1):
        tr = run_cell(hourly - pd.Timedelta(hours=1), 3600, direction, path)
        for split in ("train", "validation", "test"):
            s = summarize(tr[tr["split"] == split])
            cells.append({"family": "baseline", "variant": "always_in", "tf": "1h", "direction": "LONG" if direction > 0 else "SHORT", "split": split, "signals": int(len(hourly)), **s})

    df = pd.DataFrame(cells)
    df["bh_pass"] = False
    for family in ("primary", "secondary"):
        sel = (df["family"] == family) & (df["split"] == "test") & (df["status"] == "OK")
        df.loc[sel, "bh_pass"] = bh_fdr(df.loc[sel, "p"].tolist())

    os.makedirs("output", exist_ok=True)
    df.to_csv("output/cells.csv", index=False)
    pd.concat(trades_all, ignore_index=True).to_csv("output/trades.csv", index=False)
    with pd.option_context("display.width", 220, "display.max_rows", 500):
        print(df.to_string(index=False, float_format=lambda x: f"{x:.4f}"))


if __name__ == "__main__":
    main(sys.argv[1])
