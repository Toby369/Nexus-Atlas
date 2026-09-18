"""Report-Erzeugung: Equity-Kurven-Charts, backtest_report.md, CSV-Export
pro Timeframe, Vergleichstabelle aller Timeframes.
"""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")  # Headless-Sandbox, kein Display verfuegbar.
import matplotlib.pyplot as plt
import pandas as pd

from backtest import Trade, trades_to_dataframe
from config import BacktestParams, LsobParams, TIMEFRAMES
from metrics import BucketMetrics, bucket_metrics_to_dataframe
from momentum_filter import MomentumFilterParams

_COLOR_LONG = "#2E7D32"
_COLOR_SHORT = "#C62828"
_COLOR_UNFILTERED = "#9E9E9E"
_COLOR_FILTERED = "#1565C0"


def plot_equity_curves(
    trades_by_bucket: dict[tuple[str, str], list[Trade]],
    initial_equity: float,
    output_path: str,
) -> None:
    fig, axes = plt.subplots(len(TIMEFRAMES), 1, figsize=(9, 3.2 * len(TIMEFRAMES)), sharex=False)
    if len(TIMEFRAMES) == 1:
        axes = [axes]

    for ax, tf in zip(axes, TIMEFRAMES):
        for direction, color in (("long", _COLOR_LONG), ("short", _COLOR_SHORT)):
            trades = trades_by_bucket.get((tf, direction), [])
            if not trades:
                continue
            xs = [trades[0].entry_time] + [t.exit_time for t in trades]
            ys = [initial_equity] + [t.equity_after for t in trades]
            ax.plot(xs, ys, label=direction, color=color, linewidth=1.4)

        ax.axhline(initial_equity, color="gray", linewidth=0.8, linestyle="--")
        ax.set_title(f"Equity-Kurve {tf}")
        ax.set_ylabel("Equity")
        ax.legend(loc="upper left", fontsize=8)
        ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def export_trades_csv(trades_by_bucket: dict[tuple[str, str], list[Trade]], output_dir: str) -> dict[str, str]:
    paths: dict[str, str] = {}
    for tf in TIMEFRAMES:
        rows = []
        for direction in ("long", "short"):
            df = trades_to_dataframe(trades_by_bucket.get((tf, direction), []))
            if not df.empty:
                df.insert(0, "timeframe", tf)
                rows.append(df)
        combined = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
        path = os.path.join(output_dir, f"trades_{tf}.csv")
        combined.to_csv(path, index=False)
        paths[tf] = path
    return paths


def _fmt(value: float, digits: int = 2, suffix: str = "") -> str:
    if value is None or (isinstance(value, float) and (pd.isna(value))):
        return "–"
    if value == float("inf"):
        return "∞"
    return f"{value:.{digits}f}{suffix}"


def plot_momentum_filter_comparison(
    trades_by_bucket: dict[tuple[str, str], list[Trade]],
    filtered_trades_by_bucket: dict[tuple[str, str], list[Trade]],
    initial_equity: float,
    output_path: str,
) -> None:
    fig, axes = plt.subplots(len(TIMEFRAMES), 2, figsize=(11, 3.4 * len(TIMEFRAMES)), sharex=False)

    def _curve(trades):
        if not trades:
            return [], []
        xs = [trades[0].entry_time] + [t.exit_time for t in trades]
        ys = [initial_equity] + [t.equity_after for t in trades]
        return xs, ys

    for row, tf in enumerate(TIMEFRAMES):
        for col, direction in enumerate(("long", "short")):
            ax = axes[row, col]
            xs, ys = _curve(trades_by_bucket.get((tf, direction), []))
            if xs:
                ax.plot(xs, ys, label="Alle LSOB-Signale", color=_COLOR_UNFILTERED, linewidth=1.0, alpha=0.85)
            xs, ys = _curve(filtered_trades_by_bucket.get((tf, direction), []))
            if xs:
                ax.plot(xs, ys, label="MACD+RSI-bestätigt", color=_COLOR_FILTERED, linewidth=1.6)

            ax.axhline(initial_equity, color="gray", linewidth=0.8, linestyle="--")
            ax.set_title(f"{tf} — {direction}")
            ax.legend(loc="upper left", fontsize=7)
            ax.grid(alpha=0.25)

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def _metrics_table_md(metrics: list[BucketMetrics]) -> str:
    header = (
        "| Timeframe | Richtung | Trades | Winrate | Profit Factor | Ø Gewinn | Ø Verlust | "
        "Total Return | Max Drawdown | Sharpe (Trade) | Sharpe (approx. p.a.) |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|\n"
    )
    rows = []
    for m in metrics:
        rows.append(
            f"| {m.timeframe} | {m.direction} | {m.trades} | {_fmt(m.winrate_pct, 1, '%')} | "
            f"{_fmt(m.profit_factor, 2)} | {_fmt(m.avg_win, 2)} | {_fmt(m.avg_loss, 2)} | "
            f"{_fmt(m.total_return_pct, 1, '%')} | {_fmt(m.max_drawdown_pct, 1, '%')} | "
            f"{_fmt(m.sharpe_per_trade, 2)} | {_fmt(m.sharpe_annualized_approx, 2)} |"
        )
    return header + "\n".join(rows)


