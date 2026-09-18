"""Report-Erzeugung fuer die CRV-Walk-Forward-Validierung: Fold-Tabelle je
Bucket, Vergleich Walk-Forward-Auswahl vs. feste CRV-Baselines, Equity-Chart.
"""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from config import TIMEFRAMES
from crv_walk_forward import CRV_CANDIDATES, WalkForwardResult
from metrics import compute_bucket_metrics

_COLORS = {"walk_forward": "#1565C0", 1.5: "#9E9E9E", 2.0: "#EF6C00", 3.0: "#6A1B9A"}


def _fmt(value: float, digits: int = 2, suffix: str = "") -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "–"
    if value == float("inf"):
        return "∞"
    return f"{value:.{digits}f}{suffix}"


def _fold_table_md(result: WalkForwardResult) -> str:
    header = (
        "| Fold | Train | Test | IS Return 1:1.5 | IS Return 1:2 | IS Return 1:3 | Gewählt | OOS-Trades |\n"
        "|---|---|---|---|---|---|---|---|\n"
    )
    rows = []
    for f in result.folds:
        train_range = f"{f.train_start.date()} – {f.train_end.date()}"
        test_range = f"{f.test_start.date()} – {f.test_end.date()}"
        r15 = _fmt(f.is_return_pct_by_crv.get(1.5), 1, "%")
        r20 = _fmt(f.is_return_pct_by_crv.get(2.0), 1, "%")
        r30 = _fmt(f.is_return_pct_by_crv.get(3.0), 1, "%")
        rows.append(
            f"| {f.fold} | {train_range} | {test_range} | {r15} | {r20} | {r30} | "
            f"1:{f.selected_crv} | {len(f.oos_trades)} |"
        )
    return header + "\n".join(rows)


def _comparison_row_md(label: str, trades, initial_equity: float, timeframe: str, direction: str) -> str:
    m = compute_bucket_metrics(timeframe, direction, trades, initial_equity)
    return (
        f"| {label} | {m.trades} | {_fmt(m.winrate_pct, 1, '%')} | {_fmt(m.profit_factor, 2)} | "
        f"{_fmt(m.total_return_pct, 1, '%')} | {_fmt(m.max_drawdown_pct, 1, '%')} |"
    )


