# Wave Anchor: Feature-Spezifikation — 2026-09-19

Dieses Dokument beschreibt exakt, was `research-python/wave_anchor_research/` berechnet — als
präzise Referenz für `WAVE-ANCHOR-RESEARCH-REPORT.md` und für jeden, der den Code nachvollziehen
will, ohne ihn selbst zu lesen. Es behauptet nicht, Wave Anchors Original-Implementierung
nachzubilden (siehe `WAVE-ANCHOR-CODE-RECONSTRUCTION.md`, Kategorie A ist leer) — es beschreibt
die **eigene, look-ahead-sichere Forschungsimplementierung** des Konzepts.

## 1. Datenbasis

BTC/USDT Perpetual Futures, Binance, UTC-Zeitstempel, `open_time`-indiziert. Vier Timeframes:

| Timeframe | Zeilen | Von | Bis | Herkunft |
|---|---|---|---|---|
| 15m | 141.668 | 2022-09-04 00:00 | 2026-09-18 16:45 | direkter Supabase-`candles`-Export |
| 1h | 35.422 | 2022-09-04 00:00 | 2026-09-18 21:00 | direkter Supabase-`candles`-Export |
| 4h | 8.855 | 2022-09-04 00:00 | 2026-09-18 16:00 | resampled aus 15m (siehe unten) |
| 1d | 1.476 | 2022-09-04 00:00 | 2026-09-18 00:00 | resampled aus 1h (siehe unten) |

Alle vier Reihen sind lückenfrei und duplikatfrei (verifiziert bei Ladezeit:
`raw[~raw.index.duplicated(keep="last")]`, sowie bereits in vorherigen Backtests dieser Session
für dieselbe zugrunde liegende 15m/1h-Quelle bestätigt).

**4h/1d-Herkunft**: eine gezielte Supabase-SQL-Abfrage zur Coverage-Prüfung von `candles` für
`interval in ('4h','1d')` wurde vom Nutzer zweimal abgelehnt; statt eines dritten Versuchs wurden
4h/1d deterministisch aus den bereits verfügbaren 15m/1h-Daten resampled (`open=first, high=max,
low=min, close=last`, `origin='start_day'`). Cross-validiert gegen einen unabhängig gezogenen
echten 4h-Datensatz (`lsob_backtest/data/BTCUSDT_4h.csv`, 2.375 überlappende Bars): open/high/low
stimmen exakt überein, close weicht im Mittel um 0.07 USD (< 0.02 %) ab — als vernachlässigbare
Exchange-Snapshot-Differenz eingeordnet, nicht als Resampling-Fehler.

## 2. WaveTrend-Kernberechnung

Siehe `wavetrend.py`, exakt aus dem verifizierten VuManChu-Cipher-B-Quelltext (Kategorie C):

```
hlc3 = (high + low + close) / 3
esa  = EMA(hlc3, chlen)
de   = EMA(|hlc3 - esa|, chlen)
ci   = (hlc3 - esa) / (0.015 * de)
wt1  = EMA(ci, avg)
wt2  = SMA(wt1, malen)
```

Zwei parallel getestete Parameter-Presets (Kategorie D, welches Wave Anchor tatsächlich
verwendet — siehe Code-Reconstruction-Dokument):

| Preset | chlen | avg | malen |
|---|---|---|---|
| `LazyBear-Original` | 10 | 21 | 4 |
| `VuManChu-Cipher-B-Default` | 9 | 12 | 3 |

EMA-Implementierung: `pandas.Series.ewm(span=N, adjust=False, min_periods=N)` (Standard-EMA,
kein Warmup-Auffüllen — die ersten `N-1` Werte je Stufe sind `NaN`, keine künstliche
Vorbelegung). `wt2` ist ein einfacher gleitender Durchschnitt (`rolling(window=malen,
min_periods=malen).mean()`) von `wt1`.

Alle Schwellenvergleiche (siehe Abschnitt 4) verwenden **`wt2`**, nicht `wt1` — eine dokumentierte
Annahme (Kategorie D), konsistent mit VuManChu Cipher B's eigener `wtOversold`/`wtOverbought`-
Logik (die ebenfalls `wt2` prüft, wenn auch gegen ±53 statt ±60).

## 3. Look-Ahead-sicherer MTF-Join

Siehe `mtf_join.py` und vollständig `WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md`. Kurzfassung: jede HTF-
Größe wird auf HTF-Ebene berechnet (Abschnitt 2 und 4), dann via
`confirmed_asof_join(ltf_close_time, htf_df, htf_interval, cols)` — `pandas.merge_asof(...,
direction="backward")` auf `HTF close_time ≤ LTF close_time` — auf die LTF-Zeitachse projiziert.
Vor der ersten bestätigten HTF-Bar: `NaN`, kein Rückwärts-Auffüllen.

Zwei Studien-Setups (`assemble.py::STUDY_SETUPS`):

| Setup | LTF | HTF A (näher) | HTF B (weiter) |
|---|---|---|---|
| "15m monitors 1H+4H" | 15m | 1h | 4h |
| "1H monitors 4H+1D" | 1h | 4h | 1d |