def _filter_comparison_table_md(metrics: list[BucketMetrics], filtered_metrics: list[BucketMetrics]) -> str:
    filtered_by_key = {(m.timeframe, m.direction): m for m in filtered_metrics}
    header = (
        "| Timeframe | Richtung | Variante | Trades | Winrate | Profit Factor | Total Return | Max Drawdown |\n"
        "|---|---|---|---|---|---|---|---|\n"
    )
    rows = []
    for m in metrics:
        fm = filtered_by_key[(m.timeframe, m.direction)]
        rows.append(
            f"| {m.timeframe} | {m.direction} | Alle LSOB-Signale | {m.trades} | {_fmt(m.winrate_pct, 1, '%')} | "
            f"{_fmt(m.profit_factor, 2)} | {_fmt(m.total_return_pct, 1, '%')} | {_fmt(m.max_drawdown_pct, 1, '%')} |"
        )
        rows.append(
            f"| {m.timeframe} | {m.direction} | MACD+RSI-bestätigt | {fm.trades} | {_fmt(fm.winrate_pct, 1, '%')} | "
            f"{_fmt(fm.profit_factor, 2)} | {_fmt(fm.total_return_pct, 1, '%')} | {_fmt(fm.max_drawdown_pct, 1, '%')} |"
        )
    return header + "\n".join(rows)


