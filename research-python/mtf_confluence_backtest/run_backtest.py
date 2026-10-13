"""Backtest des Multi-Timeframe-Confluence-Konzepts auf BTCUSDT.

Ablation: alle Varianten eines Timeframe-Sets sehen dieselben Rohsignale
(Sweep + CHoCH); sie unterscheiden sich nur darin, welche Filter-Flags sie
verlangen. So laesst sich der Beitrag jedes Bausteins einzeln ablesen.

    python run_backtest.py              # beide Sets (15m/1h/4h und 1h/4h/1D)
    python run_backtest.py --tf 1h      # nur 1h-Einstieg / 4h / 1D
"""

from __future__ import annotations

import argparse
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from backtest import simulate
from config import END_MONTH, OOS_START, START_MONTH, TF_LABELS, TIMEFRAME_SETS, CostParams, StrategyParams
from data_loader import load_15m, resample
from metrics import summarize
from signals import features_high, features_mid, find_setups

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def _score(s) -> int:
    return int(s.zone) + int(s.momentum) + int(s.cvd) + int(s.vol_spike)


def make_variants(rules: dict[str, str]) -> list[tuple[str, str, object, str]]:
    """(Kurz-Code, Name, Filter, TP-Modus). Der Code ist ueber alle
    Timeframe-Sets gleich, damit sich die Sets vergleichen lassen."""
    b, m, h = (TF_LABELS[rules[k]] for k in ("base", "mid", "high"))
    return [
        ("A", f"A  Trigger {b} (Sweep+CHoCH)", lambda s: True, "fixed"),
        ("B", f"B  A + Trend {h}", lambda s: s.trend, "fixed"),
        ("C", f"C  B + Zone {h}", lambda s: s.trend and s.zone, "fixed"),
        ("B+Mom", f"B+Momentum {m}", lambda s: s.trend and s.momentum, "fixed"),
        ("B+CVD", "B+CVD Spot/Perp", lambda s: s.trend and s.cvd, "fixed"),
        ("B+Vol", f"B+Vol-Spike {b}", lambda s: s.trend and s.vol_spike, "fixed"),
        ("D", "D  C + Momentum", lambda s: s.trend and s.zone and s.momentum, "fixed"),
        ("E", "E  D + CVD", lambda s: s.trend and s.zone and s.momentum and s.cvd, "fixed"),
        ("F", "F  E + Vol-Spike (Gemini komplett)", lambda s: s.trend and _score(s) == 4, "fixed"),
        ("G", "G  Score: Trend + >=2 von 4", lambda s: s.trend and _score(s) >= 2, "fixed"),
        ("F-lvl", f"F  Gemini komplett, TP {h}-Level", lambda s: s.trend and _score(s) == 4, "level"),
        ("G-lvl", f"G  Score >=2, TP {h}-Level", lambda s: s.trend and _score(s) >= 2, "level"),
        ("B-lvl", f"B  A + Trend {h}, TP {h}-Level", lambda s: s.trend, "level"),
    ]


def _fmt(stats: dict) -> str:
    def f(x, nd=2):
        return "–" if pd.isna(x) else f"{x:.{nd}f}"

    return (
        f"| {stats['trades']} | {f(stats['win_rate'] * 100 if stats['trades'] else float('nan'), 1)} % "
        f"| {f(stats['avg_gross_r'], 3)} | {f(stats['avg_r'], 3)} | {f(stats['t_stat'])} | {f(stats['pf'])} "
        f"| {f(stats['total_r'], 1)} | {f(stats['max_dd_r'], 1)} | {f(stats['avg_cost_r'], 3)} |"
    )


HEADER = (
    "| Variante | Trades | Trefferquote | Ø R brutto | Ø R netto | t | PF | Summe R | Max DD (R) | Ø Kosten (R) |\n"
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
)


def run_set(tf: str, perp: pd.DataFrame, spot: pd.DataFrame, p: StrategyParams, costs: CostParams) -> dict:
    rules = TIMEFRAME_SETS[tf]
    base = resample(perp, rules["base"])
    perp_mid, spot_mid = resample(perp, rules["mid"]), resample(spot, rules["mid"])
    perp_high = resample(perp, rules["high"])

    f_high = features_high(perp, perp_high, rules["high"], p)
    f_mid = features_mid(perp_mid, spot_mid, p)
    setups = find_setups(base, f_high, f_mid, rules, p)

    variants = make_variants(rules)
    results = {code: simulate(base, setups, accept, tp_mode, p, costs) for code, _, accept, tp_mode in variants}
    names = {code: name for code, name, _, _ in variants}
    label = "/".join(TF_LABELS[rules[k]] for k in ("base", "mid", "high"))
    _write_report(tf, label, base, setups, results, names, costs)
    return {"label": label, "results": results, "names": names}