## 4. Feature-Definitionen (je HTF-Bar berechnet, dann projiziert)

Alle in `features.py::compute_htf_observations()`. `OB_THRESHOLD = +60.0`,
`OS_THRESHOLD = -60.0` (strikte `>`/`<`-Vergleiche, `wt2 == 60.0` selbst zählt NICHT als OB).

- **State**: `"OB"` wenn `wt2 > 60`, `"OS"` wenn `wt2 < -60`, sonst `"NEUTRAL"`. `None` solange
  `wt2` selbst `NaN` ist (Anlaufzeit).
- **Direction**: Vorzeichen von `wt2.diff()` — `"RISING"` (> 0), `"FALLING"` (< 0), `"FLAT"`
  (== 0). `None` solange `diff` `NaN` ist.
- **Distance**: `dist_from_ob60 = 60 - wt2`, `dist_from_os60 = wt2 - (-60)` — kontinuierliche
  Größen, vorzeichenbehaftet (negativ = bereits jenseits der Schwelle).
- **Cross Events** (vier, je ein Boolean pro HTF-Bar): `cross_up_60` (`wt2[t-1] < 60 ≤ wt2[t]`),
  `cross_down_60` (`wt2[t-1] ≥ 60 > wt2[t]`), `cross_down_minus60` (`wt2[t-1] > -60 ≥ wt2[t]`),
  `cross_up_minus60` (`wt2[t-1] ≤ -60 < wt2[t]`). Während der Anlaufzeit (aktueller oder
  vorheriger Wert `NaN`): `False`, kein Cross feststellbar.
- **Anchor Duration**: `anchor_duration_ob`/`anchor_duration_os` — Anzahl aufeinanderfolgender
  bestätigter HTF-Bars, die ununterbrochen im jeweiligen Zustand waren (Reset auf 0 sobald der
  Zustand verlassen wird). `NaN` solange `state` selbst unbekannt ist.

**Design-Entscheidung (dokumentiert, nicht Teil der unzugänglichen Original-Spezifikation)**:
Cross-Events sind über die Projektion auf die LTF-Zeitachse "sticky" für die gesamte Dauer der
HTF-Periode, in der sie auftraten — nicht nur für die eine LTF-Bar, die die Bestätigung selbst
auslöst. Das folgt derselben `confirmed_asof_join`-Semantik wie State/Direction, damit alle
Größen dieselbe Verfügbarkeitsregel teilen.

## 5. MTF-Konfluenz

`features.py::mtf_confluence(state_a, state_b)`: wenn beide States identisch (`OB`/`OB`,
`OS`/`OS`, `NEUTRAL`/`NEUTRAL`) → dieser gemeinsame Zustand; sonst `"MIXED"`. `None`, wenn einer
der beiden States fehlt. Berechnet für `mtf_confluence_combined` (HTF A × HTF B kombiniert) in
`assemble.py`; die Einzel-States `htfA_state`/`htfB_state` selbst dienen als "1H only"/"4H only"
(bzw. "4H only"/"1D only") Äquivalente für Test G.

## 6. Target-Definitionen

Siehe `targets.py`. Unabhängig vom bestehenden 3-Zustands-Market-State-Target der Nexus-
Produktion (wie explizit gefordert). Sechs Horizonte: `1H, 4H, 12H, 24H, 48H, 7D`, je Timeframe in
Bar-Zahlen umgerechnet (`horizon_bars_for_timeframe`, z. B. 15m → `{1H:4, 4H:16, 12H:48, 24H:96,
48H:192, 7D:672}`; 1h → `{1H:1, 4H:4, 12H:12, 24H:24, 48H:48, 7D:168}`).

Je Horizont `h` (in Bars) und Bar `t`:

- `forward_return = close[t+h] / close[t] - 1`
- `direction = sign(forward_return)` (+1/-1/0)
- `abs_return = |forward_return|`
- `mfe = max(high[t+1 .. t+h]) / close[t] - 1` (Maximum Favorable Excursion, Long-Sicht,
  EXKLUSIVE der aktuellen Bar selbst)
- `mae = min(low[t+1 .. t+h]) / close[t] - 1` (Maximum Adverse Excursion, Long-Sicht)

MFE/MAE sind bewusst nur als Long-Sicht definiert (eine Short-Interpretation ist das
Vorzeichen-Spiegelbild) — es wird explizit keine LONG/SHORT-Richtung in die Zieldefinition selbst
eingebaut. Die letzten `h` Bars jeder Reihe sind zwangsläufig `NaN` (kein vollständiger Horizont
mehr verfügbar, kein Wrap-Around).

## 7. Baseline-Features (Forschungs-Kontrollgrößen, NICHT für Nexus-Produktion)

Siehe `baselines.py`, Standardformeln:

- `baseline_momentum = close / close.shift(lookback) - 1` (Lookback: 16 Bars für 15m ≈ 4h,
  24 Bars für 1h ≈ 1 Tag — timeframe-passend gewählt, nicht optimiert)
