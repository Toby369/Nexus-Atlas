# Snapshot-Verdichtung (Speicher unter 500 MB) — 18.10.2026

**Entscheid Toby (18.10.2026):** Variante 1 „Ausdünnen“, Grenze 30 Tage. Umgesetzt mit
**35 Tagen**, siehe unten. **Noch nicht ausgeführt** – erst nach Freigabe des SQL.

## Ausgangslage

- DB 413 MB von 500 MB (17.10.2026), Zuwachs geschätzt ~2 MB/Tag, fast alles aus den
  5-Minuten-Sammlern. Ohne Regel ist die Grenze in ~6 Wochen erreicht.

## Regel

Daten älter als 35 Tage werden auf **einen Wert pro Stunde** verdichtet:

| Tabelle | Wie | Schlüssel |
|---|---|---|
| market_snapshots | letzter Wert der Stunde bleibt | Börse, Symbol |
| positioning_snapshots | letzter Wert der Stunde bleibt | Börse, Symbol |
| positioning_signals | letzter Wert der Stunde bleibt | Typ, Symbol, Zeitrahmen |
| orderbook_snapshots | letzter Wert der Stunde bleibt | Börse, Symbol |
| macro_snapshots | letzter Wert der Stunde bleibt | Symbol |
| spot_market_snapshots | **Stunden-Kerze**: Volumen summiert, Open = erster, Close = letzter Wert, `interval_minutes = 60` | Börse, Symbol |

**Warum 35 statt 30 Tage:** Der Zeitraum „1M“ im Dashboard sind genau 30 Tage, und
`get_market_reference_snapshot` sucht den Wert direkt vor dem Fensterbeginn (Toleranz
15 Minuten). Bei exakt 30 Tagen würde „1M“ ab und zu „kein voller Zeitraum“ melden.

**Warum die Ergebnisse gleich bleiben:**
- `compute_market_state_matrix_series` (Marktphase, ganze Historie) nimmt aus
  `market_snapshots` den letzten Wert je Stunde und summiert `spot_market_snapshots` je
  Stunde. Genau das bleibt erhalten.
- Alle anderen Lese-Stellen (Dashboard, Briefing, Divergenz-Radar, Funding-/OI-Funktionen,
  Datenqualität) lesen höchstens 30 Tage zurück.
- Die wöchentlichen Forschungs-Pipelines bewerten nur neue Ereignisse (`not exists` bzw.
  `on conflict do nothing`); bestehende Auswertungen werden nicht neu gerechnet.

## Wirkung (Zahlen vom 18.10.2026, Zeilen vor dem 13.09.)

| Tabelle | Zeilen vorher | bleiben |
|---|---|---|
| market_snapshots | 36'277 | 5'023 |
| positioning_snapshots | 21'863 | 1'839 |
| positioning_signals | 5'659 | 477 |
| orderbook_snapshots | 15'081 | 1'272 |
| macro_snapshots | 15'801 | 11'157 |
| spot_market_snapshots | 5'292 | 444 |

Geschätzt sofort ~20–25 MB frei (nach `vacuum full`). Danach halten die Tabellen
dauerhaft nur 35 Tage in voller Auflösung; der Zuwachs sinkt auf grob 0,5–0,7 MB/Tag
(vor allem `candles` und `market_features`). Das reicht für etwa ein halbes Jahr; die
nächsten Kandidaten wären dann die Forschungstabellen (`research_*_signal_activation`,
~115 MB).

## Export (erledigt)

Alle betroffenen Zeilen vor dem 13.09.2026 in voller Auflösung:
`research-python/data/archive/retention_2026-10-18/*.parquet` (5,4 MB). Zeilenzahlen gegen
die DB geprüft, identisch.

## SQL

### Block 1 — Funktion

