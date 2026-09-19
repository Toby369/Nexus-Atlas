# Wave Anchor: Feature-Spezifikation — 2026-09-19 (v2, aktualisiert)

Dieses Dokument beschreibt exakt, was `research-python/wave_anchor_research/` berechnet — als
präzise Referenz für `WAVE-ANCHOR-RESEARCH-REPORT.md` und für jeden, der den Code nachvollziehen
will, ohne ihn selbst zu lesen. Es behauptet nicht, Wave Anchors Original-Implementierung
nachzubilden (siehe `WAVE-ANCHOR-CODE-RECONSTRUCTION.md`, Kategorie A ist leer) — es beschreibt
die **eigene, look-ahead-sichere Forschungsimplementierung** des Konzepts.

**v2-Änderungen gegenüber v1**: WT1 und WT2 werden jetzt vollständig getrennt getestet (statt nur
WT2 anzunehmen); alle drei aus der Primärquelle bestätigten Threshold-Paare (±53/±60/+100,-75)
werden getestet (statt nur ±60); die Testmatrix folgt jetzt der Nutzer-Nummerierung TEST 1–12
(Abschnitt 9).

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

**v2**: alle Schwellenvergleiche (Abschnitt 4) werden jetzt für **WT1 und WT2 getrennt**
durchgeführt (`features.WAVE_NAMES = ["wt1", "wt2"]`) — in v1 wurde nur `wt2` angenommen; das ist
jetzt aufgehoben, da Kategorie D bestand (siehe Code-Reconstruction-Dokument Abschnitt 3) und die
v2-Aufgabenstellung explizit verlangt, beide Wellen unabhängig zu testen.

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

## 4. Feature-Definitionen (je HTF-Bar berechnet, dann projiziert) — v2, je Welle × Level

Alle in `features.py::compute_htf_observations()`. **v2-Neuerung**: jede Größe wird jetzt für
**beide Wellen** (`wt1`, `wt2`) und — wo sinnvoll — für **alle drei Threshold-Level** getrennt
berechnet (`features.THRESHOLD_LEVELS`, aus der Primärquelle, siehe Code-Reconstruction-Dokument
Abschnitt 2):

| Level | OB | OS |
|---|---|---|
| L1 | +53 | -53 |
| L2 | +60 | -60 |
| L3 | +100 | -75 |

Spaltenschema: `{wave}_{level}_{groesse}`, z. B. `wt2_L2_state`, `wt1_L1_dist_from_ob`. Strikte
`>`/`<`-Vergleiche — der Grenzwert selbst zählt NICHT als OB/OS.

- **State** (je Welle × Level): `"OB"` wenn Welle `> ob`, `"OS"` wenn Welle `< os`, sonst
  `"NEUTRAL"`. `None` solange die Welle selbst `NaN` ist (Anlaufzeit).
- **Direction** (je Welle, level-unabhängig): Vorzeichen von `wave.diff()` — `"RISING"` (> 0),
  `"FALLING"` (< 0), `"FLAT"` (== 0). `None` solange `diff` `NaN` ist.
- **Distance** (je Welle × Level): `dist_from_ob = ob - wave`, `dist_from_os = wave - os` —
  kontinuierliche, vorzeichenbehaftete Größen (negativ = bereits jenseits der Schwelle).
- **Cross Events** (je Welle × Level, vier Booleans): `cross_up_ob`, `cross_down_ob`,
  `cross_down_os`, `cross_up_os` — analog zu v1, jetzt parametrisiert über `ob`/`os` statt fest
  ±60. Während der Anlaufzeit: `False`, kein Cross feststellbar.
- **Anchor Duration** (je Welle × Level): `anchor_duration_ob`/`anchor_duration_os` — Anzahl
  aufeinanderfolgender bestätigter HTF-Bars, die ununterbrochen im jeweiligen Zustand waren.
  `NaN` solange `state` selbst unbekannt ist.

**Design-Entscheidung (unverändert aus v1)**: Cross-Events sind über die Projektion auf die
LTF-Zeitachse "sticky" für die gesamte Dauer der HTF-Periode, in der sie auftraten — nicht nur für
die eine LTF-Bar der Bestätigung selbst. Das folgt derselben `confirmed_asof_join`-Semantik wie
State/Direction.

## 5. MTF-Konfluenz

`features.py::mtf_confluence(state_a, state_b)`: wenn beide States identisch (`OB`/`OB`,
`OS`/`OS`, `NEUTRAL`/`NEUTRAL`) → dieser gemeinsame Zustand; sonst `"MIXED"`. `None`, wenn einer
der beiden States fehlt. **v2**: berechnet für alle 6 (Welle × Level)-Kombinationen
(`mtf_confluence_wt1_L1` … `mtf_confluence_wt2_L3`) in `assemble.py`, nicht mehr nur für eine feste
Kombination.

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

