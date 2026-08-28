# research-python — Status & Roadmap

Offizieller Status- und Architektureintrag nach Abschluss von Phase 4
(Production Factor Benchmark). Reine Dokumentation — keine Code-Änderung
ist mit diesem Eintrag verbunden.

---

## Teil 1 — Chronologische Roadmap & Phasenübersicht

**Ausgangslage:** `BENCHMARK_RESULTS.md` (Phase 4) kommt zu einem klaren
Ergebnis — n=201 reicht nicht für eine statistisch belastbare Aussage. Der
limitierende Faktor ist durchgehend Stichprobengröße, deckt sich mit dem
SQL-Track (`docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md`). Die passive
Datensammlung (Supabase `pg_cron`, 1D-Intervall) läuft unabhängig von den
research-python-Phasen automatisch weiter.

### 1. Sofort umsetzbare Ingenieursarbeiten (keine Datenabhängigkeit)

| Arbeitspaket | Status | Beschreibung |
|---|---|---|
| Moving-Block-Bootstrap-Inferenz | ✅ **Erledigt** (`src/validation/block_bootstrap.py`, Commit s. Git-Historie) | Wiederverwendbare Funktion für den künftigen konfirmatorischen Test (L=14 Tage, geblockt auf voller Kalenderreihe, gemäß `docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md` Abschnitt 6a). 100% Testabdeckung, inkl. empirischem Nachweis (nicht nur Dokumentation) der Kernaussage "korrigiert Inferenz, erzeugt keine Information" auf synthetisch autokorrelierten Daten. Noch nicht in `benchmark_production.py` verdrahtet — folgt erst mit echten Daten (siehe Teil 2/3). |
| PBO-Statistik-Aggregation | Offen | Implementierung der Probability-of-Backtest-Overfitting-Kennzahl über CPCV-Pfade in `walk_forward.py` — Ergänzung zu `generate_combinatorial_splits()`, das aktuell nur die Split-Generierung liefert, nicht die Pfad-Aggregation. |
| SHAP-basierte Feature Importance (optional) | Offen | Alternative zu MDI in `evaluate.py`, bislang als dokumentierte, bewusst nicht gewählte Option vermerkt (zusätzliche schwere Dependency vs. Nutzen abgewogen) — bei Bedarf nachrüstbar. |
| Migrations-Entscheidungs-Framework | ✅ **Erledigt** (`src/validation/decision_framework.py`, Commit s. Git-Historie) | Überführung der 4 Decision Gates aus `BENCHMARK_RESULTS.md` Abschnitt 8 in ein automatisiertes, dreiwertiges (`PASS`/`FAIL`/`INSUFFICIENT_DATA`) Python-Modul + `combine_gate_results()` (strikte Priorisierungsregel: jede `INSUFFICIENT_DATA` schlägt jede `FAIL`). Nutzt `block_bootstrap.py` für Gate 3. 100% Testabdeckung, inkl. Golden-Value-Abgleich von `statistical_power`/`required_sample_size` gegen die exakte Required-n-Tabelle aus `PHASE-3.2-PROTOCOL-CORRECTION.md` Abschnitt 8 (alle 5 Werte exakt getroffen) und einem End-to-End-Test auf der realen aktuellen Stichprobengröße n=201, der bestätigt, dass das Framework dort korrekt `INSUFFICIENT_DATA` liefert. Noch nicht gegen echte Daten für eine tatsächliche Entscheidung ausgeführt — das bleibt an die Phase-3.2-Power-Anforderungen gebunden. |

### 2. Datengetriebene Meilensteine (warten auf passive Akkumulation)

| Meilenstein | Ziel | Zeithorizont |
|---|---|---|
| Coverage der 8 fehlenden Legacy-Faktoren | oi_price, positioning, orderbook, options, macro, funding, sentiment, basis erreichen reale Rohdaten-Historie | abhängig von Rohdatenquellen-Historie |
| RAW-N-Schwellen | n=200 / n=300 / n=1000 (alle States) | ca. 03/2027 / 07/2027 / 06/2029 |
| Statistische Power | adäquate Power für die primäre 168h/7d-Zelle, je Effektgröße | +15pp ca. 12/2030, +13pp ca. 05/2032, +10pp ca. 05/2036, +8pp ca. 11/2041, +5pp nicht realistisch erreichbar |

### 3. Anschließende Schritte (erst nach hinreichender Power sinnvoll)

1. Wiederholung des exakten Benchmarks (`benchmark_production.py`, gleiche Methodik) auf dem dann realen, größeren Datensatz — nicht auf einem synthetisch vergrößerten.
2. Formaler, Multiple-Testing-korrigierter Signifikanztest zwischen Legacy- und neuem Faktor-Set (nicht nur der deskriptive Zahlenvergleich aus dem aktuellen Report).
3. Finale Migrationsentscheidung — folgt einzig aus Schritt 2, nie aus dem aktuellen n=201-Mechanik-Lauf.