```sql
create or replace function public.downsample_old_snapshots(p_older_than interval default interval '35 days')
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz := date_trunc('hour', now() - p_older_than);
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  -- Letzter Wert je Stunde bleibt, Rest weg
  delete from market_snapshots m
  where m.timestamp_utc < v_cutoff
    and m.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from market_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('market_snapshots', v_n);

  delete from positioning_snapshots p
  where p.timestamp_utc < v_cutoff
    and p.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from positioning_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_snapshots', v_n);

  delete from positioning_signals s
  where s.timestamp_utc < v_cutoff
    and s.id not in (
      select distinct on (signal_type, symbol, timeframe, date_trunc('hour', timestamp_utc)) id
      from positioning_signals where timestamp_utc < v_cutoff
      order by signal_type, symbol, timeframe, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_signals', v_n);

  delete from orderbook_snapshots o
  where o.timestamp_utc < v_cutoff
    and o.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from orderbook_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('orderbook_snapshots', v_n);

  delete from macro_snapshots m
  where m.timestamp_utc < v_cutoff
    and m.id not in (
      select distinct on (symbol, date_trunc('hour', timestamp_utc)) id
      from macro_snapshots where timestamp_utc < v_cutoff
      order by symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('macro_snapshots', v_n);

  -- Spot: 5-Min-Kerzen zu Stunden-Kerzen zusammenfassen (Summen bleiben exakt)
  create temp table _spot_hourly on commit drop as
  select exchange, symbol, date_trunc('hour', timestamp_utc) as hour_utc,
         (array_agg(open_price order by timestamp_utc))[1] as open_price,
         (array_agg(last_price order by timestamp_utc desc))[1] as last_price,
         sum(base_volume) as base_volume, sum(quote_volume) as quote_volume,
         sum(taker_buy_vol) as taker_buy_vol, sum(taker_sell_vol) as taker_sell_vol,
         sum(taker_buy_quote_vol) as taker_buy_quote_vol, sum(taker_sell_quote_vol) as taker_sell_quote_vol,
         sum(trade_count)::integer as trade_count
  from spot_market_snapshots
  where timestamp_utc < v_cutoff and status = 'ok' and coalesce(interval_minutes, 5) < 60
  group by 1, 2, 3;

  delete from spot_market_snapshots s
  where s.timestamp_utc < v_cutoff and coalesce(s.interval_minutes, 5) < 60;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('spot_market_snapshots_deleted', v_n);

  insert into spot_market_snapshots (
    timestamp_utc, symbol, exchange, last_price, status, error, interval_minutes, open_price,
    base_volume, quote_volume, taker_buy_vol, taker_sell_vol, taker_buy_quote_vol,
    taker_sell_quote_vol, taker_buy_sell_ratio, trade_count)
  select hour_utc, symbol, exchange, last_price, 'ok', null, 60, open_price,
         base_volume, quote_volume, taker_buy_vol, taker_sell_vol, taker_buy_quote_vol,
         taker_sell_quote_vol,
         case when taker_sell_vol > 0 then taker_buy_vol / taker_sell_vol end, trade_count
  from _spot_hourly
  on conflict (exchange, symbol, timestamp_utc) do nothing;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('spot_market_snapshots_hourly', v_n);

  return v_result || jsonb_build_object('cutoff', v_cutoff);
end;
$function$;
```

### Block 2 — täglicher Job

```sql
select cron.schedule('downsample-old-snapshots-daily', '41 3 * * *',
  $$select public.downsample_old_snapshots();$$);
```

### Block 3 — einmal jetzt ausführen

```sql
select public.downsample_old_snapshots();
```

### Block 4 — Platz zurückgeben (je einzeln, sperrt die Tabelle kurz)

```sql
vacuum full public.market_snapshots;
vacuum full public.positioning_snapshots;
vacuum full public.positioning_signals;
vacuum full public.orderbook_snapshots;
vacuum full public.macro_snapshots;
vacuum full public.spot_market_snapshots;
select pg_size_pretty(pg_database_size(current_database()));
```
