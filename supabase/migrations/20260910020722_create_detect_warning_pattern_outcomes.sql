-- Exportiert aus supabase_migrations.schema_migrations (20260910020722 create_detect_warning_pattern_outcomes)


-- Periodischer KI-Rueckblick Phase 1: Warn-Muster aus market_states.patterns
-- (compute-market-state, Edge Function). Erkennt NUR den ERSTEN Bar einer
-- zusammenhaengenden Aktiv-Phase eines Musters (LAG-Vergleich zur
-- vorherigen Zeile) -- compute-market-state laeuft alle 15 Min gegen
-- dieselbe 1H-Kerze, ein Muster bleibt daher typischerweise ueber mehrere
-- Zeilen aktiv; jede Zeile einzeln zu zaehlen wuerde denselben Fund massiv
-- ueberzaehlen (analog zu highSwept/bosUpFired in den Pine-Skripten).
--
-- direction_expected je Muster (bewusst NICHT die "Warnbedeutung" des
-- Namens, sondern die empirisch/methodisch begruendete Testrichtung):
--   - Fragile Bullish: 'bullish' -- testet, ob die STRUKTUR-suggerierte
--     Richtung haelt, exakt wie im bereits gelaufenen Backtest
--     (docs/research/DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md, 2.1).
--   - Distribution Warning: 'bearish' -- testet die WARNUNG selbst
--     (Preis faellt), exakt wie im selben Bericht, Abschnitt 2.3.
--   - Capitulation: 'bullish' -- klassische Kontrarian-Lesart (RSI
--     ueberverkauft + Kapitulations-Liquidationen = moeglicher Boden),
--     noch nicht empirisch getestet (siehe Bericht Abschnitt 1, bisher zu
--     wenig Historie) -- erste Live-Erfassung dafuer.
--   - Short Squeeze: 'bullish' -- Squeeze treibt den Preis definitionsgemaess
--     nach oben, ebenfalls noch nicht empirisch getestet.
create or replace function public.detect_warning_pattern_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with pattern_defs (pattern_name, direction_expected) as (
    values
      ('Fragile Bullish', 'bullish'),
      ('Distribution Warning', 'bearish'),
      ('Capitulation', 'bullish'),
      ('Short Squeeze', 'bullish')
  ),
  state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(
        (select jsonb_agg(elem->>'name') from jsonb_array_elements(ms.patterns) elem),
        '[]'::jsonb
      ) as pattern_name_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price
    from public.market_states ms
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, pd.pattern_name, pd.direction_expected,
      (sr.pattern_name_list ? pd.pattern_name) as active_now,
      lag(sr.pattern_name_list ? pd.pattern_name) over (partition by pd.pattern_name order by sr.id) as active_prev
    from state_rows sr
    cross join pattern_defs pd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'warning_pattern',
    f.pattern_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.detect_warning_pattern_outcomes is
  'Periodischer KI-Rueckblick Phase 1 (09.09.2026): backfillt/trackt die 4 Warn-Muster aus market_states.patterns (Fragile Bullish/Distribution Warning/Capitulation/Short Squeeze) in signal_outcomes, nur beim ERSTEN Bar einer zusammenhaengenden Aktiv-Phase (LAG-Transition, verhindert Ueberzaehlung durch den 15-Min-Cron gegen dieselbe 1H-Kerze). x Horizonte [4,12,24]h. Idempotent.';
