"""Report-Erzeugung: Equity-Kurven-Chart, backtest_report.md, CSV-Export
pro Timeframe. Struktur identisch zu lsob_backtest/report.py, ohne den dort
vorhandenen MACD+RSI-Vergleichsabschnitt (fuer "Old Money Stack" nicht
angefragt).
"""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")  # Headless-Sandbox, kein Display verfuegbar.
import matplotlib.pyplot as plt
import pandas as pd

from backtest import Trade, trades_to_dataframe
from config import BacktestParams, OmsParams, TIMEFRAMES
from metrics import BucketMetrics

_COLOR_LONG = "#2E7D32"
_COLOR_SHORT = "#C62828"


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


def _breakeven_share_table_md(trades_by_bucket: dict[tuple[str, str], list[Trade]]) -> str:
    header = (
        "| Timeframe | Richtung | Trades gesamt | davon Break-Even ausgestoppt | Anteil |\n"
        "|---|---|---|---|---|\n"
    )
    rows = []
    for tf in TIMEFRAMES:
        for direction in ("long", "short"):
            trades = trades_by_bucket.get((tf, direction), [])
            n = len(trades)
            be = sum(1 for t in trades if t.exit_reason == "breakeven")
            share = (be / n * 100) if n else float("nan")
            rows.append(f"| {tf} | {direction} | {n} | {be} | {_fmt(share, 1, '%')} |")
    return header + "\n".join(rows)


def _leverage_cap_share_table_md(trades_by_bucket: dict[tuple[str, str], list[Trade]]) -> str:
    header = (
        "| Timeframe | Richtung | Trades gesamt | davon Hebel-gedeckelt | Anteil | "
        "Ø Netto-Return dieser Trades |\n"
        "|---|---|---|---|---|---|\n"
    )
    rows = []
    for tf in TIMEFRAMES:
        for direction in ("long", "short"):
            trades = trades_by_bucket.get((tf, direction), [])
            n = len(trades)
            capped_trades = [t for t in trades if t.leverage_capped]
            capped = len(capped_trades)
            share = (capped / n * 100) if n else float("nan")
            avg_capped_return = (
                sum(t.net_return_pct for t in capped_trades) / capped * 100 if capped else float("nan")
            )
            rows.append(
                f"| {tf} | {direction} | {n} | {capped} | {_fmt(share, 1, '%')} | "
                f"{_fmt(avg_capped_return, 2, '%')} |"
            )
    return header + "\n".join(rows)