**Kernaussage:** Abschnitt 1 ist sofort bearbeitbar, unabhängig vom Datenstand. Abschnitte 2–3 sind strikt zeitgebunden und durch keine weitere Implementierungsarbeit beschleunigbar — das ist die bereits in Phase 3.2 mathematisch hergeleitete Kernerkenntnis, hier nur erneut referenziert.

---

## Teil 2 — Golden-Value-Methodik & Testabdeckung

### 1. Golden-Value-Methodik (`tests/test_legacy_factors.py`)

Zwei unabhängige Berechnungswege werden gegeneinander geprüft — kein zirkulärer Test:

- **Weg A (Referenz):** `backtest_states.factors` (Postgres/SQL), berechnet von der in Phase 0–3 validierten, point-in-time-sicheren Rekonstruktionsfunktion (asof-Joins, kein Lookahead) — als `reference_factors_jsonb` in `data/btc_1d_trainval_snapshot.csv` exportiert.
- **Weg B (Prüfling):** `legacy_factors.py` (Python), unabhängig aus denselben rohen `market_features`-Spalten berechnet — liest die Referenz-JSON nie als Input.

**Ablauf:** CSV laden → `compute_all_legacy_factors()` → für jeden der 14 Faktoren (`@pytest.mark.parametrize`, eigenständiges Testergebnis pro Faktor) exakter Abgleich `computed[factor]` vs. `reference[factor]["value"]`, NaN==NaN als Übereinstimmung gewertet.

**Ergebnis:** 14 Faktoren × 201 Zeilen = **2.814 Einzelprüfungen, 100% exakte Übereinstimmung im ersten Testlauf** — keine Nachbesserung an `legacy_factors.py` nötig (im Unterschied zum ADX-Modul aus Phase 2, wo ein analoger unabhängiger Referenzvergleich einen echten Implementierungsfehler aufdeckte).

**Rollentrennung:** `test_legacy_factors.py` validiert die mathematische Exaktheit (Zeilen-für-Zeilen-Golden-Value-Abgleich). `test_benchmark.py` prüft eine andere Ebene: Pipeline-Orchestrierung (synthetische Mini-Datensätze, schnell/deterministisch) plus ein End-to-End-Smoke-Test auf der echten CSV, der bestätigt, dass `main()` fehlerfrei durchläuft und der generierte Bericht den Pflicht-Disclaimer sowie alle 8 NOT-EVALUABLE-Faktornamen enthält — Struktur-/Vollständigkeitsprüfung, keine Zahlen-Validierung.

### 2. Testabdeckung (250 Tests, 98% Coverage)

| Testdatei | Tests |
|---|---|
| test_legacy_factors.py | 40 |
| test_selection.py | 40 |
| test_walk_forward.py | 30 |
| test_block_bootstrap.py | 40 |
| test_decision_framework.py | 53 |
| test_benchmark.py | 15 |
| test_derivatives.py | 12 |
| test_momentum.py | 10 |
| test_volatility.py | 10 |
| **Gesamt** | **250** |

| Modul | Coverage | Offene Zeilen (Charakter) |
|---|---|---|
| `features/legacy_factors.py` | 100% | — |
| `selection/orthogonal.py` | 100% | — |
| `features/derivatives.py` | 100% | — |
| `validation/block_bootstrap.py` | 100% | — |
| `validation/decision_framework.py` | 100% | — |
| `benchmark_production.py` | 99% | `FileNotFoundError`-Guard (nie getriggert, CSV existiert im Testumfeld immer); `if __name__=="__main__"` (unter pytest strukturell unerreichbar) |
| `features/volatility.py` | 98% | Unsorted-Index-Guard (keine Testdaten mit vertauschter Reihenfolge für dieses Modul) |
| `selection/evaluate.py` | 97% | 2× Stability-Score-Fallback (n<2 bzw. Mittelwert≈0, in aktuellen Testdaten nie erreicht); 1× Cluster-Zuordnungs-Fallback (strukturell unerreichbar, jedes Feature gehört in der Pipeline immer einem Cluster an); 1× "keine Folds erzeugt"-Guard |
| `validation/walk_forward.py` | 96% | 4× defensive Validierungs-Raises für Parameterkombinationen, die durch andere, bereits getestete Checks vorher abgefangen werden oder in aktuellen Szenarien nicht auftreten |
| `features/momentum.py` | 91% | Unsorted-Index-Guard; 2× früher Return in `_wilder_smooth` bei zu wenig Daten; 1× NaN-Propagationszweig; 1× Guard für ungültige Horizont/Bar-Intervall-Kombination |
| **Gesamt** | **98%** | 17 von 914 Zeilen |

**Einordnung:** Alle ungetesteten Zeilen sind defensive Validierungs-/Guard-Branches — entweder durch vorgelagerte Checks bereits verhindert, oder Fallback-Pfade für Situationen, die in den aktuellen (echten wie synthetischen) Testdaten nie auftreten. Keine betrifft Kernlogik der Faktorberechnung, der Walk-Forward-Splits oder der Golden-Value-Validierung selbst.
