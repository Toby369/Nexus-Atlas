"""Folge-Backtest (Toby, 11.10.2026: "ja" zu beiden Vorschlaegen nach Phase 2).

Aufruf: python run_followup.py <datenverzeichnis>   -> output/followup_cells.csv

Pre-registriert (vor dem ersten Lauf festgelegt, keine Anpassung danach):

FAMILIE A -- Punkt + VWAP-Vector-Level (Mo's Anleitung Kapitel 6, Schritte 2-3):
  Punkt am Kerzenschluss -> Limit-Order am naechsten VWAP-Vector-Level in Trade-
  Richtung (Long: hoechstes Level unter dem Kurs, Short: tiefstes darueber).
  Varianten: Punkt {gross, jeder} x Reichweite {0,5 %, 1,0 %} x TF {15m, 1h, 4h}
  x Richtung = 24 Zellen, eine BH-FDR-Familie. Order gueltig 8 Chart-Kerzen.
  Kein Level in Reichweite = kein Trade. Danach Tobys Setup (TP 1,5 / SL 0,5 / 48 h).
  BASELINE A0 (deskriptiv): dieselbe Limit-Logik stuendlich OHNE Radar-Punkt --
  zeigt, ob der Punkt etwas zum reinen "Kauf am VWAP-Level" beitraegt.

FAMILIE B -- uebrige Radar-Signale mit Markt-Entry am naechsten Open (wie Phase 2):
  Raute (H4), Divergenz auf der Welle (H6), Geldfluss-Divergenz (H5)
  x TF {15m, 1h, 4h} x Richtung = 18 Zellen, eine BH-FDR-Familie.
  Schienen-Divergenzen sind darin enthalten: die Schienen-Divergenz einer hoeheren
  Zeitebene H im Chart C feuert mit der ersten C-Kerze nach dem H-Schluss -- der
  Entry am naechsten Open faellt damit auf denselben Zeitpunkt wie die
  Divergenz auf dem H-Chart selbst.
"""

from __future__ import annotations

import os
import sys

import pandas as pd

from backtest import Path15m, bh_fdr, run_cell, run_limit_cell, summarize
from radar import TF_SECONDS, load_ohlcv, radar_signals, secondary_signals
from vwap_vector import vwap_levels

CHART_TFS = ("15m", "1h", "4h")
REACHES = (0.005, 0.010)
VALID_BARS = 8


def main(data_dir: str) -> None:
    frames = {tf: load_ohlcv(os.path.join(data_dir, f"btc_{tf}.csv")) for tf in ("15m", "1h", "4h", "1d")}
    path = Path15m.from_df(frames["15m"])
    levels = vwap_levels(frames["15m"], frames["1h"])
    close_15m = pd.Series(frames["15m"]["close"].to_numpy(), index=levels.index)
    warmup_end = frames["15m"].index[0] + pd.Timedelta(days=60)
    cells = []

    def add(family, variant, tf, direction, tr, extra):
        filled = tr[tr["outcome"].isin(["TP", "SL", "TIMEOUT"])]
        for split in ("train", "validation", "test"):
            sub_all = tr[tr["split"] == split]
            s = summarize(filled[filled["split"] == split])
            cells.append({"family": family, "variant": variant, "tf": tf, "direction": direction, "split": split,
                          "orders_or_signals": int(len(sub_all)), "nolevel": int((sub_all["outcome"] == "NOLEVEL").sum()),
                          "nofill": int((sub_all["outcome"] == "NOFILL").sum()), **extra, **s})

    for tf in CHART_TFS:
        sig = radar_signals(tf, frames)
        sec = secondary_signals(frames[tf], sig)
        keep = sig.index >= warmup_end
        sig, sec = sig[keep], sec[keep]
        step = pd.Timedelta(seconds=TF_SECONDS[tf])
        valid = step * VALID_BARS
        close_times = sig.index + step
        for variant, (lm, sm) in {"big": (sig["bull_big"], sig["bear_big"]), "any_dot": (sig["bull_dot"], sig["bear_dot"])}.items():
            for reach in REACHES:
                for d, m in ((1, lm), (-1, sm)):
                    tr = run_limit_cell(close_times[m.to_numpy()], d, path, levels, close_15m, reach, valid)
                    add("A_vwap_combo", f"{variant}_reach{reach*100:.1f}", tf, "LONG" if d > 0 else "SHORT", tr, {})
        for name in ("raute", "div", "mfdiv"):
            for d, col in ((1, f"{name}_long"), (-1, f"{name}_short")):
                times = sig.index[sec[col].to_numpy()]
                tr = run_cell(times, TF_SECONDS[tf], d, path)
                add("B_secondary", name, tf, "LONG" if d > 0 else "SHORT", tr, {})

    # Baseline A0: stuendlich, ohne Radar-Punkt
    hourly_close = frames["1h"].index[frames["1h"].index >= warmup_end] + pd.Timedelta(hours=1)
    for reach in REACHES:
        for d in (1, -1):
            tr = run_limit_cell(hourly_close, d, path, levels, close_15m, reach, pd.Timedelta(hours=8))
            add("A0_baseline", f"level_only_reach{reach*100:.1f}", "1h", "LONG" if d > 0 else "SHORT", tr, {})

    df = pd.DataFrame(cells)
    df["bh_pass"] = False
    for fam in ("A_vwap_combo", "B_secondary"):
        sel = (df["family"] == fam) & (df["split"] == "test") & (df["status"] == "OK")
        df.loc[sel, "bh_pass"] = bh_fdr(df.loc[sel, "p"].tolist())
    os.makedirs("output", exist_ok=True)
    df.to_csv("output/followup_cells.csv", index=False)
    cols = ["family", "variant", "tf", "direction", "split", "orders_or_signals", "nolevel", "nofill", "n", "tp_rate", "exp_r", "p", "status", "bh_pass"]
    with pd.option_context("display.width", 250, "display.max_rows", 500):
        print(df[cols].to_string(index=False, float_format=lambda x: f"{x:.3f}"))


if __name__ == "__main__":
    main(sys.argv[1])