def _fee_drag_table_md(trades_by_bucket: dict[tuple[str, str], list[Trade]]) -> str:
    header = (
        "| Timeframe | Nicht Hebel-gedeckelt (n) | Ø Netto-Return dieser Trades | "
        "Median SL-Abstand (% vom Preis) |\n"
        "|---|---|---|---|\n"
    )
    rows = []
    for tf in TIMEFRAMES:
        not_capped = [t for t in trades_by_bucket.get((tf, "long"), []) + trades_by_bucket.get((tf, "short"), []) if not t.leverage_capped]
        n = len(not_capped)
        avg_return = sum(t.net_return_pct for t in not_capped) / n * 100 if n else float("nan")
        risk_pcts = sorted((t.risk_price_distance / t.entry_price * 100) for t in not_capped)
        median_risk_pct = risk_pcts[len(risk_pcts) // 2] if risk_pcts else float("nan")
        rows.append(f"| {tf} | {n} | {_fmt(avg_return, 3, '%')} | {_fmt(median_risk_pct, 3, '%')} |")
    return header + "\n".join(rows)


def _raw_signal_quality_table_md(metrics: list[BucketMetrics]) -> str:
    header = (
        "| Timeframe | Richtung | Trades | Ø R-Multiple (brutto, ohne Fees) | Anteil R > 0 |\n"
        "|---|---|---|---|---|\n"
    )
    rows = []
    for m in metrics:
        rows.append(
            f"| {m.timeframe} | {m.direction} | {m.trades} | {_fmt(m.avg_r_multiple_gross, 3)} | "
            f"{_fmt(m.pct_positive_r_multiple, 1, '%')} |"
        )
    return header + "\n".join(rows)


def write_report_md(
    metrics: list[BucketMetrics],
    trades_by_bucket: dict[tuple[str, str], list[Trade]],
    oms_params: OmsParams,
    bt_params: BacktestParams,
    data_ranges: dict[str, tuple[pd.Timestamp, pd.Timestamp]],
    output_path: str,
    equity_chart_relpath: str,
) -> None:
    lines: list[str] = []
    lines.append("# Old Money Stack: Backtest-Report\n")
    lines.append(
        "Backtest der von Toby beschriebenen \"Old Money Stack\"-Breakout-Strategie (Claudius "
        "Vertesi, Support/Resistance-Ausbruch auf niedrigen Timeframes) auf BTC/USDT Perpetual "
        "(Binance Futures), getrennt nach Timeframe und Richtung. Eigene Nachbildung nach "
        "Nutzer-Bericht, kein Original-Indikator.\n"
    )

    lines.append("## Datenbasis\n")
    for tf, (start, end) in data_ranges.items():
        lines.append(f"- **{tf}**: {start} bis {end}")
    lines.append("")

    lines.append("## Strategie-Parameter (1:1 aus dem Nutzer-Bericht)\n")
    lines.append(f"- Pivot Length (auf CLOSE, nicht High/Low): {oms_params.pivot_length}")
    lines.append(f"- Mindest-Body-Anteil jenseits der SR-Linie: {oms_params.body_out_threshold * 100:.0f}%")
    lines.append(f"- Max. Docht-Anteil in Ausbruchsrichtung: {oms_params.max_wick_ratio * 100:.0f}%")
    lines.append(f"- Max. Kerzengroesse vs. SMA({oms_params.range_sma_period}) der Range: {oms_params.max_candle_multiplier}x\n")

    lines.append("## Backtest-Annahmen (eigene, dokumentierte Festlegung)\n")
    lines.append(f"- CRV (Reward:Risk): 1:{bt_params.crv} (Nutzer-bestaetigt, wie bei LSOB: \"1:2 passt\")")
    lines.append(f"- Break-Even-Schwelle: {bt_params.be_threshold_pct * 100:.0f}% des Wegs von Entry zu TP")
    lines.append(f"- Fee pro Seite (Taker): {bt_params.fee_pct_per_side * 100}%")
    lines.append(f"- Risiko pro Trade: {bt_params.risk_per_trade_pct}% des Equity (je Bucket unabhängig)")
    lines.append(f"- Start-Equity je Bucket: {bt_params.initial_equity}")
    lines.append(
        f"- Max. Hebel (Positions-Notional als Vielfaches des Equity): {bt_params.max_leverage}x -- "
        "siehe \"Kritische Einordnung\" unten, warum dieser Deckel notwendig war.\n"
    )

    lines.append("## Ergebnisse pro Timeframe & Richtung\n")
    lines.append(_metrics_table_md(metrics) + "\n")

    lines.append("## Break-Even-Anteil\n")
    lines.append(
        "Anteil der Trades, die nicht am urspruenglichen SL, sondern am nachgezogenen "
        "Break-Even-Stop (Entry-Preis) ausgestoppt wurden -- diese zaehlen in der Kennzahlen-"
        "Tabelle oben als \"Verlust\" (Netto meist leicht negativ durch Fees), sind aber keine "
        "vollen SL-Verluste.\n"
    )
    lines.append(_breakeven_share_table_md(trades_by_bucket) + "\n")

    lines.append("## Hebel-Deckel-Anteil\n")
    lines.append(
        "Anteil der Trades, bei denen der SL-Abstand (Docht der Ausbruchskerze) so klein war, dass "
        "die reine Ziel-Risiko-Regel (1% Equity) den Hebel-Deckel überschritten hätte -- diese "
        "Trades riskieren dadurch WENIGER als das Ziel-Risiko (siehe \"Kritische Einordnung\").\n"
    )
    lines.append(_leverage_cap_share_table_md(trades_by_bucket) + "\n")

    lines.append("## Fee-Drag auch bei NICHT gedeckelten Trades\n")
    lines.append(
        "Selbst Trades, die NICHT vom Hebel-Deckel betroffen waren, verlieren im Schnitt Geld -- "
        "das Fee/Risiko-Verhältnis ist bei den typischen SL-Abständen dieser Strategie (Docht der "
        "Ausbruchskerze) auf allen drei Timeframes ungünstig, nicht nur bei den extrem engen "
        "1m-Ausreißern. Siehe \"Kritische Einordnung\" für die Einordnung.\n"
    )
    lines.append(_fee_drag_table_md(trades_by_bucket) + "\n")

    lines.append("## Rohsignal-Qualität (ohne Fees/Positionsgrößen-Modell)\n")
    lines.append(
        "Rein preisbasierte Kennzahlen (R-Multiple aus Entry/Exit-Preisen, KEINE Fees, KEINE "
        "Positionsgrößen-Effekte) -- zeigt, ob die reine SR-Ausbruchs-Logik selbst gerichtete "
        "Substanz hat, unabhängig vom Fee-/Hebel-Problem unten. R=0 bei Break-Even-Exit, R=-1 bei "
        "vollem SL, R=+2 bei vollem TP (CRV 1:2).\n"
    )
    lines.append(_raw_signal_quality_table_md(metrics) + "\n")

    lines.append("## Equity-Kurven\n")
    lines.append(f"![Equity-Kurven]({equity_chart_relpath})\n")

    lines.append("## Kritische Einordnung\n")
    lines.append(
        "- **WICHTIG -- Total Return nahe -100% auf ALLEN DREI Timeframes ist primär ein "
        "Fee/Risiko-Verhältnis-Problem der SL-Regel selbst, kein reines 1m/5m-Mikrostruktur-"
        "Artefakt**: Ursprüngliche Annahme war, dass nur extrem enge Dochte auf 1m/5m (teils unter "
        "1 USD bei einem BTC-Preis über 60000 USD) das Problem verursachen -- der Test auf 15m "
        "(Nutzer-Wunsch, nachdem 1m/5m so nicht handelbar waren) zeigt aber: Auch auf 15m, wo nur "
        "noch ein kleiner Teil der Trades ueberhaupt den Hebel-Deckel erreicht (siehe Tabelle "
        "oben), bleibt der Total Return nahe -100%. Der Grund liegt tiefer: Diese Strategie setzt "
        "den SL exakt an den Docht der eigenen Ausbruchskerze -- das ist strukturell ein ENGER "
        "Stop (Median-SL-Abstand ueber alle drei Timeframes zwischen 0.13% und 0.28% des Preises, "
        "siehe Tabelle \"Fee-Drag auch bei NICHT gedeckelten Trades\"). Bei einer fixen "
        "Prozent-Risiko-Positionsgroesse (1% Equity) und einer taker-typischen Fee von 0.06% pro "
        "Seite (0.12% Round-Trip) macht die Fee bei einem SL-Abstand von z.B. 0.26% des Preises "
        "bereits ca. 2*0.06%/0.26% ≈ 46% des eingesetzten Ziel-Risikos aus -- UNABHÄNGIG davon, ob "
        "der Trade gewinnt oder verliert, und UNABHÄNGIG vom Hebel-Deckel. Genau das zeigt sich in "
        "den Daten: SELBST die nicht gedeckelten Trades verlieren im Schnitt Geld auf allen drei "
        "Timeframes (siehe Tabelle oben, -0.48% bis -0.87% Ø Netto-Return je Trade), was sich ueber "
        "hunderte bis tausende Trades multiplikativ zu einem Totalverlust aufsummiert. Der "
        "Hebel-Deckel (10x, `config.py`) verhindert nur die KATASTROPHALE Sofort-Vernichtung durch "
        "einen einzelnen Sub-Cent-Wick-Trade (ohne Deckel: garantiert -100% nach wenigen solchen "
        "Trades) -- er behebt aber nicht das Grundproblem, dass diese SL-Regel + Fee-Struktur + "
        "Prozent-Risiko-Sizing zusammen bei JEDEM Timeframe einen negativen Erwartungswert "
        "erzeugen, VOR jeder Betrachtung der eigentlichen Trefferquote der SR-Logik. **Diese "
        "Strategie ist unter dieser exakten SL-Regel (Docht der eigenen Ausbruchskerze) und einer "
        "realistischen Taker-Fee von 0.06%/Seite mit fixem Prozent-Risiko-Sizing auf keinem der "
        "drei getesteten Timeframes profitabel handelbar** -- unabhaengig davon, wie gut die "
        "zugrunde liegende SR-Ausbruchs-Logik selbst waere. Das ist ein Befund über das "
        "Zusammenspiel von SL-Regel, Fee-Struktur und Positionsgrößen-Modell -- kein Bug im "
        "Backtest und keine erfundene Zusatzregel: Es wurde keine Mindest-SL-Distanz oder sonstige "
        "Filterung der Signale eingeführt, um dieses Problem zu verdecken. Die Rohsignal-Qualität "
        "(R-Multiple, siehe Tabelle unten) ist DESHALB die aussagekräftigere Kennzahl für die reine "
        "SR-Ausbruchs-Logik dieser Strategie -- sie zeigt uebrigens selbst OHNE das Fee-Problem nur "
        "eine sehr moderate, nahe-neutrale Substanz (Ø R zwischen -0.03 und +0.12, siehe unten), "
        "sodass ein realistischer Fee-Abzug diese ohnehin schon schwache Kante zusaetzlich "
        "auffrisst. Die Netto-Equity-Kennzahlen oben sind fuer alle drei Timeframes praktisch nicht "
        "interpretierbar als Handelsergebnis.\n"
    )
    lines.append(
        "- **Overfitting-Risiko**: Die Parameter stammen aus dem Nutzer-Bericht zu einer fremden "
        "Strategie (Claudius Vertesi), nicht aus einer auf diesen Daten optimierten Suche -- das "
        "reduziert klassisches In-Sample-Overfitting-Risiko durch eigene Parameter-Wahl. Kein "
        "Train/Test-Split, kein Walk-Forward in diesem Report -- die Kennzahlen sind eine EINZELNE "
        "In-Sample-Auswertung über den gesamten Datenzeitraum.\n"
    )
    lines.append(
        "- **Pivot-Erkennung ist nachlaufend UND auf CLOSE statt High/Low**: "
        f"`ta.pivothigh`/`ta.pivotlow` bestätigen einen Pivot erst {oms_params.pivot_length} Bars "
        "NACHDEM er entstanden ist (siehe pivots.py). Zusätzlich werden hier CLOSE-Preise statt "
        "High/Low pivotiert (Nutzer-Vorgabe) -- SR-Linien liegen dadurch strukturell näher am "
        "Kurs als bei einer High/Low-basierten Pivot-Erkennung, reagieren aber genauso verzögert.\n"
    )
    lines.append(
        "- **SR-Linien-Persistenz-Regel und ihre Konsequenz für den Abstands-Check**: Nutzer-"
        "Entscheidung war \"nur die jeweils zuletzt bestätigte Resistance und Support gleichzeitig "
        "aktiv\" (wie LSOB's lastPH/lastPL). Der im Strategie-Bericht genannte Abstands-Check "
        "(\"genug Platz bis zur nächsten SR-Linie für CRV 1:2\") kann unter dieser Regel NIE "
        "greifen -- die einzige andere verfolgte Linie liegt immer HINTER dem Kurs (sie wurde ja "
        "gerade durchbrochen), nie davor in Zielrichtung. Das Filter ist damit unter der gewählten "
        "Regel technisch immer erfüllt; TP ist in diesem Backtest praktisch immer der feste "
        f"1:{bt_params.crv}-Wert, nie eine näher liegende SR-Linie. Bewusst nicht extra "
        "implementiert (siehe oms_engine.py-Docstring) -- es hätte unter dieser Wahl keinen "
        "Unterschied gemacht.\n"
    )
    lines.append(
        "- **Backtest ≠ Live-Performance-Garantie**: keine Slippage über die reine Fee hinaus, keine "
        "Order-Ablehnung/Teilausführung, keine Funding-Zahlungen bei gehaltenen Perpetual-"
        "Positionen, SL/TP/Break-Even werden idealisiert exakt zum Level ausgeführt. Bei Kollision "
        "von SL/Break-Even-Stop und TP in derselben Kerze wird konservativ der Stop angenommen; "
        "das Nachziehen des Stops auf Break-Even wirkt erst ab der Bar NACH Erreichen der Schwelle "
        "(siehe backtest.py `_resolve_exit_with_be`) -- beides sind eigene, dokumentierte "
        "Konventionen zur Vermeidung von Intrabar-Ordnungs-Ambiguität, keine Pine-Vorgabe.\n"
    )
    lines.append(
        "- **Getrennte Kapitalpools**: jede Timeframe/Richtung-Kombination simuliert mit einem "
        "eigenen, unabhängigen Start-Equity -- in der Realität würde sich ein einzelnes Konto "
        "Kapital über alle gleichzeitig offenen Positionen teilen, und auf 1m/5m können sehr viele "
        "Signale zeitlich überlappen. Die hier gezeigten Total-Return-/Drawdown-Werte sind daher "
        "NICHT direkt auf ein einzelnes Portfolio übertragbar, sondern isolieren die Signalqualität "
        "je Bucket.\n"
    )
    lines.append(
        "- **Sharpe Ratio auf Trade-Ebene**: berechnet aus der Rendite-Verteilung einzelner Trades, "
        "nicht aus einer gleichmäßig getakteten Zeitreihe -- für unregelmäßig getaktete Ereignisse "
        "nur eine Näherung. Die 'approx. p.a.'-Spalte skaliert grob mit der beobachteten "
        "Trade-Frequenz und ist als Orientierung, nicht als exakte Kennzahl zu verstehen.\n"
    )

    with open(output_path, "w") as f:
        f.write("\n".join(lines))
