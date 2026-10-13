"""Backtest des Multi-Timeframe-Confluence-Konzepts auf BTCUSDT.

Ablation: alle Varianten sehen dieselben 15m-Rohsignale (Sweep + CHoCH);
sie unterscheiden sich nur darin, welche Filter-Flags sie verlangen. So
laesst sich der Beitrag jedes Bausteins einzeln ablesen.

    python run_backtest.py            # laedt/cached Daten, schreibt output/
"""

from __future__ import annotations

import argparse
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from backtest import simulate
from config import END_MONTH, OOS_START, START_MONTH, CostParams, StrategyParams
from data_loader import load_15m, resample
from metrics import summarize
from signals import features_1h, features_4h, find_setups

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def _score(s) -> int:
    return int(s.zone) + int(s.momentum) + int(s.cvd) + int(s.vol_spike)


# (Name, Filter, TP-Modus)
VARIANTS = [
    ("A  Trigger 15m (Sweep+CHoCH)", lambda s: True, "fixed"),
    ("B  A + Trend 4h", lambda s: s.trend, "fixed"),
    ("C  B + Zone 4h", lambda s: s.trend and s.zone, "fixed"),
    ("B+Momentum 1h", lambda s: s.trend and s.momentum, "fixed"),
    ("B+CVD Spot/Perp", lambda s: s.trend and s.cvd, "fixed"),
    ("B+Vol-Spike 15m", lambda s: s.trend and s.vol_spike, "fixed"),
    ("D  C + Momentum", lambda s: s.trend and s.zone and s.momentum, "fixed"),
    ("E  D + CVD", lambda s: s.trend and s.zone and s.momentum and s.cvd, "fixed"),
    ("F  E + Vol-Spike (Gemini komplett)", lambda s: s.trend and _score(s) == 4, "fixed"),
    ("G  Score: Trend + >=2 von 4", lambda s: s.trend and _score(s) >= 2, "fixed"),
    ("F  Gemini komplett, TP 4h-Level", lambda s: s.trend and _score(s) == 4, "level"),
    ("G  Score >=2, TP 4h-Level", lambda s: s.trend and _score(s) >= 2, "level"),
    ("B  A + Trend 4h, TP 4h-Level", lambda s: s.trend, "level"),
]


def _fmt(stats: dict) -> str:
    def f(x, nd=2):
        return "–" if pd.isna(x) else f"{x:.{nd}f}"

    return (
        f"| {stats['trades']} | {f(stats['win_rate'] * 100 if stats['trades'] else float('nan'), 1)} % "
        f"| {f(stats['avg_r'], 3)} | {f(stats['t_stat'])} | {f(stats['pf'])} | {f(stats['total_r'], 1)} "
        f"| {f(stats['max_dd_r'], 1)} | {f(stats['avg_cost_r'], 3)} |"
    )


HEADER = (
    "| Variante | Trades | Trefferquote | Ø R | t | PF | Summe R | Max DD (R) | Ø Kosten (R) |\n"
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="Daten neu herunterladen")
    args = ap.parse_args()

    p, costs = StrategyParams(), CostParams()
    perp = load_15m("perp", START_MONTH, END_MONTH, refresh=args.refresh)
    spot = load_15m("spot", START_MONTH, END_MONTH, refresh=args.refresh)
    perp_1h, perp_4h, spot_1h = resample(perp, "1h"), resample(perp, "4h"), resample(spot, "1h")

    f4 = features_4h(perp, perp_4h, p)
    f1 = features_1h(perp_1h, spot_1h, p)
    setups = find_setups(perp, f4, f1, p)

    os.makedirs(OUT_DIR, exist_ok=True)
    results = {}
    for name, accept, tp_mode in VARIANTS:
        results[name] = simulate(perp, setups, accept, tp_mode, p, costs)

    oos = pd.Timestamp(OOS_START, tz="UTC")
    lines = [
        "# BTCUSDT Multi-Timeframe-Confluence: Backtest",
        "",
        f"Daten: Binance USDT-M Perpetual (Handel) + Spot (CVD), 15m, {perp.index.min():%Y-%m-%d} bis "
        f"{perp.index.max():%Y-%m-%d}. Rohsignale (Sweep+CHoCH, long+short): {len(setups)}.",
        f"Kosten: {costs.fee_pct_per_side * 100:.3f} % Gebühr + {costs.slippage_pct_per_side * 100:.3f} % "
        "Slippage pro Seite. Ergebnisse in R nach Kosten. t = t-Statistik des Ø R "
        "(|t| < 2: statistisch nicht von 0 unterscheidbar).",
        "",
        "## Gesamt (long + short)",
        "",
        HEADER,
    ]
    for name, tr in results.items():
        lines.append(f"| {name} " + _fmt(summarize(tr)))

    for label, sel in (("In-Sample (bis 2023)", lambda t: t["entry_time"] < oos),
                       ("Out-of-Sample (ab 2024)", lambda t: t["entry_time"] >= oos)):
        lines += ["", f"## {label}", "", HEADER]
        for name, tr in results.items():
            lines.append(f"| {name} " + _fmt(summarize(tr[sel(tr)] if not tr.empty else tr)))

    for direction in ("long", "short"):
        lines += ["", f"## Nur {direction}", "", HEADER]
        for name, tr in results.items():
            lines.append(f"| {name} " + _fmt(summarize(tr[tr["direction"] == direction] if not tr.empty else tr)))

    key = ["B  A + Trend 4h", "G  Score: Trend + >=2 von 4", "F  E + Vol-Spike (Gemini komplett)"]
    lines += ["", "## Pro Jahr (Ø R / Trades)", "", "| Jahr | " + " | ".join(key) + " |",
              "|---|" + "---:|" * len(key)]
    years = sorted({t.year for tr in results.values() if not tr.empty for t in tr["entry_time"]})
    for y in years:
        cells = []
        for k in key:
            tr = results[k]
            sub = tr[tr["entry_time"].dt.year == y] if not tr.empty else tr
            cells.append(f"{sub['r'].mean():.3f} / {len(sub)}" if len(sub) else "– / 0")
        lines.append(f"| {y} | " + " | ".join(cells) + " |")

    with open(os.path.join(OUT_DIR, "backtest_report.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")

    fig, ax = plt.subplots(figsize=(11, 5.5))
    for name in ["A  Trigger 15m (Sweep+CHoCH)", "B  A + Trend 4h", "D  C + Momentum", "G  Score: Trend + >=2 von 4",
                 "F  E + Vol-Spike (Gemini komplett)"]:
        tr = results[name]
        if not tr.empty:
            ax.plot(tr["exit_time"], tr["r"].cumsum(), label=f"{name} ({len(tr)})", linewidth=1.3)
    ax.axvline(oos, color="grey", linestyle="--", linewidth=1)
    ax.axhline(0, color="black", linewidth=0.6)
    ax.set_ylabel("Kumuliertes R nach Kosten")
    ax.set_title("BTCUSDT MTF-Confluence: Equity in R (gestrichelt = Beginn OOS)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "equity_r.png"), dpi=120)

    pd.concat({k: v for k, v in results.items() if not v.empty}, names=["variant"]).to_csv(
        os.path.join(OUT_DIR, "trades.csv")
    )
    print("\n".join(lines))


if __name__ == "__main__":
    main()
