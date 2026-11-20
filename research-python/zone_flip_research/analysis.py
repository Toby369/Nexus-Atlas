"""Phase 1 "Zonen mit Gedaechtnis" (docs/research/ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md).

Frage (beschreibend, keine Handelsregel): Passiert an gedrehten Zonen mehr
als an Zufallsniveaus? Reaktion in beide Richtungen: relatives Volumen,
Dochte, Spanne danach.

Ablauf je Zeiteinheit (1h, 4h, 1d), getrennt fuer ex-Unterstuetzung (Kurs
kommt von unten zurueck) und ex-Widerstand (gespiegelt, intern ueber
Vorzeichenwechsel der Preise, damit es nur einen Codepfad gibt):

1. Pivot-Tiefs erkennen, erst k Kerzen spaeter bekannt (kein Blick in die
   Zukunft). Zone = Docht bis Kerzenkoerper, Breite 0.15..0.5 ATR.
2. Zustand vorwaerts: Beruehrung (Docht in Zone, Schluss darueber, frischer
   Eintritt), Bruch (Schluss unter Zone), Entfernung >= 1 ATR, erste Rueckkehr
   in die Zone = Ereignis. Schluss ueber der Zone vor der Entfernung = Reclaim,
   kein Ereignis.
3. Kontrollen: (a) "auf dem Weg": Niveaus zwischen Extrem und Zone, gleiche
   Zeit, gleiche Breite; (b) "zufaellig": Zufallsbar, Niveau 1..4 ATR entfernt.
   Niveaus nahe bekannter Pivots (0.25 ATR) werden ausgeschlossen.
4. Messgroessen ab Ereignis-Kerze t: Volumen (t..t+2 / Median der 20 Kerzen
   davor), Docht (Mittel t..t+2 / ATR), Spanne (t..t+H-1 / ATR).

Aufruf aus research-python/:
    python -m zone_flip_research.analysis --report zone_flip_research/output/ergebnis.md
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
TF_CFG = {"1h": {"k": 5, "H": 12}, "4h": {"k": 5, "H": 12}, "1d": {"k": 3, "H": 5}}
MAX_AGE = 720  # Kerzen, die eine Zone ohne Bruch bzw. ohne Rueckkehr verfolgt wird
DEPART_ATR = 1.0
PIVOT_EXCLUDE_ATR = 0.25
N_CONTROLS = 5
SEED = 20261120
MIN_BARS_TO_VISIT = 0  # per --min-kerzen: Rueckkehr fruehestens so viele Kerzen nach dem Bruch
METRICS = ("volumen", "docht", "spanne")


def load(tf: str) -> pd.DataFrame:
    df = pd.read_csv(HERE / "data" / f"BTCUSDT_{tf}.csv")
    df.index = pd.to_datetime(df["open_time_ms"], unit="ms", utc=True)
    return df[["open", "high", "low", "close", "volume"]].astype(float)


def atr(h: np.ndarray, l: np.ndarray, c: np.ndarray, n: int = 14) -> np.ndarray:
    prev = np.concatenate([[c[0]], c[:-1]])
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().to_numpy()


def pivot_lows(l: np.ndarray, k: int) -> list[int]:
    """Index i ist Pivot-Tief, wenn l[i] strikt unter den k Kerzen davor und
    hoechstens gleich den k Kerzen danach liegt. Bekannt erst bei i+k."""
    out = []
    for i in range(k, len(l) - k):
        if l[i] < l[i - k:i].min() and l[i] <= l[i + 1:i + k + 1].min():
            out.append(i)
    return out


@dataclass
class Bars:
    """Preise in 'Normalrichtung': Zone liegt ueber dem Kurs nach dem Bruch,
    Rueckkehr von unten. Fuer ex-Widerstand gespiegelt (sign=-1)."""
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray
    a: np.ndarray
    sign: int

    @classmethod
    def build(cls, df: pd.DataFrame, sign: int) -> "Bars":
        o, h, l, c = (df[x].to_numpy() for x in ("open", "high", "low", "close"))
        a = atr(h, l, c)
        if sign == 1:
            return cls(o, h, l, c, df["volume"].to_numpy(), a, 1)
        return cls(-o, -l, -h, -c, df["volume"].to_numpy(), a, -1)


def find_zones(b: Bars, k: int) -> list[dict]:
    """Unterstuetzungszonen (in Normalrichtung) mit Beruehrungen, Bruch und
    erster Rueckkehr. Ueberlappt ein neues Pivot eine noch aktive Zone, zaehlt
    es nicht als neue Zone (die Beruehrung zaehlt die bestehende Zone)."""
    n = len(b.c)
    zones: list[dict] = []
    for i in pivot_lows(b.l, k):
        conf = i + k
        A = b.a[i]
        zl = b.l[i]
        zh = float(np.clip(min(b.o[i], b.c[i]), zl + 0.15 * A, zl + 0.5 * A))
        if any(z["end"] > conf and z["zl"] <= zh and zl <= z["zh"] for z in zones):
            continue
        z = {"pivot": i, "conf": conf, "zl": zl, "zh": zh, "touches": 1,
             "brk": None, "dep": None, "visit": None, "ext": None, "ext_bar": None,
             "reclaim": None, "end": min(n, conf + MAX_AGE)}
        prev_in = b.l[conf] <= zh
        for j in range(conf + 1, min(n, conf + MAX_AGE)):
            if b.c[j] < zl:
                z["brk"] = j
                break
            inz = b.l[j] <= zh
            if inz and not prev_in:
                z["touches"] += 1
            prev_in = inz
        if z["brk"] is not None:
            brk = z["brk"]
            z["end"] = min(n, brk + MAX_AGE)
            Ab = b.a[brk]
            ext, ext_bar = b.l[brk], brk
            for j in range(brk + 1, min(n, brk + MAX_AGE)):
                if z["dep"] is None:
                    if b.c[j] > zh:
                        z["reclaim"] = j
                        z["end"] = j
                        break
                    if b.l[j] < ext:
                        ext, ext_bar = b.l[j], j
                    if zl - ext >= DEPART_ATR * Ab:
                        z["dep"] = j
                    continue
                if b.h[j] >= zl:
                    z["visit"] = j
                    z["end"] = j
                    break
                if b.l[j] < ext:
                    ext, ext_bar = b.l[j], j
            z["ext"], z["ext_bar"] = ext, ext_bar
        zones.append(z)
    return zones


def reaction(b: Bars, t: int, lo: float, hi: float, H: int) -> dict | None:
    if t < 21 or t + H > len(b.c):
        return None
    A = b.a[t - 1]
    w = slice(t, t + 3)
    body = np.abs(b.c[w] - b.o[w])
    med = np.median(b.v[t - 20:t])
    end = b.c[t + H - 1]
    return {
        "volumen": b.v[w].mean() / med if med > 0 else np.nan,
        "docht": ((b.h[w] - b.l[w] - body) / A).mean(),
        "spanne": (b.h[t:t + H].max() - b.l[t:t + H].min()) / A,
        "ergebnis": "abgelehnt" if end < lo else ("akzeptiert" if end > hi else "in Zone"),
    }


class PivotIndex:
    """Alle Pivots (Tiefs und Hochs) mit Bestaetigungszeitpunkt, zum Ausschluss
    von Kontroll-Niveaus, die in Wahrheit nahe einer Zone liegen."""

    def __init__(self, b: Bars, k: int):
        lows = pivot_lows(b.l, k)
        highs = pivot_lows(-b.h, k)
        self.conf = np.array([i + k for i in lows] + [i + k for i in highs])
        self.price = np.array([b.l[i] for i in lows] + [b.h[i] for i in highs])

    def near(self, lo: float, hi: float, j: int, A: float) -> bool:
        m = (self.conf < j) & (self.conf >= j - MAX_AGE)
        p = self.price[m]
        return bool(np.any((p >= lo - PIVOT_EXCLUDE_ATR * A) & (p <= hi + PIVOT_EXCLUDE_ATR * A)))


def first_touch(b: Bars, level: float, start: int, stop: int) -> int | None:
    idx = np.nonzero(b.h[start:stop] >= level)[0]
    return start + int(idx[0]) if len(idx) else None


def run_tf(tf: str, df: pd.DataFrame, rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    k, H = TF_CFG[tf]["k"], TF_CFG[tf]["H"]
    rows, zone_rows = [], []
    for sign, art in ((1, "ex-Unterstuetzung"), (-1, "ex-Widerstand")):
        b = Bars.build(df, sign)
        piv = PivotIndex(b, k)
        zones = find_zones(b, k)
        events = [z for z in zones if z["visit"] is not None and z["visit"] - z["brk"] > MIN_BARS_TO_VISIT]
        for z in zones:
            lo, hi = sorted((z["zl"] * sign, z["zh"] * sign))
            zone_rows.append({"tf": tf, "art": art, "pivot_zeit": df.index[z["pivot"]], "zone_tief": lo,
                              "zone_hoch": hi, "beruehrungen": z["touches"],
                              "bruch": df.index[z["brk"]] if z["brk"] is not None else None,
                              "rueckkehr": df.index[z["visit"]] if z["visit"] is not None else None})
        for z in events:
            t = z["visit"]
            r = reaction(b, t, z["zl"], z["zh"], H)
            if r is None:
                continue
            base = {"tf": tf, "art": art, "zeit": df.index[t], "beruehrungen": z["touches"]}
            rows.append({**base, "gruppe": "gedrehte Zone", **r})
            width = z["zh"] - z["zl"]
            A = b.a[t - 1]
            for _ in range(N_CONTROLS):  # (a) auf dem Weg
                L = z["ext"] + rng.uniform(0.3, 0.85) * (z["zl"] - z["ext"])
                j = first_touch(b, L, z["ext_bar"] + 1, t + 1)
                if j is None or j >= t or piv.near(L, L + width, j, A):
                    continue
                rc = reaction(b, j, L, L + width, H)
                if rc:
                    rows.append({**base, "zeit": df.index[j], "gruppe": "Kontrolle: auf dem Weg", **rc})
        wa = np.median([(z["zh"] - z["zl"]) / b.a[z["pivot"]] for z in events]) if events else 0.3
        n = len(b.c)
        for _ in range(N_CONTROLS * len(events)):  # (b) zufaellig
            r0 = int(rng.integers(21, n - 2 * H))
            A = b.a[r0]
            L = b.c[r0] + rng.uniform(1, 4) * A
            j = first_touch(b, L, r0 + 1, min(n, r0 + MAX_AGE))
            if j is None or piv.near(L, L + wa * A, j, A):
                continue
            rc = reaction(b, j, L, L + wa * A, H)
            if rc:
                rows.append({"tf": tf, "art": art, "zeit": df.index[j], "beruehrungen": np.nan,
                             "gruppe": "Kontrolle: zufaellig", **rc})
    return pd.DataFrame(rows), pd.DataFrame(zone_rows)


def auc(x: np.ndarray, y: np.ndarray) -> float:
    """P(Ereignis > Kontrolle), Ties halb."""
    ranks = pd.Series(np.concatenate([x, y])).rank().to_numpy()
    return (ranks[:len(x)].sum() - len(x) * (len(x) + 1) / 2) / (len(x) * len(y))


def bootstrap_ratio(ev: pd.DataFrame, ct: pd.DataFrame, metric: str, rng: np.random.Generator,
                    reps: int = 2000) -> tuple[float, float]:
    """95-%-Intervall fuer Median(Ereignis)/Median(Kontrolle), Bloecke = Kalendermonate."""
    em, cm = ev["zeit"].dt.strftime("%Y-%m"), ct["zeit"].dt.strftime("%Y-%m")
    months = np.array(sorted(set(em) | set(cm)))
    eg = {m: ev[metric].to_numpy()[em.to_numpy() == m] for m in months}
    cg = {m: ct[metric].to_numpy()[cm.to_numpy() == m] for m in months}
    out = []
    for _ in range(reps):
        s = rng.choice(months, len(months))
        e = np.concatenate([eg[m] for m in s]); c = np.concatenate([cg[m] for m in s])
        if len(e) and len(c):
            out.append(np.median(e) / np.median(c))
    return float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def summarize(res: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    out = []
    for tf in TF_CFG:
        d = res[res.tf == tf]
        ev = d[d.gruppe == "gedrehte Zone"]
        for ctrl in ("Kontrolle: auf dem Weg", "Kontrolle: zufaellig"):
            ct = d[d.gruppe == ctrl]
            for m in METRICS:
                lo, hi = bootstrap_ratio(ev, ct, m, rng)
                out.append({"tf": tf, "vergleich": ctrl, "messgroesse": m, "n_zone": len(ev), "n_kontrolle": len(ct),
                            "median_zone": ev[m].median(), "median_kontrolle": ct[m].median(),
                            "verhaeltnis": ev[m].median() / ct[m].median(), "ki95_unten": lo, "ki95_oben": hi,
                            "p_zone_groesser": auc(ev[m].to_numpy(), ct[m].to_numpy())})
    return pd.DataFrame(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", type=Path, default=HERE / "output" / "ergebnis.md")
    ap.add_argument("--min-kerzen", type=int, default=0,
                    help="Rueckkehr erst mehr als so viele Kerzen nach dem Bruch (filtert Fehlausbrueche)")
    args = ap.parse_args()
    global MIN_BARS_TO_VISIT
    MIN_BARS_TO_VISIT = args.min_kerzen
    rng = np.random.default_rng(SEED)
    results, zones = [], []
    for tf in TF_CFG:
        r, z = run_tf(tf, load(tf), rng)
        results.append(r); zones.append(z)
    res, zon = pd.concat(results, ignore_index=True), pd.concat(zones, ignore_index=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    stem = args.report.stem
    res.to_csv(args.report.parent / f"{stem}_ereignisse.csv", index=False)
    zon.to_csv(args.report.parent / f"{stem}_zonen.csv", index=False)
    summ = summarize(res, rng)
    ev = res[res.gruppe == "gedrehte Zone"].copy()
    ev["periode"] = np.where(ev.zeit.dt.year <= 2024, "2022-2024", "2025-2026")
    ev["beruehrt"] = np.where(ev.beruehrungen >= 2, ">=2", "1")
    with args.report.open("w") as f:
        f.write("# Zonen-Gedaechtnis Phase 1: Rohergebnis\n\n")
        f.write(summ.round(3).to_markdown(index=False) + "\n\n")
        f.write("## Ergebnis nach H Kerzen\n\n")
        f.write((res.groupby(["tf", "gruppe"])["ergebnis"].value_counts(normalize=True).unstack().round(3))
                .to_markdown() + "\n\n")
        for col in ("beruehrt", "periode", "art"):
            f.write(f"## Gedrehte Zonen nach {col} (Mediane)\n\n")
            f.write(ev.groupby(["tf", col])[list(METRICS)].median().round(3)
                    .join(ev.groupby(["tf", col]).size().rename("n")).to_markdown() + "\n\n")
        f.write("## Kontroll-Mediane nach art\n\n")
        ct = res[res.gruppe != "gedrehte Zone"]
        f.write(ct.groupby(["tf", "gruppe", "art"])[list(METRICS)].median().round(3).to_markdown() + "\n\n")
        g = zon[(zon.tf == "1h") & (zon.zone_hoch >= 76000) & (zon.zone_tief <= 77000)
                & (zon.pivot_zeit >= "2026-10-25")]
        f.write("## Kontrolle: 1h-Zonen 76'000-77'000 seit 25.10.2026\n\n" + g.to_markdown(index=False) + "\n")
    print(args.report.read_text())


if __name__ == "__main__":
    main()
