"""Beruehrungsquote der erwarteten Spanne (Nachtrag zum Backtest der
Volatilitaets-Kachel, beschreibend, keine Hypothese).

Frage: Wie oft beruehrt der Kurs die 1-Sigma-Spanne irgendwann innerhalb von
1, 7 bzw. 30 Tagen (Hoch/Tief der 1h-Kerzen), nicht nur am Ende?

Aufruf aus research-python/:
    python -m vol_tile_backtest.touch --report <pfad.md>
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm

from src.validation.block_bootstrap import moving_block_bootstrap
from vol_tile_backtest.analysis import HERE, HORIZONS, load_dvol

REPLICATES = 10_000
SEED = 20261014


def load_hourly_ohlc() -> pd.DataFrame:
    """1h-Kerzen, indexiert auf den Kerzenbeginn (open_time)."""
    df = pd.read_csv(HERE.parent / "orderflow_4step" / "data" / "BTCUSDT_1h.csv")
    df.index = pd.to_datetime(df["open_time"], utc=True, format="ISO8601")
    return df[["high", "low", "close"]].astype(float).sort_index()


def build_touch(dvol: pd.Series, ohlc: pd.DataFrame) -> pd.DataFrame:
    """Je Tag t (DVOL-Stand 00:00 UTC, Kurs = Schluss der Kerze 23:00-00:00) und
    Horizont h: Spanne price*e^(+/-sigma_h), dann Hoch/Tief aller Kerzen, die in
    [t, t+h) beginnen. Nur vollstaendige Fenster (24*h Kerzen)."""
    close_at = pd.Series(ohlc["close"].to_numpy(), index=ohlc.index + pd.Timedelta(hours=1))
    pos = {ts: i for i, ts in enumerate(ohlc.index)}
    hi, lo, cl = ohlc["high"].to_numpy(), ohlc["low"].to_numpy(), ohlc["close"].to_numpy()
    idx = ohlc.index
    rows = []
    for t, sigma in dvol.items():
        i = pos.get(t)
        if i is None or t not in close_at.index:
            continue
        price = float(close_at.loc[t])
        row = {"t": t, "dvol": sigma, "price": price}
        for h in HORIZONS:
            j = i + 24 * h
            if j > len(idx) or idx[j - 1] != t + pd.Timedelta(hours=24 * h - 1):
                continue
            s = sigma / 100 * np.sqrt(h / 365)
            up, down = price * np.exp(s), price * np.exp(-s)
            hmax, lmin, end = hi[i:j].max(), lo[i:j].min(), cl[j - 1]
            row[f"up_{h}"] = float(hmax >= up)
            row[f"down_{h}"] = float(lmin <= down)
            row[f"any_{h}"] = float(hmax >= up or lmin <= down)
            row[f"both_{h}"] = float(hmax >= up and lmin <= down)
            row[f"end_in_{h}"] = float(down <= end <= up)
            # Groesste Ausdehnung ueber die Spanne hinaus, in Sigma (0 = nicht beruehrt)
            row[f"over_{h}"] = max(np.log(hmax / price) / s - 1, np.log(price / lmin) / s - 1, 0.0)
        rows.append(row)
    return pd.DataFrame(rows).set_index("t")


def model_touch_one_side() -> float:
    """Brownsche Bewegung ohne Drift: P(Maximum >= 1 Sigma) = 2*(1 - Phi(1))."""
    return float(2 * (1 - norm.cdf(1)))


def model_touch_any(terms: int = 20) -> float:
    """P(|W| erreicht 1 Sigma bis T) = 1 - (4/pi) * sum (-1)^k/(2k+1) e^(-(2k+1)^2 pi^2 / 8)."""
    k = np.arange(terms)
    stay = 4 / np.pi * np.sum((-1.0) ** k / (2 * k + 1) * np.exp(-((2 * k + 1) ** 2) * np.pi ** 2 / 8))
    return float(1 - stay)


def share_ci(values: np.ndarray, block: int) -> tuple[float, float, float]:
    v = values[~np.isnan(values)]
    res = moving_block_bootstrap(
        n_obs=len(v), statistic_fn=lambda ix: float(v[ix].mean()), baseline=0.0, seed=SEED,
        block_length=block, n_replicates=REPLICATES,
    )
    return float(v.mean()), res.ci_lower, res.ci_upper


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for h in HORIZONS:
        d = df.dropna(subset=[f"any_{h}"])
        block = max(14, h)
        rec = {"horizont": f"{h} Tag(e)", "n": len(d)}
        for key in ("any", "up", "down", "both", "end_in"):
            m, lo_, hi_ = share_ci(d[f"{key}_{h}"].to_numpy(), block)
            rec[key] = m
            rec[f"{key}_ci"] = f"{lo_:.1%} – {hi_:.1%}"
        touched = d[d[f"any_{h}"] == 1]
        rec["zurueck_nach_beruehrung"] = float(touched[f"end_in_{h}"].mean())
        over = touched[f"over_{h}"]
        rec["ueber_median_sigma"] = float(over.median())
        rec["ueber_p90_sigma"] = float(over.quantile(0.9))
        rec["ueber_0_5_sigma"] = float((over >= 0.5).mean())
        rows.append(rec)
    return pd.DataFrame(rows)


def by_dvol_level(df: pd.DataFrame) -> pd.DataFrame:
    """Beschreibend: 1-Tages-Beruehrung nach DVOL-Drittel (ueber den ganzen Zeitraum)."""
    d = df.dropna(subset=["any_1"]).copy()
    d["drittel"] = pd.qcut(d["dvol"], 3, labels=["tief", "mittel", "hoch"])
    g = d.groupby("drittel", observed=True)
    return pd.DataFrame({
        "dvol_bereich": g["dvol"].agg(lambda s: f"{s.min():.0f}–{s.max():.0f}"),
        "tage": g.size(),
        "beruehrt": g["any_1"].mean(),
        "am_ende_drin": g["end_in_1"].mean(),
    }).reset_index()


def by_weekday(df: pd.DataFrame) -> pd.DataFrame:
    d = df.dropna(subset=["any_1"]).copy()
    d["tag"] = np.where(d.index.dayofweek >= 5, "Sa/So", "Mo–Fr")
    g = d.groupby("tag")
    return pd.DataFrame({"tage": g.size(), "beruehrt": g["any_1"].mean(), "am_ende_drin": g["end_in_1"].mean()}).reset_index()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    df = build_touch(load_dvol(), load_hourly_ohlc())
    text = [
        f"Zeitraum: {df.index.min():%d.%m.%Y} – {df.index.max():%d.%m.%Y} ({len(df)} Tage)", "",
        f"Modell (Brownsche Bewegung): eine Seite {model_touch_one_side():.1%}, "
        f"irgendeine Seite {model_touch_any():.1%}, am Ende drin 68,3 %", "",
        summarize(df).to_markdown(index=False, floatfmt=".3f"), "",
        "1 Tag nach DVOL-Drittel:", "", by_dvol_level(df).to_markdown(index=False, floatfmt=".3f"), "",
        "1 Tag nach Wochentag (Start 00:00 UTC):", "", by_weekday(df).to_markdown(index=False, floatfmt=".3f"),
    ]
    args.report.write_text("\n".join(text) + "\n")
    print("\n".join(text))


if __name__ == "__main__":
    main()
