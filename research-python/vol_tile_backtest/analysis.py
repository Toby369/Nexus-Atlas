"""Backtest der Volatilitaets-Kachel (Protokoll:
docs/research/VOLATILITAETS-KACHEL-BACKTEST_PROTOCOL_2026-10-14.md).

Aufruf aus research-python/:
    python -m vol_tile_backtest.analysis --report <pfad.md>

Daten:
- data/dvol_daily.csv: Deribit-DVOL-Tageskerzen (Schlusswert = Stand 00:00 UTC des
  Folgetags), exportiert 14.10.2026, SHA256 in data/MANIFEST.txt.
- ../orderflow_4step/data/BTCUSDT_1h.csv: Binance-Futures-1h-Kerzen (Export und
  Pruefsumme siehe orderflow_4step/data/MANIFEST.txt).
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.stats.multitest import multipletests

from src.validation.block_bootstrap import moving_block_bootstrap

HERE = Path(__file__).resolve().parent
HOURS_PER_YEAR = 24 * 365
RV_HOURS = 30 * 24
PCT_WINDOW = 365
HORIZONS = (1, 7, 30)
ONE_SIGMA_COVERAGE = 0.682689
LOW_PCT = 20.0
SPREAD_HIGH = 10.0
SPREAD_LOW = -5.0
MIN_GROUP = 60
REPLICATES = 10_000
SEED = 20261014
ALPHA = 0.05


def load_dvol() -> pd.Series:
    """DVOL-Schlusswert, indexiert auf den Zeitpunkt, an dem er gilt (Tagesende 00:00 UTC)."""
    df = pd.read_csv(HERE / "data" / "dvol_daily.csv")
    t = pd.to_datetime(df["day_start_ms"], unit="ms", utc=True) + pd.Timedelta(days=1)
    return pd.Series(df["dvol_close"].to_numpy(dtype=float), index=t).sort_index()


def load_hourly_closes() -> pd.Series:
    """1h-Schlusskurse, indexiert auf den Kerzenschluss (open_time + 1h)."""
    df = pd.read_csv(HERE.parent / "orderflow_4step" / "data" / "BTCUSDT_1h.csv")
    t = pd.to_datetime(df["open_time"], utc=True, format="ISO8601") + pd.Timedelta(hours=1)
    return pd.Series(df["close"].to_numpy(dtype=float), index=t).sort_index()


def realized_vol(log_returns: np.ndarray) -> float:
    """Annualisierte realisierte Volatilitaet in %, wie lib/volatility.ts::realizedVolPct."""
    if len(log_returns) < 2:
        return np.nan
    return float(np.std(log_returns, ddof=1) * np.sqrt(HOURS_PER_YEAR) * 100)


def build_daily(dvol: pd.Series, closes: pd.Series) -> pd.DataFrame:
    """Je Tag t: DVOL, Kurs, Perzentil, Rueck-/Vorwaerts-RV, Vorwaerts-Kurse.

    Alles an t nutzt nur Daten <= t; Vorwaertsgroessen beginnen nach t. Tage ohne
    vollstaendige Fenster bekommen NaN.
    """
    hourly = closes.copy()
    log_ret = np.log(hourly).diff()
    pos = {ts: i for i, ts in enumerate(hourly.index)}
    lr = log_ret.to_numpy()
    price = hourly.to_numpy()
    n = len(hourly)

    rows = []
    dvol_values = dvol.to_numpy()
    for k, (t, sigma) in enumerate(dvol.items()):
        i = pos.get(t)
        if i is None:
            continue
        hist = dvol_values[max(0, k - PCT_WINDOW + 1):k + 1]
        pct = float((hist <= sigma).mean() * 100) if k + 1 >= PCT_WINDOW else np.nan
        rv_back = realized_vol(lr[i - RV_HOURS + 1:i + 1]) if i - RV_HOURS + 1 >= 1 else np.nan
        rv_fwd = realized_vol(lr[i + 1:i + RV_HOURS + 1]) if i + RV_HOURS < n else np.nan
        row = {"t": t, "dvol": sigma, "price": price[i], "pct": pct, "rv_back": rv_back, "rv_fwd": rv_fwd}
        for h in HORIZONS:
            j = i + 24 * h
            row[f"p_{h}"] = price[j] if j < n and hourly.index[j] == t + pd.Timedelta(days=h) else np.nan
        rows.append(row)
    return pd.DataFrame(rows).set_index("t")


def coverage_columns(daily: pd.DataFrame) -> pd.DataFrame:
    out = daily.copy()
    for h in HORIZONS:
        sigma_h = out["dvol"] / 100 * np.sqrt(h / 365)
        z = np.log(out[f"p_{h}"] / out["price"]) / sigma_h
        out[f"z_{h}"] = z
        out[f"hit_{h}"] = np.where(z.notna(), (z.abs() <= 1).astype(float), np.nan)
    out["expansion"] = np.log(out["rv_fwd"] / out["rv_back"])
    out["spread"] = out["dvol"] - out["rv_back"]
    out["fwd_minus_iv"] = out["rv_fwd"] - out["dvol"]
    return out


def _bootstrap(values: np.ndarray, stat, baseline: float, block: int):
    return moving_block_bootstrap(
        n_obs=len(values), statistic_fn=stat, baseline=baseline, seed=SEED,
        block_length=block, n_replicates=REPLICATES,
    )


def one_sided_p(res) -> float:
    dist = res.bootstrap_distribution[np.isfinite(res.bootstrap_distribution)]
    return float(np.mean(dist - res.observed_statistic >= res.observed_statistic - res.baseline))


def test_coverage(df: pd.DataFrame, h: int) -> dict:
    hits = df[f"hit_{h}"].dropna().to_numpy()
    res = _bootstrap(hits, lambda ix: float(hits[ix].mean()), ONE_SIGMA_COVERAGE, max(14, h))
    z = df[f"z_{h}"].dropna().to_numpy()
    return {
        "hypothese": f"H-A({h})", "aussage": f"Trefferquote {h} Tag(e) ≠ 68,3 %", "n": len(hits),
        "wert": float(hits.mean()), "ci_unten": res.ci_lower, "ci_oben": res.ci_upper, "p": res.p_value,
        "zusatz": f"mittleres z² = {np.mean(z ** 2):.3f}", "n_gruppe": len(hits),
    }


def test_group_diff(values: np.ndarray, mask: np.ndarray, rest: np.ndarray, name: str, text: str) -> dict:
    """Einseitig: Mittel(values | mask) > Mittel(values | rest), Bootstrap auf der vollen Reihe."""

    def stat(ix):
        v, m, r = values[ix], mask[ix], rest[ix]
        if m.sum() == 0 or r.sum() == 0:
            return np.nan
        return float(v[m].mean() - v[r].mean())

    res = _bootstrap(values, stat, 0.0, 30)
    return {
        "hypothese": name, "aussage": text, "n": len(values), "wert": res.observed_statistic,
        "ci_unten": res.ci_lower, "ci_oben": res.ci_upper, "p": one_sided_p(res),
        "zusatz": f"Gruppe {int(mask.sum())} Tage, Vergleich {int(rest.sum())} Tage",
        "n_gruppe": int(min(mask.sum(), rest.sum())),
    }


def test_group_mean(values: np.ndarray, mask: np.ndarray, name: str, text: str) -> dict:
    """Einseitig: Mittel(values | mask) > 0."""

    def stat(ix):
        v, m = values[ix], mask[ix]
        return float(v[m].mean()) if m.sum() else np.nan

    res = _bootstrap(values, stat, 0.0, 30)
    return {
        "hypothese": name, "aussage": text, "n": len(values), "wert": res.observed_statistic,
        "ci_unten": res.ci_lower, "ci_oben": res.ci_upper, "p": one_sided_p(res),
        "zusatz": f"Gruppe {int(mask.sum())} Tage", "n_gruppe": int(mask.sum()),
    }


def run(daily: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    df = coverage_columns(daily)
    rows = [test_coverage(df, h) for h in HORIZONS]

    b = df.dropna(subset=["pct", "expansion"])
    low = (b["pct"] < LOW_PCT).to_numpy()
    rows.append(test_group_diff(b["expansion"].to_numpy(), low, ~low, "H-B",
                                "Ausdehnung bei DVOL-Perzentil < 20 grösser als sonst"))

    c = df.dropna(subset=["spread", "expansion", "fwd_minus_iv"])
    s = c["spread"].to_numpy()
    high, mid, lowsp = s > SPREAD_HIGH, (s >= SPREAD_LOW) & (s <= SPREAD_HIGH), s < SPREAD_LOW
    rows.append(test_group_diff(c["expansion"].to_numpy(), high, mid, "H-C1",
                                "Ausdehnung bei IV−RV > +10 grösser als bei −5…+10"))
    rows.append(test_group_mean(c["fwd_minus_iv"].to_numpy(), lowsp, "H-C2",
                                "Bei IV−RV < −5: RV vorwärts > DVOL (Optionen waren zu billig)"))

    table = pd.DataFrame(rows)
    table["p_holm"] = multipletests(table["p"].fillna(1.0), alpha=ALPHA, method="holm")[1]
    table["entscheid"] = np.where(
        table["n_gruppe"] < MIN_GROUP, "INSUFFICIENT_DATA",
        np.where(table["p_holm"] < ALPHA, "bestätigt", "nicht bestätigt"),
    )

    desc = {
        "zeitraum": f"{df.index.min():%d.%m.%Y} – {df.index.max():%d.%m.%Y}",
        "tage": len(df),
        "vrp_mittel": float(c["dvol"].mean() - c["rv_fwd"].mean()),
        "vrp_anteil_positiv": float((c["dvol"] > c["rv_fwd"]).mean()),
        "trefferquote_je_h": {h: float(df[f"hit_{h}"].mean()) for h in HORIZONS},
        "ausdehnung_mittel": {
            "pct<20": float(b.loc[low, "expansion"].mean()),
            "pct>=20": float(b.loc[~low, "expansion"].mean()),
            "spread>10": float(c.loc[high, "expansion"].mean()),
            "spread -5..10": float(c.loc[mid, "expansion"].mean()),
            "spread<-5": float(c.loc[lowsp, "expansion"].mean()),
        },
        "gruppen_tage": {"pct<20": int(low.sum()), "spread>10": int(high.sum()),
                         "spread -5..10": int(mid.sum()), "spread<-5": int(lowsp.sum())},
    }
    return table, desc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    daily = build_daily(load_dvol(), load_hourly_closes())
    table, desc = run(daily)
    text = [
        f"Zeitraum: {desc['zeitraum']} ({desc['tage']} Tage mit DVOL und Kurs)", "",
        table.to_markdown(index=False, floatfmt=".4f"), "",
        f"Trefferquoten: {desc['trefferquote_je_h']}",
        f"Volatilitäts-Risikoprämie DVOL − RV vorwärts: Mittel {desc['vrp_mittel']:.2f} Punkte, "
        f"positiv an {desc['vrp_anteil_positiv']:.1%} der Tage",
        f"Mittlere Ausdehnung ln(RV vorwärts / RV rückwärts): {desc['ausdehnung_mittel']}",
        f"Gruppengrössen: {desc['gruppen_tage']}",
    ]
    args.report.write_text("\n".join(text) + "\n")
    print("\n".join(text))


if __name__ == "__main__":
    main()
