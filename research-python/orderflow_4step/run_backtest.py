"""Ablation V0-V4, Hypothesentests und Sensitivitaet (Protokoll Abschnitte 6-8, Nachtrag 2).

Aufruf aus research-python/ (einmaliger Bestaetigungslauf, Nachtrag 2 Punkt 5):
    python -m orderflow_4step.run_backtest --report <pfad.md>

Laeuft nur bei sauberem Git-Arbeitsbaum und schreibt den Commit-Hash in den
Bericht. `--smoke` (nur fuer Entwicklung) erlaubt einen schmutzigen Baum,
rechnet 2 V0-Laeufe und schreibt nichts aus.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.stats.multitest import multipletests

from orderflow_4step import config as C
from orderflow_4step.signals import (
    Dataset, build_setups, ensure_output_dir, in_split, mirror_regime, mirrored, random_setups, select_variant,
)
from orderflow_4step.simulate import Bars, daily_r, run_chain, trades_frame
from src.validation.block_bootstrap import moving_block_bootstrap
from src.validation.walk_forward import compute_pbo

VARIANTS = ("V1", "V2", "V3", "V4")
MODE = {"target": C.TARGET_MODE, "tf": C.TF_15M}  # per --target-mode / --timeframe gesetzt


def run_variant(ds: Dataset, bars: Bars, setups: pd.DataFrame, variant: str) -> pd.DataFrame:
    chosen = select_variant(setups, variant)
    return trades_frame(run_chain(bars, ds.funding, chosen, ds.swing_highs, daily_rule=variant == "V4",
                                 funding_fallback=ds.funding_fallback, anchor=ds.tf.anchor,
                                 timeout_bars=ds.tf.timeout_bars))


def one_sided_p(values: np.ndarray, seed: int) -> tuple[float, float, float, float]:
    """Block-Bootstrap des Mittelwerts gegen 0, einseitig (H1: Mittel > 0).

    Zentrierter Pivot-Test wie in block_bootstrap.py, nur einseitig:
    p = Anteil der Replikate mit (rep - obs) >= (obs - 0).
    """
    res = moving_block_bootstrap(
        n_obs=len(values),
        statistic_fn=lambda ix: float(values[ix].mean()),
        baseline=0.0,
        seed=seed,
        block_length=C.BOOTSTRAP_BLOCK_DAYS,
        n_replicates=C.BOOTSTRAP_REPLICATES,
    )
    dist = res.bootstrap_distribution
    dist = dist[np.isfinite(dist)]
    p = float(np.mean(dist - res.observed_statistic >= res.observed_statistic))
    return res.observed_statistic, res.ci_lower, res.ci_upper, p


def describe(trades: pd.DataFrame, days: pd.Series) -> dict:
    if trades.empty:
        return {"trades": 0}
    monthly = trades.groupby(trades["exit_time"].dt.tz_localize(None).dt.to_period("M"))["r"].sum()
    equity = trades["r"].cumsum()
    return {
        "trades": len(trades),
        "trefferquote": float((trades["r"] > 0).mean()),
        "r_je_trade": float(trades["r"].mean()),
        "r_summe": float(trades["r"].sum()),
        "r_je_tag": float(days.mean()),
        "max_drawdown_r": float((equity.cummax() - equity).max()),
        "anteil_profitable_monate": float((monthly > 0).mean()),
        "ausstiege": trades["exit_reason"].value_counts().to_dict(),
    }


def evaluate_period(ds: Dataset, bars: Bars, setups: pd.DataFrame, name: str, start: pd.Timestamp,
                    end: pd.Timestamp, v0_runs: int, with_tests: bool) -> dict:
    period_setups = in_split(setups, start, end)
    result: dict = {"name": name, "signals": {}, "variants": {}, "daily": {}, "trades": {}}
    for v in VARIANTS:
        result["signals"][v] = len(select_variant(period_setups, v))
        trades = run_variant(ds, bars, period_setups, v)
        days = daily_r(trades, start, end)
        result["trades"][v] = trades
        result["daily"][v] = days
        result["variants"][v] = describe(trades, days)
        if not trades.empty:
            regime_of = period_setups.set_index("entry_pos")["regime"]
            if ds.direction == "short":  # Labels zurueck in Marktrichtung
                regime_of = regime_of.map(mirror_regime)
            by_regime = trades.assign(regime=trades["entry_pos"].map(regime_of)).groupby("regime")["r"]
            result["variants"][v]["je_regime"] = by_regime.agg(["count", "mean"]).round(3).to_dict("index")

    n_attempts = result["signals"]["V1"]
    v0_means = []
    for run in range(v0_runs):
        rs = random_setups(ds, start, end, n_attempts, np.random.default_rng(run), MODE["target"])
        trades = trades_frame(run_chain(bars, ds.funding, rs, ds.swing_highs, daily_rule=False,
                                        funding_fallback=ds.funding_fallback, anchor=ds.tf.anchor,
                                        timeout_bars=ds.tf.timeout_bars))
        v0_means.append(daily_r(trades, start, end).mean())
    result["v0_means"] = np.array(v0_means)
    result["hypotheses"] = hypotheses(result) if with_tests else None
    return result


def _aligned(a: pd.Series, b: pd.Series) -> np.ndarray:
    idx = a.index.union(b.index)
    return (a.reindex(idx, fill_value=0.0) - b.reindex(idx, fill_value=0.0)).to_numpy()


def hypotheses(result: dict) -> pd.DataFrame:
    d = result["daily"]
    n_trades = {v: result["variants"][v].get("trades", 0) for v in VARIANTS}
    rows = []
    obs, lo, hi, p = one_sided_p(d["V4"].to_numpy(), C.BOOTSTRAP_SEED)
    rows.append(("H1", "V4 > 0", obs, lo, hi, p, n_trades["V4"]))
    v0 = result["v0_means"]
    v1_mean = float(d["V1"].mean())
    p_rank = (1 + np.sum(v0 >= v1_mean)) / (1 + len(v0)) if len(v0) else np.nan
    rows.append(("H2", "V1 > V0", v1_mean - float(np.mean(v0)) if len(v0) else np.nan, np.nan, np.nan, p_rank,
                 n_trades["V1"]))
    for h, (x, y) in zip(("H3", "H4", "H5"), (("V2", "V1"), ("V3", "V2"), ("V4", "V3"))):
        obs, lo, hi, p = one_sided_p(_aligned(d[x], d[y]), C.BOOTSTRAP_SEED)
        rows.append((h, f"{x} > {y}", obs, lo, hi, p, min(n_trades[x], n_trades[y])))
    df = pd.DataFrame(rows, columns=["hypothese", "vergleich", "differenz_r_je_tag", "ci_unten", "ci_oben", "p",
                                     "n_trades_min"])
    p_values = df["p"].fillna(1.0).to_numpy()
    df["p_holm"] = multipletests(p_values, alpha=C.FAMILY_ALPHA, method="holm")[1]
    df["entscheid"] = np.where(
        df["n_trades_min"] < C.MIN_TRADES, "INSUFFICIENT_DATA",
        np.where(df["p_holm"] < C.FAMILY_ALPHA, "bestaetigt", "nicht bestaetigt"),
    )
    return df


def sensitivity(ds: Dataset, bars: Bars) -> tuple[pd.DataFrame, float | None]:
    start, end = C.CONFIRMATORY
    rows = []
    daily_cols = {}
    for dz in C.GRID_DELTA_Z:
        for sig in C.GRID_SIGMA:
            for lb in C.GRID_NEW_LOW_LOOKBACK:
                setups = in_split(build_setups(ds, dz, sig, lb, target_mode=MODE["target"]), start, end)
                trades = run_variant(ds, bars, setups, "V4")
                days = daily_r(trades, start, end)
                key = f"z{dz}_s{sig}_l{lb}"
                daily_cols[key] = days
                rows.append({"delta_z": dz, "sigma": sig, "lookback": lb, "trades": len(trades),
                             "r_je_tag": float(days.mean()), "r_summe": float(days.sum())})
    table = pd.DataFrame(rows)
    matrix = pd.DataFrame(daily_cols).fillna(0.0)
    groups = np.array_split(np.arange(len(matrix)), C.PBO_GROUPS)
    perf = np.array([[matrix.iloc[g][col].mean() for col in matrix.columns] for g in groups])
    try:
        pbo = float(compute_pbo(perf).pbo)
    except Exception:  # noqa: BLE001 -- PBO nur deskriptiv, Fehler im Bericht vermerken
        pbo = None
    return table, pbo


def structure_agreement(ds: Dataset) -> str:
    """Abgleich der kausalen 1h-Struktur mit market_features.structure_trend (Protokoll Abschnitt 10)."""
    from orderflow_4step.data import load_stored_structure

    stored = load_stored_structure()
    causal = ds.structure_hi.reindex(stored.index)
    both = pd.DataFrame({"stored": stored, "causal": causal}).dropna()
    same = float((both["stored"] == both["causal"]).mean())
    # gleiche Reihe 5 Kerzen frueher: misst, wie weit die gespeicherte Reihe der kausalen vorausläuft
    shifted = ds.structure_hi.shift(-C.STRUCTURE_SWING_LOOKBACK).reindex(stored.index)
    both_shift = pd.DataFrame({"stored": stored, "causal": shifted}).dropna()
    same_shift = float((both_shift["stored"] == both_shift["causal"]).mean())
    from orderflow_4step.features import original_structure_trend

    port = pd.Series(original_structure_trend(ds.df_struct["high"].to_numpy(), ds.df_struct["low"].to_numpy()),
                     index=ds.df_struct.index).reindex(stored.index)
    same_port = float((port == stored).mean())
    return (f"1h-Struktur: {len(both)} Kerzen verglichen. Port des Originals vs. gespeichert: {same_port:.1%} "
            f"(bestätigt den Port). Übereinstimmung kausal vs. gespeichert: {same:.1%}. "
            f"Kausal um {C.STRUCTURE_SWING_LOOKBACK} Kerzen vorgezogen vs. gespeichert: {same_shift:.1%}.")


def combined_v4(long_ds: Dataset, short_result: dict) -> list[str]:
    """Long+Short V4 zusammen (beschreibend, Nachtrag 3). Rechnet Long V4 neu und prueft,
    dass es mit dem gespeicherten Long-Lauf uebereinstimmt (Regressionstest der Spiegelung)."""
    start, end = C.CONFIRMATORY
    bars = Bars.from_frame(long_ds.df_trig, long_ds.tf.bar)
    long_trades = run_variant(long_ds, bars, in_split(build_setups(long_ds, target_mode=MODE["target"]), start, end), "V4")
    saved = ensure_output_dir() / f"trades_gesamt_V4{mode_suffix()}.csv"
    check = "keine gespeicherte Long-Datei gefunden"
    if saved.exists():
        stored = pd.read_csv(saved)
        same = len(stored) == len(long_trades) and np.allclose(stored["r"].to_numpy(), long_trades["r"].to_numpy())
        check = "identisch mit dem Long-Lauf" if same else "**ABWEICHUNG zum Long-Lauf**"
    long_days = daily_r(long_trades, start, end)
    short_days = short_result["daily"]["V4"]
    both = long_days.add(short_days, fill_value=0.0)
    obs, lo, hi, p = one_sided_p(both.to_numpy(), C.BOOTSTRAP_SEED)
    return ["## Long + Short V4 kombiniert (beschreibend)", "",
            f"Long-V4 neu gerechnet: {len(long_trades)} Trades, {check}.",
            f"Kombiniert: {len(long_trades) + short_result['variants']['V4'].get('trades', 0)} Trades, "
            f"R je Tag {obs:+.4f} (95 %-KI {lo:+.4f} bis {hi:+.4f}), einseitiges p {p:.4f}, R Summe {both.sum():+.2f}.",
            ""]


def mode_suffix() -> str:
    target = "" if MODE["target"] == "vwap_poc" else f"_{MODE['target']}"
    tf = "" if MODE["tf"].name == "15m" else f"_{MODE['tf'].name}"
    return tf + target


def git_state() -> tuple[str, bool]:
    root = Path(__file__).resolve().parents[2]
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True,
                                text=True).stdout.strip())
    return head, dirty


def fmt_split(result: dict) -> str:
    lines = [f"### {result['name']}", "", "| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag "
             "| Max-DD (R) | profitable Monate |", "|---|---|---|---|---|---|---|---|---|"]
    for v in VARIANTS:
        s = result["variants"][v]
        if s.get("trades", 0) == 0:
            lines.append(f"| {v} | {result['signals'][v]} | 0 | – | – | – | – | – | – |")
            continue
        lines.append(
            f"| {v} | {result['signals'][v]} | {s['trades']} | {s['trefferquote']:.1%} | {s['r_je_trade']:+.3f} | "
            f"{s['r_summe']:+.2f} | {s['r_je_tag']:+.4f} | {s['max_drawdown_r']:.2f} | "
            f"{s['anteil_profitable_monate']:.0%} |"
        )
    v0 = result["v0_means"]
    if len(v0):
        lines += ["", f"V0 (Zufall, {len(v0)} Läufe): R je Tag Mittel {np.mean(v0):+.4f}, "
                      f"5–95 %: {np.percentile(v0, 5):+.4f} bis {np.percentile(v0, 95):+.4f}"]
    lines += ["", "Ausstiegsgründe V4: " + str(result["variants"]["V4"].get("ausstiege", {})),
              "", "V4 je 4h-Regime (Anzahl, mittleres R): " + str(result["variants"]["V4"].get("je_regime", {})),
              ""]
    if result["hypotheses"] is not None:
        lines += [result["hypotheses"].to_markdown(index=False, floatfmt=".4f"), ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--direction", choices=("long", "short"), default="long")
    parser.add_argument("--target-mode", choices=("vwap_poc", "va_edge"), default=C.TARGET_MODE)
    parser.add_argument("--timeframe", choices=tuple(C.TIMEFRAMES), default="15m")
    args = parser.parse_args()

    head, dirty = git_state()
    if dirty and not args.smoke:
        raise SystemExit("Bestaetigungslauf nur bei sauberem Git-Arbeitsbaum (Nachtrag 2 Punkt 5).")
    if not args.smoke and args.report is None:
        raise SystemExit("--report angeben.")
    v0_runs = 2 if args.smoke else C.V0_RUNS

    MODE["target"] = args.target_mode
    MODE["tf"] = C.TIMEFRAMES[args.timeframe]
    long_ds = Dataset.load(tf=MODE["tf"])
    ds = long_ds if args.direction == "long" else mirrored(long_ds)
    bars = Bars.from_frame(ds.df_trig, ds.tf.bar)
    setups = build_setups(ds, target_mode=MODE["target"])
    parts = [f"Commit: `{head}` · Richtung: **{args.direction}** · Ziel-1-Modus: **{MODE['target']}** · Zeitrahmen: **{MODE['tf'].name}**", "",
             structure_agreement(long_ds) if MODE["tf"].name == "15m" else "", "",
             "## Bestätigungsprobe", ""]
    start, end = C.CONFIRMATORY
    main_result = evaluate_period(ds, bars, setups, "Gesamt 10/2022–09/2026", start, end, v0_runs, True)
    parts.append(fmt_split(main_result))
    results = {"gesamt": main_result}
    parts += ["## Zeitabschnitte (beschreibend)", ""]
    for name, (p_start, p_end) in C.SPLITS.items():
        results[name] = evaluate_period(ds, bars, setups, name, p_start, p_end, 0, False)
        parts.append(fmt_split(results[name]))
    if args.direction == "short":
        parts += combined_v4(long_ds, main_result)
    table, pbo = sensitivity(ds, bars)
    parts += ["## Sensitivität V4 (Gesamtprobe, beschreibend)", "",
              table.to_markdown(index=False, floatfmt=".4f"), "",
              f"PBO (CSCV, {C.PBO_GROUPS} Gruppen): {pbo if pbo is not None else 'nicht berechenbar'}", ""]
    if args.smoke:
        print("Smoke-Lauf ohne Fehler beendet.")
        return
    out = ensure_output_dir()
    for name, res in results.items():
        for v in VARIANTS:
            suffix = mode_suffix() + ("" if args.direction == "long" else "_short")
            res["trades"][v].to_csv(out / f"trades_{name}_{v}{suffix}.csv", index=False)
    args.report.write_text("\n".join(parts))
    print("\n".join(parts))


if __name__ == "__main__":
    main()