def write_crv_walk_forward_report(
    results_by_bucket: dict[tuple[str, str], WalkForwardResult],
    baselines_by_bucket: dict[tuple[str, str], dict[float, list]],
    initial_equity: float,
    output_path: str,
    chart_relpath: str,
) -> None:
    lines: list[str] = []
    lines.append("# CRV-Walk-Forward-Validierung (1:1.5 / 1:2 / 1:3)\n")
    lines.append(
        "Statt einer einzelnen In-Sample-Auswahl wird die CRV pro Fold NUR auf Basis des "
        "(gepurgten) Train-Fensters gewählt und dann auf das zeitlich anschließende, davon "
        "unberührte Test-Fenster angewendet. Die gezeigte Out-of-Sample-Equity-Kurve ist über "
        "alle Folds durchgehend (kein Reset pro Fold) -- das ist die ehrliche Antwort auf "
        "\"was hätte eine walk-forward-validierte CRV-Wahl gebracht\", im Vergleich zu einer "
        "fest gewählten CRV über den ganzen Zeitraum.\n"
    )

    for tf in TIMEFRAMES:
        for direction in ("long", "short"):
            result = results_by_bucket[(tf, direction)]
            lines.append(f"## {tf} — {direction}\n")
            lines.append("### Folds\n")
            lines.append(_fold_table_md(result) + "\n")

            lines.append("### Out-of-Sample-Vergleich (gleiche Test-Fenster für alle Zeilen)\n")
            comparison_rows = [
                _comparison_row_md("Walk-Forward (gewählt)", result.oos_trades_chained, initial_equity, tf, direction)
            ]
            for crv in CRV_CANDIDATES:
                trades = baselines_by_bucket[(tf, direction)][crv]
                comparison_rows.append(_comparison_row_md(f"Fest 1:{crv}", trades, initial_equity, tf, direction))
            comparison_table = (
                "| Variante | Trades | Winrate | Profit Factor | Total Return | Max Drawdown |\n"
                "|---|---|---|---|---|---|\n" + "\n".join(comparison_rows)
            )
            lines.append(comparison_table + "\n")

    lines.append("## Equity-Kurven (Out-of-Sample, durchgehend über alle Folds)\n")
    lines.append(f"![CRV-Walk-Forward-Equity-Kurven]({chart_relpath})\n")

    lines.append("## Einordnung\n")
    lines.append(
        "- **Trade-Anzahl pro Fold ist klein** (besonders bei 4h, teils einstellig im Train-Fenster) "
        "-- die IS-Auswahl \"beste CRV\" ist bei so wenig Trades statistisch schwach, nicht mehr als "
        "ein grober Hinweis. Das gilt umso mehr fuer fruehe Folds mit kurzem Train-Fenster.\n"
    )
    lines.append(
        "- **Kein Embargo verwendet**: anders als im ML-Modell-Research dieses Repos "
        "(`src/validation/walk_forward.py`) gibt es hier kein gefittetes Feature, das rueckwirkend "
        "Test-Perioden-Information in ein spaeteres Train-Fenster tragen koennte -- das trade-genaue "
        "Purging (Entry UND Exit im Train-Fenster) deckt das relevante Leck bereits ab.\n"
    )
    lines.append(
        "- **Auswahlkriterium ist Total Return, nicht Profit Factor**: bei sehr wenigen Trades kann "
        "Profit Factor durch einen einzelnen Gewinn ohne Verlust auf ∞ springen und wuerde die Auswahl "
        "dominieren, ohne dass das aussagekraeftig waere -- Total Return ist hier die robustere Wahl, "
        "bleibt aber ebenfalls small-N-verrauscht.\n"
    )
    lines.append(
        "- **Weiterhin eine einzelne Datenreihe (BTC/USDT, 13 Monate)**: Walk-Forward schuetzt vor "
        "In-Sample-Auswahl-Bias, NICHT davor, dass diese 13 Monate selbst ein bestimmtes Marktregime "
        "waren, das sich nicht wiederholt.\n"
    )

    with open(output_path, "w") as f:
        f.write("\n".join(lines))


def plot_crv_walk_forward_curves(
    results_by_bucket: dict[tuple[str, str], WalkForwardResult],
    baselines_by_bucket: dict[tuple[str, str], dict[float, list]],
    initial_equity: float,
    output_path: str,
) -> None:
    fig, axes = plt.subplots(len(TIMEFRAMES), 2, figsize=(11, 3.4 * len(TIMEFRAMES)), sharex=False)

    for row, tf in enumerate(TIMEFRAMES):
        for col, direction in enumerate(("long", "short")):
            ax = axes[row, col]
            result = results_by_bucket[(tf, direction)]

            def _curve(trades):
                if not trades:
                    return [], []
                xs = [trades[0].entry_time] + [t.exit_time for t in trades]
                ys = [initial_equity] + [t.equity_after for t in trades]
                return xs, ys

            xs, ys = _curve(result.oos_trades_chained)
            if xs:
                ax.plot(xs, ys, label="Walk-Forward", color=_COLORS["walk_forward"], linewidth=1.8)

            for crv in CRV_CANDIDATES:
                xs, ys = _curve(baselines_by_bucket[(tf, direction)][crv])
                if xs:
                    ax.plot(xs, ys, label=f"Fest 1:{crv}", color=_COLORS[crv], linewidth=1.0, alpha=0.8)

            ax.axhline(initial_equity, color="gray", linewidth=0.8, linestyle="--")
            ax.set_title(f"{tf} — {direction} (Out-of-Sample)")
            ax.legend(loc="upper left", fontsize=7)
            ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
