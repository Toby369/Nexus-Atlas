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
        "- **WICHTIG -- Total Return nahe -100% ist ein Fee-/Positionsgrößen-Artefakt, KEIN Urteil "
        "über die Signalqualität**: Auf 1m/5m kann der Docht der Ausbruchskerze selbst (= SL-"
        "Abstand bei dieser Strategie) extrem klein werden -- im hier verwendeten Datensatz teils "
        "unter 1 USD bei einem BTC-Preis von über 60000 USD. Eine reine \"riskiere fix 1% Equity\"-"
        "Positionsgrößen-Regel würde in diesem Fall eine absurd große Notional-Position verlangen. "
        "Der `max_leverage`-Deckel (10x, `config.py`) verhindert zwar die vollständige Kontovernich"
        "tung durch einen EINZELNEN solchen Trade (ohne Deckel: Total Return exakt -100% in jedem "
        "Bucket bereits nach wenigen Trades) -- er löst das Grundproblem aber nicht: Sobald der "
        "Deckel greift, ist die Positionsgröße NICHT MEHR vom (winzigen) SL-Abstand abhängig, "
        "sondern fix bei `max_leverage * Equity / Preis`. Die dadurch anfallenden Fees "
        "(2 x Taker-Fee auf diese fixe Notional) sind bei diesem Preis-Niveau UNABHÄNGIG davon, ob "
        "der Trade gewinnt oder verliert, groesser als der durch den winzigen Preis-Abstand "
        "erzielbare Brutto-Gewinn -- das Ergebnis ist ein garantierter kleiner Netto-Verlust auf "
        "praktisch JEDEM gedeckelten Trade (siehe Tabelle oben: Ø Netto-Return der gedeckelten "
        "Trades liegt konsistent um ca. -1.2%, unabhängig von Gewinn/Verlust-Ausgang), der sich "
        "über tausende Trades multiplikativ zu einem Totalverlust aufsummiert. Auf 1m betrifft das "
        "die deutliche Mehrheit aller Trades (siehe Anteil in der Tabelle) -- **diese Strategie ist "
        "unter dieser exakten SL-Regel (Docht der eigenen Ausbruchskerze) und einer realistischen "
        "Taker-Fee von 0.06%/Seite auf 1m/5m mit fixem Prozent-Risiko-Sizing strukturell nicht "
        "handelbar**, selbst wenn die zugrunde liegende SR-Ausbruchs-Logik gerichtete Substanz "
        "hätte. Das ist ein Befund über das Zusammenspiel von SL-Regel, Timeframe und Fee-Struktur "
        "-- kein Bug im Backtest und keine erfundene Zusatzregel: Es wurde keine Mindest-SL-Distanz "
        "oder sonstige Filterung der Signale eingeführt, um dieses Problem zu verdecken. Die "
        "Rohsignal-Qualität (R-Multiple, siehe Tabelle unten) ist DESHALB die aussagekräftigere "
        "Kennzahl für die reine SR-Ausbruchs-Logik dieser Strategie auf 1m/5m -- die Netto-Equity-"
        "Kennzahlen oben sind für diese Timeframes praktisch nicht interpretierbar.\n"
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
        "- **1m/5m-Timeframes sind besonders anfällig für Fee- und Slippage-Verzerrung**: bei sehr "
        "kurzen Timeframes machen 0.06% Fee pro Seite (0.12% Round-Trip) einen relativ größeren "
        "Anteil der typischen Kursbewegung pro Trade aus als auf 15m/1h/4h -- die hier gezeigten "
        "Netto-Kennzahlen reagieren empfindlicher auf die Fee-Annahme als im LSOB-Backtest.\n"
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