## 9. Statistik-Zellen (TEST 1–12, v2)

Siehe `stats_battery.py` und `run_research.py::_generate_cells()`. **v2 ersetzt die v1-Kategorien
A–G durch die Nutzer-Testmatrix TEST 1–12** (Aufgabenstellung v2, Abschnitt 14). Pro (Studien-Setup
× WaveTrend-Preset × Split × Horizont):

| Test | Beschreibung | Level-Scope | Zellen/Horizont |
|---|---|---|---|
| TEST 1 | Rank-IC von `wt1`, je HTF A/B | level-unabhängig | 2 |
| TEST 2 | Rank-IC von `wt2`, je HTF A/B | level-unabhängig | 2 |
| TEST 3 | WT1-State (OB/OS vs. Rest), je HTF A/B | **alle 3 Level** | 12 |
| TEST 4 | WT2-State (OB/OS vs. Rest), je HTF A/B | **alle 3 Level** | 12 |
| TEST 5 | Vier Cross-Events, je HTF A/B, je Welle | **nur L2 (±60)** | 16 |
| TEST 6 | Slope (RISING/FALLING vs. Rest), je HTF A/B, je Welle | level-unabhängig | 8 |
| TEST 7 | Rank-IC von `dist_from_ob`/`dist_from_os`, je HTF A/B, je Welle | **nur L2** | 8 |
| TEST 8 | Rank-IC von `anchor_duration_ob`/`_os`, je HTF A/B, je Welle | **nur L2** | 8 |
| TEST 9/10 | MTF-Konfluenz (OB/OS/MIXED vs. Rest), je Welle (welches Setup "9" bzw. "10" entspricht, ergibt sich aus `study_setup`) | **nur L2** | 6 |
| TEST 11 | State × Slope (3 States × 2 Richtungen), NUR HTF A, je Welle | **nur L2** | 12 |
| TEST 12 | Rank-IC der 4 Baseline-Kontrollgrößen (`baseline_momentum/_ema_trend/_rsi/_macd_hist`) — im Report explizit gegen TEST 1–4 gestellt (Abschnitt 19 der Aufgabenstellung) | — | 4 |

**Summe: 90 Zellen/Horizont/Setup/Preset** (v1 hatte 31 — die Erweiterung kommt aus der
WT1/WT2-Trennung und den zusätzlichen Threshold-Leveln bei TEST 3/4).

**Dokumentierte Scope-Entscheidung (vor jeder Ergebnisbetrachtung festgelegt, aus
Rechenzeitgründen)**: TEST 5/7/8/9/10/11 laufen nur auf Level 2 (±60) statt allen drei Leveln —
begründet durch (a) die Nutzer-Testmatrix selbst benennt TEST 5 explizit als "Cross ±60", (b)
Distanz/Duration sind kontinuierliche Transformationen der bereits in TEST 1/2 getesteten
Rohwelle, zusätzliche Level dort wären stark redundant, (c) ±60 ist das in allen gefundenen
öffentlichen Beschreibungen konsistent genannte Anchor-Level (Kategorie B). TEST 3/4 (State selbst)
laufen dagegen explizit auf allen 3 Leveln, da Abschnitt 6 der Aufgabenstellung das für die
zentrale Threshold-Frage ausdrücklich verlangt. TEST 11 bleibt wie in v1 auf HTF A beschränkt (HTF
B wäre bei den kleineren 4H/1D-Stichproben deutlich dünner besetzt).

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

## 11. Performance-Optimierung (v2)

**v2-Änderung**: die Rank-IC-Bootstrap-Berechnung (`evaluate_rank_ic`) wurde optimiert — statt
`scipy.stats.spearmanr` pro Bootstrap-Replikat neu aufzurufen (v1: ~28s/Zelle bei 1000
Replikaten auf dem vollen 113k-Zeilen-Trainingsset, der Grund, warum der v1-Lauf nicht in
praktikabler Zeit fertig wurde), werden die Ränge beider Reihen EINMAL vorab berechnet
(`scipy.stats.rankdata`) und die Bootstrap-Schleife berechnet pro Replikat nur noch eine
vektorisierte Pearson-Korrelation auf den bereits berechneten Rang-Arrays — mathematisch exakt
äquivalent zu Spearman (Spearman-IC = Pearson-Korrelation der Ränge), aber ca. 25× schneller
(gemessen: 1.1s/Zelle bei 1000 Replikaten selbst beim teuersten 7D-Horizont). Dadurch konnte
`N_REPLICATES_IC` von v1s 200 auf 1000 angehoben werden — gleiche Rigor-Stufe wie die
Condition-Zellen. OOS-Bestätigung verwendet für beide Zelltypen weiterhin 5000 Replikate.