def _write_report(tf, label, base, setups, results, names, costs) -> None:
    oos = pd.Timestamp(OOS_START, tz="UTC")
    lines = [
        f"# BTCUSDT Multi-Timeframe-Confluence: Backtest {label} (Einstieg/Filter/Trend)",
        "",
        f"Daten: Binance USDT-M Perpetual (Handel) + Spot (CVD), {base.index.min():%Y-%m-%d} bis "
        f"{base.index.max():%Y-%m-%d}. Rohsignale (Sweep+CHoCH, long+short): {len(setups)}.",
        f"Kosten: {costs.fee_pct_per_side * 100:.3f} % Gebühr + {costs.slippage_pct_per_side * 100:.3f} % "
        "Slippage pro Seite. Ergebnisse in R. t = t-Statistik des Ø R netto "
        "(|t| < 2: statistisch nicht von 0 unterscheidbar).",
        "",
        "## Gesamt (long + short)",
        "",
        HEADER,
    ]
    for code, tr in results.items():
        lines.append(f"| {names[code]} " + _fmt(summarize(tr)))

    for title, sel in (("In-Sample (bis 2023)", lambda t: t["entry_time"] < oos),
                       ("Out-of-Sample (ab 2024)", lambda t: t["entry_time"] >= oos)):
        lines += ["", f"## {title}", "", HEADER]
        for code, tr in results.items():
            lines.append(f"| {names[code]} " + _fmt(summarize(tr[sel(tr)] if not tr.empty else tr)))

    for direction in ("long", "short"):
        lines += ["", f"## Nur {direction}", "", HEADER]
        for code, tr in results.items():
            sub = tr[tr["direction"] == direction] if not tr.empty else tr
            lines.append(f"| {names[code]} " + _fmt(summarize(sub)))

    key = ["B", "G", "F"]
    lines += ["", "## Pro Jahr (Ø R netto / Trades)", "", "| Jahr | " + " | ".join(names[k] for k in key) + " |",
              "|---|" + "---:|" * len(key)]
    years = sorted({t.year for tr in results.values() if not tr.empty for t in tr["entry_time"]})
    for y in years:
        cells = []
        for k in key:
            tr = results[k]
            sub = tr[tr["entry_time"].dt.year == y] if not tr.empty else tr
            cells.append(f"{sub['r'].mean():.3f} / {len(sub)}" if len(sub) else "– / 0")
        lines.append(f"| {y} | " + " | ".join(cells) + " |")

    with open(os.path.join(OUT_DIR, f"backtest_report_{tf}.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")

    fig, ax = plt.subplots(figsize=(11, 5.5))
    for code in ["A", "B", "D", "G", "F"]:
        tr = results[code]
        if not tr.empty:
            ax.plot(tr["exit_time"], tr["r"].cumsum(), label=f"{names[code]} ({len(tr)})", linewidth=1.3)
    ax.axvline(oos, color="grey", linestyle="--", linewidth=1)
    ax.axhline(0, color="black", linewidth=0.6)
    ax.set_ylabel("Kumuliertes R nach Kosten")
    ax.set_title(f"BTCUSDT MTF-Confluence {label}: Equity in R (gestrichelt = Beginn OOS)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, f"equity_r_{tf}.png"), dpi=120)
    plt.close(fig)

    non_empty = {names[k]: v for k, v in results.items() if not v.empty}
    if non_empty:
        pd.concat(non_empty, names=["variant"]).to_csv(os.path.join(OUT_DIR, f"trades_{tf}.csv"))
    print("\n".join(lines[:22]))


def _write_comparison(runs: dict) -> None:
    """Gleiche Variante, verschiedene Timeframe-Sets nebeneinander."""
    oos = pd.Timestamp(OOS_START, tz="UTC")
    tfs = list(runs)
    any_names = runs[tfs[0]]["names"]
    lines = [
        "# Vergleich der Timeframe-Sets",
        "",
        "Pro Zelle: Trades · Ø R netto · t. Spalten „OOS“ = nur Trades ab 2024.",
        "",
        "| Variante | " + " | ".join(f"{runs[t]['label']} | {runs[t]['label']} OOS" for t in tfs) + " |",
        "|---|" + "---:|---:|" * len(tfs),
    ]

    def cell(tr):
        s = summarize(tr)
        if not s["trades"]:
            return "0"
        t = "–" if pd.isna(s["t_stat"]) else f"{s['t_stat']:.2f}"
        return f"{s['trades']} · {s['avg_r']:+.3f} · {t}"

    for code in any_names:
        row = []
        for t in tfs:
            tr = runs[t]["results"][code]
            row += [cell(tr), cell(tr[tr["entry_time"] >= oos] if not tr.empty else tr)]
        generic = any_names[code] if len(tfs) == 1 else code
        lines.append(f"| {generic} | " + " | ".join(row) + " |")
    with open(os.path.join(OUT_DIR, "comparison.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tf", choices=[*TIMEFRAME_SETS, "all"], default="all", help="Timeframe-Set (Einstiegs-TF)")
    ap.add_argument("--refresh", action="store_true", help="Daten neu herunterladen")
    args = ap.parse_args()

    p, costs = StrategyParams(), CostParams()
    perp = load_15m("perp", START_MONTH, END_MONTH, refresh=args.refresh)
    spot = load_15m("spot", START_MONTH, END_MONTH, refresh=args.refresh)
    os.makedirs(OUT_DIR, exist_ok=True)

    tfs = list(TIMEFRAME_SETS) if args.tf == "all" else [args.tf]
    runs = {tf: run_set(tf, perp, spot, p, costs) for tf in tfs}
    _write_comparison(runs)


if __name__ == "__main__":
    main()
