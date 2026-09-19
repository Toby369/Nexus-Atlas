# Wave Anchor: Repaint-Audit — 2026-09-19 (v3)

Aktualisiert `WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md` (v1/v2) um die von v3 Abschnitt 11 geforderte
explizite Klassifikation je Größe (`NO_REPAINT`/`CONDITIONAL_REPAINT`/`REPAINT`).

## 1. Regel und Implementierung (unverändert aus v1/v2)

Eine HTF-Kerze mit `open_time=T`, Intervall-Dauer `D` gilt als bestätigt ab `close_time=T+D`. Für
jede LTF-Bar mit eigenem `close_time=t` wird ausschließlich der Wert der zuletzt bestätigten
HTF-Kerze mit `close_time ≤ t` zugeordnet. Implementiert in
`mtf_join.py::confirmed_asof_join()` (`pandas.merge_asof(direction="backward")`), verwendet für
JEDE HTF-abgeleitete Größe dieses Projekts (WT1, WT2, State, Cross, Distance, Duration, MTF-
Konfluenz, Regime) — ein einziger, exhaustiv getesteter Mechanismus statt Einzelfall-Logik.

## 2. Synthetischer Beweis (unverändert, weiterhin bestehend)

5 aufeinanderfolgende 4H-Bars mit Testwerten `[10,20,30,40,50]`. Für die 12:00–16:00-Bar
(`close_time=16:00`, Wert 40): alle 15m-LTF-Bars mit `close_time<16:00` sehen weiterhin `30`
(vorherige bestätigte Bar), erst ab `close_time≥16:00` wird `40` sichtbar — geprüft für die
**volle Serie**, nicht nur Stichproben (`test_no_leakage_across_full_15m_series_around_4h_boundary`).
Zusätzlich: vor der allerersten HTF-Bestätigung `NaN`, kein künstliches Rückwärts-Auffüllen
(`test_before_first_htf_close_is_nan_not_backfilled`). **Alle 6 Tests in `test_mtf_join.py`
bestehen.**

## 3. Klassifikation je Größe (v3 Abschnitt 11, explizit gefordert)

| Größe | Klassifikation | Begründung |
|---|---|---|
| **WT1** (fast_wave) | **NO_REPAINT** | Ausschließlich aus abgeschlossenen HTF-OHLC-Kerzen berechnet, dann per `confirmed_asof_join` projiziert — kein Wert wird nach Bestätigung nachträglich geändert (bewiesen in Abschnitt 2). |
| **WT2** (slow_wave) | **NO_REPAINT** | Gleicher Mechanismus wie WT1. |
| **+60-Cross** (`cross_above_60`/`cross_below_60`) | **NO_REPAINT** | Cross-Erkennung basiert auf `wt[t-1]`/`wt[t]` beider bereits abgeschlossener HTF-Bars — kein Fall, in dem ein historisch markierter Cross nachträglich verschwindet oder sich verschiebt. |
| **-60-Cross** (`cross_below_minus60`/`cross_above_minus60`) | **NO_REPAINT** | Analog. |
| **MTF-State** (`above_60`/`between_levels`/`below_minus_60`) | **NO_REPAINT** | Direkt aus `WT2` (bzw. der gewählten Welle) abgeleitet, dieselbe Garantie. |
| **MTF-Konfluenz** (1H-State × 4H-State bzw. 4H × 1D) | **NO_REPAINT** | Kombination zweier bereits look-ahead-sicherer Einzelgrößen — `mtf_confluence()` selbst führt keine neue Zeitbezug-Logik ein. |

**Wichtige Einschränkung (wie in v1/v2)**: diese Klassifikation gilt für die
**Forschungsimplementierung**, nicht als verifizierte Aussage über StormCat1s tatsächliches
Live-Verhalten auf TradingView selbst — dafür fehlt weiterhin der literale Quelltext (Kategorie A
leer, siehe `WAVE-ANCHOR-ORIGINAL-SOURCE.md`). Die Forschung testet das **Konzept** unter der
striktesten sicheren Auslegung der von Pine's `security()`-Defaults erzwungenen Semantik
(Abschnitt 2 von `WAVE-ANCHOR-SECURITY-AUDIT.md`).

## 4. Prüfpunkte aus v3 Abschnitt 11 einzeln beantwortet

1. **Ändert sich der WT-Wert während eine HTF-Kerze noch läuft?** In der Forschungsimplementierung
   nicht beobachtbar — es wird ausschließlich mit bereits geschlossenen historischen Kerzen
   gerechnet, es gibt keine "sich noch bildende" Kerze im Backtest-Kontext.
2. **Kann ein historisch sichtbares Signal verschwinden?** Nein, per Konstruktion — ein Wert ist
   entweder bestätigt und final oder gar nicht vorhanden (`NaN`).
3. **Weichen historische Labels von Echtzeit-sichtbaren ab?** Nein — `confirmed_asof_join`
   verwendet ausschließlich zum jeweiligen Zeitpunkt real bereits vorliegende Werte (bewiesen).
4. **Werden zukünftige HTF-Werte verwendet?** Nein, verifiziert durch die Tests in Abschnitt 2.

## 5. Fazit

**REPAINTING (Forschungsimplementierung) = NO_REPAINT für alle sechs geprüften Größen**, belegt
durch 6 automatisierte Tests in `test_mtf_join.py` plus die look-ahead-Ende-zu-Ende-Prüfung in
`test_features.py`. Für StormCat1s tatsächliches Live-Skript bleibt der Status **UNKNOWN** (kein
Codezugriff) — mit der Einschränkung, dass die vom Nutzer beschriebene und durch die offizielle
Beschreibungsseite gestützte `security()`-Verwendung (ohne `lookahead_on`) keinerlei Hinweis auf
absichtliches Repainting liefert.
