-- Exportiert aus supabase_migrations.schema_migrations (20260910020632 create_tv_signal_direction_and_detect)


-- Bewusste Duplizierung von lib/tradingViewSignal.ts::inferSignalDirection in
-- SQL -- gleiches Prinzip wie lib/webhookTradingView.ts vs. der Edge
-- Function (siehe Datei-Kommentar dort): beide Seiten unabhaengig
-- implementiert, hier per pgTAP-Golden-Test gegen dieselben Faelle wie
-- lib/tradingViewSignal.test.ts abgeglichen. Aendert sich eine Seite,
-- muss die andere manuell nachgezogen werden.
create or replace function public.tv_infer_signal_direction(p_signal_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(p_signal_type) like '%BULLISH%' or upper(p_signal_type) like '%\_BULL' escape '\' then 'bullish'
    when upper(p_signal_type) like '%BEARISH%' or upper(p_signal_type) like '%\_BEAR' escape '\' then 'bearish'
    when upper(p_signal_type) like '%\_LOW' escape '\' or upper(p_signal_type) like '%\_LO' escape '\' then 'bullish'
    when upper(p_signal_type) like '%\_HIGH' escape '\' or upper(p_signal_type) like '%\_HI' escape '\' then 'bearish'
    else null
  end
$$;

comment on function public.tv_infer_signal_direction is
  'SQL-Replik von lib/tradingViewSignal.ts::inferSignalDirection -- siehe dortigen Kommentar fuer die Begruendung der Umkehr-Logik bei _LOW/_LO/_HIGH/_HI. Nur fuer signal_outcomes-Detection, nicht fuer die Live-Anzeige (die laeuft weiterhin ueber TypeScript).';

-- Periodischer KI-Rueckblick Phase 1: TradingView-Alerts. Feste, vorregis-
-- trierte Horizonte (4/12/24h) -- dieselben wie beim bereits validierten
-- Warn-Muster-Backtest vom 05.09.2026 (DIVERGENCE-PATTERN-BACKTEST), damit
-- alle Live-Signal-Gruppen dieses Systems auf derselben Uhrzeit-Skala
-- vergleichbar bleiben (statt kerzenbasierter Horizonte wie bei den
-- Forschungs-Backtests -- TradingView-Alerts feuern zu beliebigen
-- Zeitpunkten, nicht synchron zu Kerzen-Schluessen).
--
-- Idempotent per ON CONFLICT (source_table, source_id, horizon_hours):
-- derselbe Aufruf dient sowohl dem initialen Backfill als auch der
-- laufenden Erkennung neuer Alerts (kein separater "erstmaliger Backfill"-
-- Code noetig).
create or replace function public.detect_tradingview_signal_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'tradingview_alert',
    tv.signal_type,
    public.tv_infer_signal_direction(tv.signal_type),
    tv.received_at,
    (tv.payload->>'price')::numeric,
    h.horizon_hours,
    'tradingview_signals',
    tv.id::text
  from public.tradingview_signals tv
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  where public.tv_infer_signal_direction(tv.signal_type) is not null
    and tv.payload->>'price' is not null
  on conflict (source_table, source_id, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.detect_tradingview_signal_outcomes is
  'Periodischer KI-Rueckblick Phase 1 (09.09.2026): backfillt/trackt TradingView-Webhook-Alerts (tradingview_signals) in signal_outcomes, x Horizonte [4,12,24]h. Idempotent, per Cron alle 15 Min aufgerufen (dieselbe Funktion deckt Backfill UND laufende Erkennung ab). Signale mit unbekanntem signal_type (tv_infer_signal_direction = NULL) werden bewusst uebersprungen -- keine geratene Richtung.';
