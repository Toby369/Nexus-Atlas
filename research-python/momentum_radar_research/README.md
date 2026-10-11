# momentum_radar_research

Backtest von Mo's Momentum Radar (Phase 2 aus
`docs/research/MOMENTUM-RADAR-PLAN_2026-10-11.md`). Ergebnis:
`docs/research/MOMENTUM-RADAR-BACKTEST_2026-10-11.md`.

- `radar.py`: Nachbau der Signal-Logik (Welle, Punkte, große Punkte, Geldfluss-Vorzeichen,
  4h-Trendfilter), Konstanten 1:1 aus dem Pine-Skript.
- `backtest.py`: Triple-Barrier (TP +1,5 % / SL -0,5 % / 48 h, Pfad auf 15m), Splits, Statistik.
- `run_backtest.py`: führt alle pre-registrierten Zellen aus und schreibt `output/` (gitignored).

## Daten erzeugen

Die Sandbox erreicht Binance und den Supabase-Host nicht direkt. Der Export läuft deshalb über
den Supabase-MCP-Kanal, je Intervall eine Abfrage (für 15m in zwei Zeitblöcken, sonst ist die
Antwort zu groß):

```sql
select string_agg((extract(epoch from open_time)::bigint)::text||','||open||','||high||','||low||','||close||','||volume, ';' order by open_time)
from candles where interval = '15m' and symbol = 'BTCUSDT';
```

Das Ergebnis wird als `btc_<tf>.csv` mit Kopfzeile `ts,open,high,low,close,volume` gespeichert
(`ts` = open_time in Unix-Sekunden). Benötigt werden `15m`, `1h`, `4h` und `1d`.

## Ausführen

```bash
python run_backtest.py <datenverzeichnis>
python -m pytest -q
```
