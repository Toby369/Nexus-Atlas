# Wave Anchor: MTF-/Look-Ahead-Audit — 2026-09-19

## 1. Die Regel

Historische Forschung darf zu keinem Zeitpunkt `t` auf Informationen zugreifen, die zum
Zeitpunkt `t` real noch nicht verfügbar waren. Für Multi-Timeframe-Daten heißt das konkret:

> Eine HTF-Kerze mit `open_time = T` und Intervall-Dauer `D` gilt als **bestätigt** ab
> `close_time = T + D` (inklusive). Für eine LTF-Bar, deren eigener Schlusszeitpunkt `t` ist,
> ist der zulässige HTF-Wert der der zuletzt bestätigten HTF-Kerze mit `close_time ≤ t`.

Beispiel aus der Aufgabenstellung: eine 4H-Kerze von 12:00 bis 16:00 wird erst um 16:00
bestätigt — ihr WaveTrend-Wert darf **nicht** rückwirkend 12:15, 12:30, ..., 15:45 zugeordnet
werden.

## 2. Warum `close_time` der LTF-Bar, nicht `open_time`

Die Forschungsimplementierung verankert die Verfügbarkeitsprüfung an der LTF-Bar **eigenem
Schlusszeitpunkt**, nicht ihrem Öffnungszeitpunkt. Begründung: durchgängige Konvention dieser
Codebasis (Old-Money-Stack, AVWAP-Pivot, Elliott-Wave — alle Backtests dieser Session) ist
"Entry = Close der Signal-Bar", d.h. eine Bar gilt selbst erst nach ihrem eigenen Schluss als
"bekannt". Würde man stattdessen `open_time` verwenden, würde man implizit unterstellen, man
könne schon beim Öffnen einer LTF-Bar auf Informationen zugreifen, die erst während ihrer
Laufzeit entstehen — ein zweites, eigenständiges Look-Ahead-Problem zusätzlich zum
MTF-spezifischen.

## 3. `request.security()` — Pine-Semantik (Kategorie B/C, siehe
   WAVE-ANCHOR-CODE-RECONSTRUCTION.md)

| Parameter | Bedeutung | Risiko |
|---|---|---|
| `gaps` (`barmerge.gaps_off`/`gaps_on`) | `gaps_off`: letzter bekannter HTF-Wert wird zwischen HTF-Updates fortgeschrieben. `gaps_on`: `na`, bis die naechste HTF-Bar vorliegt. | Kein Look-Ahead-Risiko an sich — betrifft nur, WIE zwischen bestätigten Werten interpoliert wird. |
| `lookahead` (`barmerge.lookahead_off`/`lookahead_on`) | `lookahead_off` (sicherer Standard): nur bereits geschlossene HTF-Bars sichtbar. `lookahead_on`: kann bei historischer (nicht Echtzeit-)Berechnung den sich noch bildenden HTF-Wert VORZEITIG offenlegen. | **Direktes Look-Ahead-Risiko.** Im tatsächlich eingesehenen VuManChu-Cipher-B-Quelltext wird `lookahead_on` in `f_getTFCandle` (Sommi-Diamond-Feature) verwendet — ein reales, im Code sichtbares Repainting-Risiko in einer VuManChu-Nebenfunktion, NICHT in der WaveTrend-Kernberechnung selbst (`f_wavetrend` nutzt `security()` ohne expliziten `lookahead`-Parameter = sicherer Pine-v4-Default). |
| `offset` | Verschiebt das Ergebnis um N Bars. | Kein Hinweis auf Verwendung in Wave Anchor gefunden. |

**Konsequenz für diese Forschung**: unabhängig davon, was Wave Anchor selbst tatsächlich tut
(nicht verifizierbar, siehe Code-Reconstruction-Dokument), erzwingt die
Forschungsimplementierung ausschließlich den sicheren Modus — Kategorie
"CONFIRMED HTF ONLY" per Aufgabenstellung Abschnitt 5. Es gibt in `mtf_join.py` keinen
Lookahead-Modus, keinen Parameter, der ihn aktivieren könnte.

## 4. Implementierung

