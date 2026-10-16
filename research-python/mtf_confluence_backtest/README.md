# Multi-Timeframe-Confluence: Backtest (BTCUSDT)

Prüft das Konzept „Marktstruktur + Volume Profile (hoher TF) + RSI/MACD (mittlerer TF) +
Spot/Perp-CVD + Liquidity-Sweep/CHoCH (Einstiegs-TF)“ mechanisch auf BTCUSDT (Binance USDT-M
Perpetual, Spot für den Spot-CVD), 15m-Daten von 2020-01 bis 2026-09. Zwei Timeframe-Sets
(Einstieg/Filter/Trend): **15m/1h/4h** und **1h/4h/1D**. Alle Längen in `config.py` sind in
Kerzen angegeben und skalieren mit dem Set.

## Ausführen

```bash
cd research-python/mtf_confluence_backtest
pip install -r requirements.txt
python run_backtest.py            # beide Sets; lädt beim ersten Lauf ~160 Monats-ZIPs von data.binance.vision
python run_backtest.py --tf 1h    # nur 1h/4h/1D
pytest
```

Ausgabe in `output/`: `backtest_report_<tf>.md` (alle Tabellen), `equity_r_<tf>.png`,
`trades_<tf>.csv` sowie `comparison.md` (beide Sets nebeneinander).

## Regeln (vorab festgelegt, nicht optimiert, siehe `config.py`)

Beschrieben für das Set 15m/1h/4h; bei 1h/4h/1D gelten dieselben Kerzenzahlen auf 1h/4h/1D.

| Baustein | Umsetzung |
|---|---|
| Trend 4h | Pivots (3/3). Bull = letztes Pivot-Hoch > vorheriges UND letztes Pivot-Tief > vorheriges UND Close > letztes Tief. Bear gespiegelt. |
| Zone 4h | Rollierendes Volume Profile über 90 4h-Kerzen (15 Tage) aus 15m-Kerzen. Sweep-Extrem innerhalb ±0,5 × ATR(4h) um POC/VAL (long) bzw. POC/VAH (short). |
| Momentum 1h | RSI(14) war in den letzten 8 h ≤ 45 (short ≥ 55) UND MACD-Histogramm steigt (fällt). |
| CVD Spot/Perp | Taker-Delta aus Klines (`2·taker_buy − volume`), Summe über 8 h relativ zum Volumen. Long: Spot > 0 und Perp < Spot. Short gespiegelt. |
| Vol-Spike 15m | Volumen der Sweep-Kerze ≥ 1,5 × Ø der vorherigen 20 Kerzen. |
| Trigger 15m | Wick unter das letzte bestätigte 15m-Pivot-Tief, Close wieder darüber (Sweep). Danach innerhalb von 12 Kerzen Close über das letzte bestätigte 15m-Pivot-Hoch (CHoCH). Einstieg zum nächsten Open. |
| Stop / TP | Stop = Sweep-Extrem − 0,1 × ATR(15m). TP fix 2R oder nächstes 4h-Level (POC/VAH/Pivot) mit mindestens 1,5R. Zeitstopp 48 h. Stops enger als 0,15 % werden nicht gehandelt. |
| Kosten | 0,05 % Taker-Gebühr + 0,02 % Slippage pro Seite. |

Look-Ahead-Schutz: Werte höherer Timeframes werden erst nach dem Close ihrer Kerze verwendet,
Pivots erst nach ihrer Bestätigung. Berührt eine Kerze Stop und TP, zählt der Stop (siehe
`tests/test_lookahead.py`).

## Ergebnis 15m/1h/4h (Lauf vom 13.10.2026)

Ergebnisse in R nach Kosten. t = t-Statistik des Ø R.

| Variante | Trades | Trefferquote | Ø R brutto | Ø R netto | t | PF |
|---|---:|---:|---:|---:|---:|---:|
| A: nur 15m-Trigger | 3357 | 34,7 % | +0,008 | −0,173 | −7,2 | 0,77 |
| B: A + Trend 4h | 1346 | 35,6 % | +0,049 | −0,147 | −3,8 | 0,81 |
| C: B + Zone 4h | 339 | 36,3 % | +0,084 | −0,142 | −1,8 | 0,82 |
| D: C + Momentum 1h | 157 | 34,4 % | +0,028 | −0,187 | −1,7 | 0,76 |
| E: D + CVD | 53 | 39,6 % | +0,189 | −0,010 | −0,1 | 0,99 |
| F: E + Vol-Spike (alles) | 17 | 52,9 % | +0,588 | +0,413 | 1,1 | 1,75 |
| G: Trend + ≥2 von 4 Filtern | 570 | 37,0 % | +0,086 | −0,108 | −1,8 | 0,85 |

