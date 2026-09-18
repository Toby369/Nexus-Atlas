# LSOB-Rekonstruktion: Backtest

Backtest von `LSOB_Rekonstruktion.pine` (eigene Nachbildung der Liquidity-Sweep-Order-Block-Logik,
KEIN Original-Indikator von Claudius Vertesi) auf BTC/USDT Perpetual (Binance Futures).

## Warum CSV statt Live-ccxt-Fetch

Diese Sandbox erlaubt ausgehende Netzwerkverbindungen nur zu einer kleinen Allowlist
(npm/PyPI-Registry, Anthropic-APIs) — geprüft gegen `fapi.binance.com`, `api.binance.com`,
`data.binance.vision`, sogar `api.coingecko.com` und `example.com`: alle mit expliziter
Policy-Ablehnung. `data_loader.py` unterstützt deshalb zwei Quellen:

- **`csv`** (Standard, funktioniert hier): liest `data/BTCUSDT_<tf>.csv`.
- **`ccxt`** (fertig hinterlegt, aber in dieser Sandbox ungetestet): holt live von Binance Futures,
  falls das Skript auf einer Maschine mit echtem Netzwerkzugriff läuft (`--source ccxt`).

## Eigene Daten einspielen

Lege drei CSV-Dateien in `data/` ab:

```
data/BTCUSDT_15m.csv
data/BTCUSDT_1h.csv
data/BTCUSDT_4h.csv
```

Spaltennamen sind flexibel (Groß-/Kleinschreibung, gängige Aliase wie `Open`/`open`/`o`), erwartet
werden sinngemäß: eine Zeitspalte (Unix-Timestamp in s/ms ODER ISO-Datum) plus `open`, `high`,
`low`, `close` (Volume optional, wird nicht für die LSOB-Logik benötigt). Ein TradingView-CSV-Export
oder ein manueller Binance-Download passt direkt.

Mindestens 12 Monate Historie je Timeframe, wie vorgegeben.

## Ausführen

```bash
cd research-python/lsob_backtest
pip install -r requirements.txt
python run_backtest.py            # liest aus data/*.csv
python run_backtest.py --source ccxt   # nur mit echtem Netzwerkzugriff
```

Ergebnisse landen in `output/`:
- `backtest_report.md` — Kennzahlen-Tabellen + kritische Einordnung
- `equity_curves.png` — Equity-Kurven je Timeframe (Long/Short überlagert)
- `trades_15m.csv`, `trades_1h.csv`, `trades_4h.csv` — Trade-Rohdaten

## Tests

```bash
cd research-python/lsob_backtest
pytest
```

## Was 1:1 portiert wurde

- Pivot-High/Low-Erkennung (`ta.pivothigh`/`ta.pivotlow`), inkl. der inhärenten
  Bestätigungsverzögerung von `pivotLen` Bars (siehe `pivots.py`).
- Liquidity-Sweep-Erkennung (Wick durchbricht letztes Pivot, Close bleibt innerhalb).
- Order-Block-Erzeugung, -Invalidierung (Close/Wick-Toleranz + Max-Wick-Penetration) und
  -Ablauf (Max History Bars).
- Retest + Rejection + Confirmation → Entry-Signal.

Alle Default-Parameter (Pivot Length 15, Box Invalidation Tolerance 20%, Re-Test Tolerance 10%,
Strict Wick Invalidation false, Max Wick Penetration 50%, Max History Bars 2000) sind unverändert
aus der Pine-Datei übernommen (`config.py`).

## Was NICHT portiert wurde (und warum)

- **Pre-Warn Line**: rein visuell/Alert, kein Einfluss auf `sigEntry` — für einen Backtest der
  Entry-Signale ohne Bedeutung.
- **Fair Value Gaps**: eigenständiger visueller Layer im Pine-Skript, wird an keiner Stelle mit der
  LSOB-Retest-/Confirmation-Logik verknüpft.
- **LSOB MTF (Multi-Timeframe-Zonen)**: ebenfalls rein visuell (`request.security`-Zonen), keine
  Verknüpfung zum Entry-Signal.
- **Moving Averages / Candle-Pattern-Shapes**: reine Chart-Overlays ohne Signalwirkung.

## Wichtige Erkenntnis beim Portieren

Die Prosa-Beschreibung "Retest der Box → Rejection-Kerze → Confirmation-Kerze" liest sich wie ein
Drei-Kerzen-Ablauf. Im tatsächlichen Pine-Code werden `retested`, `rejection` und `confirmCandle`
aber alle aus den OHLC-Werten **derselben Kerze** berechnet (kein Bar-Offset, kein
Mehr-Kerzen-Zustand) — eine einzelne Kerze, die gleichzeitig in die Box zurückläuft, dort abweist
UND in Trendrichtung schließt, ist die Confirmation-Kerze. `lsob_engine.py` bildet das exakt so nach.

## Methodische Annahmen (nicht aus der Pine-Datei)

Das Pine-Skript ist ein `indicator()`, kein `strategy()` — es enthält keine Positionsgrößen-,
Fee- oder Equity-Logik. Diese Annahmen sind eigene, dokumentierte Festlegungen für den Backtest
(Details siehe `config.py` und `backtest.py`):

- Entry zum Close der Confirmation-Kerze.
- SL exakt am Rejection-Wick der Confirmation-Kerze (kein zusätzlicher Puffer, `sl_buffer_pc=0`).
- TP bei CRV 1:2.
- Fee 0.06% pro Seite (unterer Rand des vorgegebenen Bereichs 0.06–0.1%).
- Risiko 1% des Equity pro Trade, jeder Timeframe/Richtung-Bucket mit eigenem, unabhängigem
  Start-Equity simuliert (kein gemeinsamer Kapitalpool).
- Bei SL- und TP-Treffer in derselben Kerze: konservativ SL angenommen.

Siehe `backtest_report.md` (Abschnitt "Kritische Einordnung") für die vollständige Diskussion,
inklusive Overfitting-Risiko und Backtest-≠-Live-Hinweis.