`research-python/wave_anchor_research/mtf_join.py::confirmed_asof_join()` — `pandas.merge_asof`
mit `direction="backward"`, verankert auf `HTF close_time <= LTF close_time`. `close_time`
selbst wird deterministisch aus `open_time + Intervall-Dauer` hergeleitet (die vorhandenen
CSV-Exporte führen nur `open_time`; Lückenfreiheit der zugrunde liegenden Kerzen wurde für
dieselben Datensätze bereits in `AVWAP-PIVOT-CONFLUENCE-BACKTEST_2026-09-18.md` verifiziert).

## 5. Synthetischer Beweis (Aufgabenstellung Abschnitt 6, wörtlich umgesetzt)

5 aufeinanderfolgende 4H-HTF-Bars (2025-01-01 00:00–20:00) mit den Testwerten
`wt2 = [10, 20, 30, 40, 50]` — die Bar von 12:00–16:00 hat `close_time=16:00`, Wert `40`.
15m-LTF-Bars von 15:00 bis 16:45 wurden durch `confirmed_asof_join` geschickt und **jede
einzelne** Bar geprüft:

| LTF close_time | Erwarteter HTF-Wert | Begründung |
|---|---|---|
| 15:15, 15:30, 15:45 | 30 | 12:00–16:00-Bar noch nicht geschlossen |
| **16:00** | **40** | 12:00–16:00-Bar exakt jetzt bestätigt |
| 16:15 ... 16:45 | 40 | weiterhin die zuletzt bestätigte Bar |

Test `test_no_leakage_across_full_15m_series_around_4h_boundary` (in
`research-python/wave_anchor_research/tests/test_mtf_join.py`) prüft dies **für die volle
Serie**, nicht nur Stichproben — `assert (before_boundary["wt2"] == 30.0).all()` und
`assert (at_or_after_boundary["wt2"] == 40.0).all()`. Zusätzlich: `test_before_first_htf_close_is_nan_not_backfilled`
prüft, dass vor der allerersten HTF-Bestätigung `NaN` steht, nicht künstlich rückwärts
aufgefüllt wird.

**Ergebnis: alle 6 Tests in `test_mtf_join.py` bestehen** (`python3 -m pytest tests/test_mtf_join.py -q`
→ `6 passed`).

## 6. Repainting-Audit (Aufgabenstellung Abschnitt 7)

| Prüfpunkt | Befund |
|---|---|
| 1. Ändert sich der WT-Wert, während eine HTF-Kerze noch läuft? | In dieser Forschungsimplementierung: **nein, per Konstruktion nicht beobachtbar** — es wird ausschließlich mit bereits abgeschlossenen historischen Kerzen aus der Datenbank gerechnet, es gibt keine "sich noch bildende" Kerze im Backtest-Kontext. Für Wave Anchors LIVE-Verhalten auf TradingView selbst: unbekannt (Kategorie D, siehe Code-Reconstruction-Dokument). |
| 2. Kann ein Anchor vor HTF-Schluss wieder verschwinden? | Nicht anwendbar auf die Forschungsimplementierung (siehe 1) — dort ist ein HTF-Wert entweder bestätigt und final, oder gar nicht vorhanden (NaN). |
| 3. Weichen historische Labels von dem ab, was in Echtzeit sichtbar gewesen wäre? | **Nein, per Konstruktion** — `confirmed_asof_join` verwendet ausschließlich Werte, die zum jeweiligen LTF-Zeitpunkt bereits real vorlagen (bewiesen in Abschnitt 5). |
| 4. Werden zukünftige HTF-Werte verwendet? | **Nein** — verifiziert durch die Tests in Abschnitt 5. |
| 5. Repaintet die Implementierung? | Siehe Fazit unten. |

**Erforderliches Fazit: `REPAINTING = FALSE`** — für die Forschungsimplementierung in
`wave_anchor_research/`, mit Beleg durch 6 bestehende automatisierte Tests
(`test_mtf_join.py`). **Nicht** geprüft und nicht prüfbar: ob StormCat1s tatsächliches
Live-TradingView-Skript selbst repaintet — dazu fehlt der Originalquelltext (siehe
WAVE-ANCHOR-CODE-RECONSTRUCTION.md Abschnitt 0). Diese Forschung testet das KONZEPT unter der
striktesten sicheren Auslegung, nicht Wave Anchors konkrete Implementierung.