Einordnung:

1. **Die Kosten fressen den Edge.** Der mittlere Stop liegt bei etwa 0,8–1 % vom Preis. Damit
   kosten Gebühr und Slippage pro Trade 0,18–0,22 R. Brutto liegen fast alle Varianten zwischen
   0 und +0,1 R, netto alle im Minus.
2. **Der 15m-Trigger allein ist Zufall.** Brutto +0,008 R bei 3357 Trades: kein Vorteil
   gegenüber einem zufälligen Einstieg mit 2R-Ziel.
3. **Trend 4h, Zone 4h und CVD verbessern die Brutto-Erwartung leicht.** Der Momentum-Filter
   (1h-RSI/MACD) verschlechtert sie. Der Volumen-Spike ist allein der stärkste Filter
   (+0,12 R brutto), aber nur Out-of-Sample (In-Sample −0,22 R netto).
4. **Die volle Kombination (F) ist nicht belastbar.** 17 Trades in knapp 7 Jahren, t = 1,1.
   In-Sample negativ (7 Trades, −0,36 R), Out-of-Sample positiv (10 Trades, +0,96 R). Das ist
   statistisch von Glück nicht zu unterscheiden.
5. **TP am 4h-Level bringt nichts** gegenüber festen 2R.

Fazit: In dieser mechanischen Form hat das Konzept auf BTC-15m nach Kosten keinen
nachweisbaren Edge. Ansätze, die getestet werden müssten, bevor man weiterbaut: höhere
Timeframes (1D/4h/1h), um die Kosten pro R zu senken; Limit-Einstieg (Maker) statt Market;
Vol-Spike und CVD als Kernfilter statt RSI/MACD. Jede dieser Änderungen ist eine neue
Hypothese und braucht einen eigenen Out-of-Sample-Test, sonst ist es Kurvenanpassung.

## Ergebnis 1h/4h/1D (Lauf vom 13.10.2026)

| Variante | Trades | Trefferquote | Ø R brutto | Ø R netto | t | Ø R netto ab 2024 |
|---|---:|---:|---:|---:|---:|---:|
| A: nur 1h-Trigger | 812 | 34,6 % | +0,012 | −0,071 | −1,5 | −0,106 |
| B: A + Trend 1D | 348 | 35,6 % | +0,074 | −0,018 | −0,2 | −0,195 |
| C: B + Zone 1D | 62 | 33,9 % | +0,047 | −0,060 | −0,3 | −0,150 |
| B + Momentum 4h | 154 | 31,8 % | −0,032 | −0,124 | −1,1 | −0,194 |
| B + CVD | 130 | 36,9 % | +0,132 | +0,039 | 0,3 | −0,103 |
| B + Vol-Spike 1h | 164 | 37,2 % | +0,122 | +0,037 | 0,3 | −0,037 |
| F: alles (Gemini komplett) | 6 | 0 % | −0,831 | −0,915 | – | −1,088 |
| G: Trend + ≥2 von 4 | 144 | 35,4 % | +0,085 | −0,011 | −0,1 | +0,003 |

Einordnung:

1. **Die Kosten halbieren sich wie erwartet.** Der mittlere Stop liegt bei rund 1,9 % statt
   0,9 %, die Kosten sinken von ~0,19 R auf ~0,09 R pro Trade.
2. **Der Brutto-Edge wächst aber nicht mit.** Er bleibt bei 0 bis +0,13 R. Netto landen die
   besten Varianten (B, G, B + CVD, B + Vol-Spike) bei ungefähr 0 R, keine einzige ist
   statistisch von 0 verschieden (|t| ≤ 0,3).
3. **Ab 2024 ist fast alles negativ.** Die leicht positiven Gesamtwerte stammen aus der Zeit
   bis 2023 und halten Out-of-Sample nicht.
4. **Die volle Kombination (F) liefert 6 Trades in knapp 7 Jahren**, alle verloren. Bei so
   wenigen Trades ist das genauso wenig aussagekräftig wie die +0,41 R im 15m-Set (der
   t-Wert ist bei fast identischen Verlusten rechnerisch extrem und daher nicht interpretierbar).
5. **Konstant über beide Sets:** RSI/MACD als Filter verschlechtert das Ergebnis, ein TP am
   Level des hohen Timeframes ist schlechter als feste 2R, Trend + CVD und Trend + Vol-Spike
   sind brutto die besten Bausteine, aber zu schwach für einen handelbaren Edge.

Fazit über beide Sets: Der höhere Timeframe löst das Kostenproblem, legt aber offen, dass
die Einstiegslogik selbst kaum Vorhersagekraft hat. Weiteres Feintuning der Filter wäre
an dieser Stelle Kurvenanpassung.