- `baseline_ema_trend = EMA(close,12) - EMA(close,26)`
- `baseline_rsi`: Wilder-Glättung, Periode 14 (Standard)
- `baseline_macd_hist = MACD(12,26) - Signal(EMA9 von MACD)`

## 8. Regime-Klassifizierung (vor Ergebnis-Betrachtung festgelegt)

Siehe `regime.py`, auf 1D-Daten berechnet, look-ahead-sicher via `confirmed_asof_join` auf die
LTF-Zeitachse projiziert (derselbe Mechanismus wie alle anderen HTF-Größen):

- `trend_regime`: `SMA50` (`TREND_SMA_WINDOW=50`) auf Daily-Close, Steigung über die letzten 10
  Tage (`TREND_SLOPE_LOOKBACK=10`, `sma - sma.shift(10)`). `"BULL"` wenn `close > SMA` UND `SMA`
  steigend; `"BEAR"` wenn `close < SMA` UND `SMA` fallend; sonst `"SIDEWAYS"`.
- `vol_regime`: rollierende 20-Tage (`VOL_WINDOW=20`) realisierte Volatilität der Log-Returns,
  in Terzile (`LOW`/`MID`/`HIGH`) über die volle verfügbare 1D-Historie eingeteilt
  (`pandas.qcut(q=3)`).

## 9. Statistik-Zellen (Tests A–G)

Siehe `stats_battery.py` und `run_research.py::_generate_cells()`. Pro (Studien-Setup ×
WaveTrend-Preset × Split × Horizont) werden 31 Zellen erzeugt:

| Kategorie | Beschreibung | Zellen/Horizont |
|---|---|---|
| A | Rank-IC von `htfA_wt2`/`htfB_wt2` gegen `forward_return` | 2 |
| B | Anchor-State (OB/OS vs. Rest), je `htfA_state`/`htfB_state`/`mtf_confluence_combined` | 6 |
| C | Vier Cross-Events, je HTF A/B | 8 |
| D | Slope (RISING/FALLING vs. Rest), je HTF A/B | 4 |
| E | Rank-IC von `dist_from_ob60`/`dist_from_os60`, je HTF A/B | 4 |
| F | State × Slope-Kombinationen (3 States × 2 Richtungen), NUR HTF A (Scope-Entscheidung — HTF B
    wäre bei den kleineren 4H/1D-Stichproben deutlich dünner besetzt) | 6 |
| G | `mtf_confluence_combined == "MIXED"` vs. Rest | 1 |

Zwei Test-Mechaniken:

- **Bedingt** (`evaluate_condition_vs_complement`): Moving-Block-Bootstrap-Mitteldifferenz
  (`src/validation/block_bootstrap.py::block_bootstrap_mean_difference`, wiederverwendet, nicht
  neu implementiert) — Baseline = unkonditionierter Stichproben-Mittelwert (nicht 0). Frage:
  "unterscheidet sich diese Bedingung vom Rest der Stichprobe", nicht "ist der Forward-Return von
  Null verschieden".
- **Kontinuierlich** (`evaluate_rank_ic`): Spearman-Rangkorrelation mit Block-Bootstrap-
  Konfidenzintervall (`moving_block_bootstrap`, eigene `statistic_fn`).

`MIN_N = 30` je Gruppe (Bedingung UND Komplement) — unterhalb dessen: `INSUFFICIENT_DATA`, kein
p-Wert. Block-Länge = `max(2, 2 × horizon_bars)` (konservative Marge, dieselbe Herleitungsregel
wie `block_bootstrap.py`s eigenes `H=7d → L=14d`).

BH-FDR (`statsmodels.stats.multitest.multipletests(method="fdr_bh")`) wird **einmal über den
gesamten gepoolten TRAIN_VAL-Zellensatz** angewendet (alle Setups × Presets × Horizonte × Tests
zusammen) — konsistent mit der in dieser Codebasis etablierten "kumulativ, EIN Pool"-Konvention.

## 10. TRAIN_VAL/OOS-Split

Chronologischer 80/20-Split je (Setup × Preset)-Kombination (`_split_train_oos`, `OOS_FRACTION =
0.20`). BH-FDR-Selektion erfolgt ausschließlich auf `TRAIN_VAL`. Nur BH-signifikante Zellen werden
anschließend auf dem bis dahin unberührten `OOS`-Split erneut getestet (identische
Zellendefinition, höhere Replikatzahl: 5000 statt 1000/200), ohne weitere Parameteranpassung.

## 11. Nicht (mehr) offene Punkte

Replikatzahlen wurden aus gemessener Rechenzeit abgeleitet (nicht aus Rigor-Erwägungen reduziert):
`N_REPLICATES_CONDITION = 1000` (~0.7s/Zelle selbst beim längsten 7D-Horizont),
`N_REPLICATES_IC = 200` (Rank-IC ist ~40× teurer pro Replikat, da `scipy.stats.spearmanr` nicht
vektorisiert werden kann). OOS-Bestätigung verwendet für beide Zelltypen 5000 Replikate.