def write_report_md(
    metrics: list[BucketMetrics],
    lsob_params: LsobParams,
    bt_params: BacktestParams,
    data_ranges: dict[str, tuple[pd.Timestamp, pd.Timestamp]],
    output_path: str,
    equity_chart_relpath: str,
    filtered_metrics: list[BucketMetrics] | None = None,
    momentum_params: MomentumFilterParams | None = None,
    filtered_chart_relpath: str | None = None,
) -> None:
    lines: list[str] = []
    lines.append("# LSOB-Rekonstruktion: Backtest-Report\n")
    lines.append(
        "Backtest der in `LSOB_Rekonstruktion.pine` beschriebenen Liquidity-Sweep-Order-Block-Logik "
        "(eigene Nachbildung, kein Original-Indikator) auf BTC/USDT Perpetual (Binance Futures), "
        "getrennt nach Timeframe und Richtung.\n"
    )

    lines.append("## Datenbasis\n")
    for tf, (start, end) in data_ranges.items():
        lines.append(f"- **{tf}**: {start} bis {end}")
    lines.append("")

    lines.append("## LSOB-Parameter (1:1 aus der Pine-Datei)\n")
    lines.append(f"- Pivot Length: {lsob_params.pivot_len}")
    lines.append(f"- Box Invalidation Tolerance: {lsob_params.box_invalid_tol_pc}%")
    lines.append(f"- Re-Test Tolerance: {lsob_params.retest_tol_pc}%")
    lines.append(f"- Strict Wick Invalidation: {lsob_params.strict_wick_inval}")
    lines.append(f"- Max Wick Penetration: {lsob_params.max_wick_pen_pc}%")
    lines.append(f"- Max History Bars: {lsob_params.max_history_bars}\n")

    lines.append("## Backtest-Annahmen (NICHT aus der Pine-Datei -- eigene Festlegung)\n")
    lines.append(f"- CRV (Reward:Risk): 1:{bt_params.crv}")
    lines.append(f"- SL-Puffer über/unter Rejection-Wick: {bt_params.sl_buffer_pc}%")
    lines.append(f"- Fee pro Seite (Taker): {bt_params.fee_pct_per_side * 100}%")
    lines.append(f"- Risiko pro Trade: {bt_params.risk_per_trade_pct}% des Equity (je Bucket unabhängig)")
    lines.append(f"- Start-Equity je Bucket: {bt_params.initial_equity}\n")

    lines.append("## Ergebnisse pro Timeframe & Richtung\n")
    lines.append(_metrics_table_md(metrics) + "\n")

    lines.append("## Equity-Kurven\n")
    lines.append(f"![Equity-Kurven]({equity_chart_relpath})\n")

    if filtered_metrics is not None and momentum_params is not None:
        lines.append("## Zusätzlicher Filter: MACD-Crossover + RSI (Nutzer-Vorgabe, aus Erfahrung)\n")
        lines.append(
            "Nicht jedes valide LSOB-Signal wird gehandelt -- zusätzlich muss ein Momentum-Filter "
            "bestätigen (siehe momentum_filter.py):\n"
        )
        lines.append(
            f"- Long nur wenn MACD-Linie über der Signal-Linie liegt UND RSI({momentum_params.rsi_period}) > 50."
        )
        lines.append(
            f"- Short nur wenn MACD-Linie unter der Signal-Linie liegt UND RSI({momentum_params.rsi_period}) < 50."
        )
        lines.append(
            f"- MACD({momentum_params.macd_fast}/{momentum_params.macd_slow}/{momentum_params.macd_signal}), "
            "beide Indikatoren auf der Confirmation-Kerze selbst geprüft (kein Blick auf spätere Bars).\n"
        )
        lines.append(_filter_comparison_table_md(metrics, filtered_metrics) + "\n")
        if filtered_chart_relpath:
            lines.append(f"![MACD+RSI-Filter-Vergleich]({filtered_chart_relpath})\n")

    lines.append("## Kritische Einordnung\n")
    lines.append(
        "- **Overfitting-Risiko**: Die Parameter (Pivot Length, Toleranzen, Max Wick Penetration) "
        "stammen 1:1 aus einer manuell in TradingView konfigurierten Einstellung, nicht aus einer "
        "auf diesen Daten optimierten Suche -- das reduziert klassisches In-Sample-Overfitting, "
        "schützt aber nicht davor, dass diese Werte selbst schon (bewusst oder unbewusst) an "
        "vergangenem BTC-Kursverhalten kalibriert wurden. Kein Train/Test-Split, kein Walk-Forward "
        "in diesem Report -- die Kennzahlen sind eine EINZELNE In-Sample-Auswertung über den "
        "gesamten Datenzeitraum.\n"
    )
    lines.append(
        "- **Pivot-Erkennung ist nachlaufend**: `ta.pivothigh`/`ta.pivotlow` bestätigen einen "
        f"Pivot erst {lsob_params.pivot_len} Bars NACHDEM er entstanden ist (hier exakt so "
        "nachgebildet, siehe pivots.py) -- das System reagiert also strukturell verzögert auf "
        "Marktstruktur-Wechsel, nicht in Echtzeit.\n"
    )
    lines.append(
        "- **Backtest ≠ Live-Performance-Garantie**: keine Slippage über die reine Fee hinaus, keine "
        "Order-Ablehnung/Teilausführung, keine Berücksichtigung von Funding-Zahlungen bei gehaltenen "
        "Perpetual-Positionen, SL/TP werden idealisiert exakt zum Level ausgeführt. Bei Kollision "
        "von SL und TP in derselben Kerze wird konservativ SL angenommen -- die Realität könnte "
        "hier abweichen (siehe backtest.py `_resolve_exit`).\n"
    )
    lines.append(
        "- **Getrennte Kapitalpools**: jede Timeframe/Richtung-Kombination simuliert mit einem "
        "eigenen, unabhängigen Start-Equity -- in der Realität würde sich ein einzelnes Konto "
        "Kapital über alle gleichzeitig offenen Positionen teilen. Die hier gezeigten Total-Return-/"
        "Drawdown-Werte sind daher NICHT direkt auf ein einzelnes Portfolio übertragbar, sondern "
        "isolieren die Signalqualität je Bucket.\n"
    )
    lines.append(
        "- **Sharpe Ratio auf Trade-Ebene**: berechnet aus der Rendite-Verteilung einzelner Trades, "
        "nicht aus einer gleichmäßig getakteten Zeitreihe -- die klassische Sharpe-Definition ist "
        "für unregelmäßig getaktete Ereignisse nur eine Näherung. Die 'approx. p.a.'-Spalte skaliert "
        "grob mit der beobachteten Trade-Frequenz und ist als Orientierung, nicht als exakte Kennzahl "
        "zu verstehen.\n"
    )
    lines.append(
        "- **Retest/Rejection/Confirmation sind EIN einzelner Bar**: beim Portieren zeigte sich, dass "
        "die drei Bedingungen im Original-Pine-Code auf DERSELBEN Kerze geprüft werden (kein "
        "Mehr-Kerzen-Zustandsautomat) -- dieser Backtest bildet genau das nach. Wer die Prosa-"
        "Beschreibung ('Retest → Rejection-Kerze → Confirmation-Kerze') als drei getrennte Kerzen "
        "erwartet hat, sollte diesen Unterschied kennen (siehe lsob_engine.py).\n"
    )
    if filtered_metrics is not None:
        lines.append(
            "- **MACD+RSI-Filter reduziert die Stichprobe spürbar**: weniger Trades bedeutet auch "
            "weniger statistische Aussagekraft der Kennzahlen -- eine bessere Winrate bei deutlich "
            "weniger Trades kann ebenso gut Zufall sein wie ein echter Effekt. Kein eigener Walk-"
            "Forward-Test für diesen Filter in diesem Report (siehe crv_walk_forward.py für das "
            "Muster, falls gewünscht).\n"
        )

    with open(output_path, "w") as f:
        f.write("\n".join(lines))
