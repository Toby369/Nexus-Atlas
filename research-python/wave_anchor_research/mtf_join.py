"""Look-ahead-sicherer Multi-Timeframe-Join: ordnet jeder LTF-Bar den
zuletzt BESTAETIGTEN (vollstaendig geschlossenen) HTF-Wert zu -- niemals
einen HTF-Wert, dessen Kerze zum LTF-Zeitpunkt noch nicht geschlossen war.

Siehe docs/research/WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md fuer die vollstaendige
Herleitung, das Pine request.security()-Semantik-Mapping und den
synthetischen Beweis. Kurzfassung der Regel hier:

Eine HTF-Kerze mit open_time=T_open und interval-Dauer D gilt als
BESTAETIGT ab close_time = T_open + D (inklusive). Fuer eine LTF-Bar, deren
EIGENER Schlusszeitpunkt (close_time) t ist, wird der Wert der zuletzt
bestaetigten HTF-Kerze mit close_time <= t zugeordnet -- NICHT die
open_time der LTF-Bar (das wuerde implizieren, man koenne schon beim
OEFFNEN einer LTF-Bar auf Informationen zugreifen, die erst waehrend ihrer
Laufzeit bekannt werden -- inkonsistent mit der in dieser Codebasis
etablierten Konvention "Entry = Close der Signal-Bar", siehe u.a.
avwap_pivot_setup/backtest.py, elliott_wave_setup/backtest.py).

Default-Modus dieser Funktion: CONFIRMED HTF ONLY (per Aufgabenstellung
Abschnitt 5) -- es gibt bewusst KEINEN "developing/lookahead"-Modus, da
dessen Semantik (Pine barmerge.lookahead_on) laut Code-Reconstruction-Audit
selbst innerhalb von VuManChu Cipher B als Repainting-Quelle dokumentiert
ist und fuer diese Forschung nicht benoetigt wird.
"""

from __future__ import annotations

import pandas as pd

_INTERVAL_TIMEDELTA = {
    "5m": pd.Timedelta(minutes=5),
    "15m": pd.Timedelta(minutes=15),
    "1h": pd.Timedelta(hours=1),
    "4h": pd.Timedelta(hours=4),
    "1d": pd.Timedelta(days=1),
}


def close_time_of(df: pd.DataFrame, interval: str) -> pd.Series:
    """Leitet close_time = open_time + interval-Dauer deterministisch her
    (die vorhandenen CSV-Exporte fuehren nur open_time/`time` als Index).
    Setzt lueckenfreie, exakt getaktete Kerzen voraus (in dieser Codebasis
    bereits mehrfach fuer dieselben Datensaetze verifiziert, siehe
    avwap_pivot_setup/AVWAP-PIVOT-CONFLUENCE-BACKTEST_2026-09-18.md)."""
    if interval not in _INTERVAL_TIMEDELTA:
        raise ValueError(f"Unbekanntes Intervall '{interval}', erwarte eines von {list(_INTERVAL_TIMEDELTA)}")
    return df.index.to_series().reset_index(drop=True) + _INTERVAL_TIMEDELTA[interval]


def confirmed_asof_join(
    ltf_close_time: pd.Series,
    htf_df: pd.DataFrame,
    htf_interval: str,
    htf_value_cols: list[str],
) -> pd.DataFrame:
    """Ordnet jedem LTF-Zeitpunkt (`ltf_close_time`, aufsteigend sortiert)
    die Werte der zuletzt BESTAETIGTEN HTF-Bar zu (HTF close_time <= LTF
    close_time). Vor der ersten bestaetigten HTF-Bar: NaN (kein
    kuenstliches Rueckwaerts-Auffuellen).

    Implementiert als `pd.merge_asof(direction="backward")` auf
    close_time-zu-close_time -- der Standard-Mechanismus fuer "letzter
    bekannter Wert zum Zeitpunkt X", hier explizit auf HTF-CLOSE_TIME statt
    open_time verankert.
    """
    htf_close = close_time_of(htf_df, htf_interval)
    htf_sorted = htf_df[htf_value_cols].reset_index(drop=True).copy()
    htf_sorted["__close_time__"] = htf_close.to_numpy()
    htf_sorted = htf_sorted.sort_values("__close_time__")

    ltf_frame = pd.DataFrame({"__close_time__": pd.Series(ltf_close_time).sort_values().to_numpy()})

    merged = pd.merge_asof(
        ltf_frame, htf_sorted, on="__close_time__", direction="backward", allow_exact_matches=True
    )
    return merged.set_index("__close_time__")[htf_value_cols]
