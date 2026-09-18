# Old Money Stack: Backtest

Backtest der von Toby beschriebenen "Old Money Stack"-Breakout-Strategie (Claudius Vertesi,
Support/Resistance-Ausbruch auf niedrigen Timeframes) auf BTC/USDT Perpetual (Binance Futures).
Eigene Nachbildung nach Nutzer-Bericht (18.09.2026), KEIN Original-Indikator.

## Warum CSV statt Live-ccxt-Fetch

Gleiche Sandbox-Einschraenkung wie im `lsob_backtest`-Projekt (siehe dessen README) -- ausgehende
Netzwerkverbindungen zu Boersen-APIs sind blockiert. `data_loader.py` unterstuetzt deshalb zwei
Quellen:

- **`csv`** (Standard, funktioniert hier): liest `data/BTCUSDT_<tf>.csv`.
- **`ccxt`** (fertig hinterlegt, aber in dieser Sandbox ungetestet): holt live von Binance Futures.

In diesem Fall wurden die CSVs aus Nexus Atlas' eigener Supabase-`candles`-Tabelle exportiert
(gleiche Technik wie beim LSOB-Backtest), nicht manuell von TradingView.

## Eigene Daten einspielen

```
data/BTCUSDT_1m.csv
data/BTCUSDT_5m.csv
data/BTCUSDT_15m.csv
```

15m kam auf Nutzer-Wunsch (18.09.2026) hinzu, nachdem sich zeigte, dass die Strategie auf 1m/5m
mit realistischen Fees strukturell nicht handelbar ist (siehe unten) — die 15m-CSV ist identisch
mit der bereits im `lsob_backtest`-Projekt vorhandenen (gleicher Zeitraum, gleiche Quelle).

Spaltennamen sind flexibel (siehe `_COLUMN_ALIASES` in `data_loader.py`), erwartet werden
sinngemaess: eine Zeitspalte (Unix-Timestamp in s/ms ODER ISO-Datum) plus `open`, `high`, `low`,
`close` (Volume optional).

## Ausführen

```bash
cd research-python/oms_backtest
pip install -r requirements.txt
python run_backtest.py            # liest aus data/*.csv
python run_backtest.py --source ccxt   # nur mit echtem Netzwerkzugriff
```

Ergebnisse landen in `output/`:
- `backtest_report.md` — Kennzahlen-Tabellen + kritische Einordnung
- `equity_curves.png` — Equity-Kurven je Timeframe (Long/Short überlagert)
- `trades_1m.csv`, `trades_5m.csv`, `trades_15m.csv` — Trade-Rohdaten

## Tests

```bash
cd research-python/oms_backtest
pytest
```

## Was 1:1 aus dem Strategie-Bericht portiert wurde

- **SR-Linien aus Pivot-CLOSES** (nicht High/Low wie bei LSOB): `ta.pivothigh(close, 2, 2)` /
  `ta.pivotlow(close, 2, 2)`, inkl. der inhärenten Bestätigungsverzögerung von 2 Bars
  (`pivots.py`).
- **SR-Linien-Persistenz**: nur die jeweils zuletzt bestätigte Resistance/Support gleichzeitig
  aktiv (Nutzer-Entscheidung, `AskUserQuestion` 18.09.2026, wie LSOB's lastPH/lastPL) — eine neue
  ersetzt die alte.
- **Ausbruchskerzen-Validierung**: Body-Anteil jenseits der Linie > 50%, entgegengelegener
  Docht-Anteil ≤ 30%, Kerzengröße ≤ 2.5× SMA(20) der Bar-Range (`oms_engine.py`).
- **Entry** zum Close der Ausbruchskerze, **SL** am entgegengelegenen Docht derselben Kerze.
- **TP bei CRV 1:2**, **Break-Even-Nachziehen** bei 30% des Wegs von Entry zu TP: sobald erreicht,
  wird der SL auf den Entry-Preis nachgezogen (`backtest.py` `_resolve_exit_with_be`).

## Was NICHT (extra) implementiert wurde -- und warum

- **Abstands-Check "genug Platz bis zur nächsten SR-Linie für CRV 1:2"**: unter der gewählten
  SR-Linien-Persistenz-Regel (nur die jeweils letzte Resistance/Support aktiv) existiert praktisch
  NIE eine weitere Linie in Zielrichtung — die einzige andere verfolgte Linie liegt immer HINTER
  dem Kurs, nicht davor. Das Filter wäre unter dieser Wahl technisch immer erfüllt und TP damit
  ohnehin immer der feste 1:2-Wert; bewusst nicht extra kodiert, siehe `oms_engine.py`-Docstring
  und `backtest_report.md` für die ausführliche Begründung.
- **Fee/Positionsgrößen-Logik**: wie bei LSOB ist der Strategie-Bericht kein fertiges
  `strategy()`-Script mit Equity-Verwaltung — Fees (0.06%/Seite) und Risiko (1% Equity/Trade) sind
  eigene, dokumentierte Backtest-Annahmen (`config.py`).

## Methodische Annahmen (eigene, nicht aus dem Nutzer-Bericht)

- Bei SL/Break-Even-Stop- und TP-Treffer in derselben Kerze: konservativ der (aktuelle) Stop
  angenommen.
- Das Nachziehen des Stops auf Break-Even wirkt frühestens AB DER NÄCHSTEN Bar, nicht innerhalb
  derselben Bar, die den 30%-Trigger erreicht — vermeidet eine neue Intrabar-Ordnungs-Ambiguität
  (siehe `backtest.py`).
- Jeder Timeframe/Richtung-Bucket wird mit einem eigenen, unabhängigen Start-Equity simuliert (kein
  gemeinsamer Kapitalpool) — auf 1m/5m können sich Signale zeitlich deutlich stärker überlappen
  als auf 15m/1h/4h, siehe `backtest_report.md` "Kritische Einordnung".
- **Hebel-Deckel (`max_leverage`, Default 10x)**: Auf 1m/5m kann der Docht der Ausbruchskerze
  (= SL-Abstand) extrem klein werden — eine reine Ziel-Risiko-Positionsgrößen-Regel würde dann eine
  absurd große Notional verlangen und allein durch Fees das Equity vernichten (ohne diesen Deckel
  war das Ergebnis eines ersten Testlaufs exakt -100% Total Return in jedem Bucket). Mit dem Deckel
  riskieren solche Trades bewusst weniger als das Ziel-Risiko — siehe `backtest_report.md`.

## Ergebnis (Kurzfassung)

Auf **allen drei getesteten Timeframes (1m/5m/15m) ist die Strategie unter dieser exakten SL-Regel
(Docht der eigenen Ausbruchskerze) mit einer realistischen Taker-Fee von 0.06%/Seite und fixem
Prozent-Risiko-Sizing NICHT profitabel handelbar** — auch nicht auf 15m, wo der Hebel-Deckel nur
noch ~10% der Trades betrifft. Grund: der typische SL-Abstand dieser Strategie ist auf allen drei
Timeframes klein (Median 0.13%–0.28% des Preises), sodass die Fee (0.12% Round-Trip) einen großen
Teil des eingesetzten Ziel-Risikos aufzehrt — SELBST bei nicht Hebel-gedeckelten Trades. Die reine
Rohsignal-Qualität (R-Multiple ohne Fees) ist ohnehin nur schwach positiv bis leicht negativ. Volle
Herleitung mit Zahlen in `backtest_report.md`, Abschnitt "Kritische Einordnung".

Siehe `backtest_report.md` (Abschnitt "Kritische Einordnung") für die vollständige Diskussion,
inklusive Overfitting-Risiko und Backtest-≠-Live-Hinweis.
