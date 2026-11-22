-- Marktphase 4H/1D/1W vorberechnen (Toby 21.11.2026: Dashboard-Knopf
-- "funktioniert nicht" -- die Seite rechnete compute_market_state_matrix_latest
-- bei jedem Aufruf live, 4h allein 6,4 s bei 8 s Zeitlimit).
-- Eigene Mini-Tabelle statt Zeilen in market_state_matrix: mehrere Leser
-- (Dashboard, Kopfzeile, Briefing, SQL-Funktionen) lesen dort ohne
-- Intervall-Filter und erwarten nur 1h. Hier: genau EINE Zeile je Intervall,
-- ueberschrieben -- Wachstum 0, Groesse < 10 kB.

create table if not exists public.market_state_latest (
  interval text primary key,
  data jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.market_state_latest enable row level security;
create policy "Public read access" on public.market_state_latest for select using (true);
revoke all on public.market_state_latest from anon, authenticated;
grant select on public.market_state_latest to anon, authenticated;
grant select, insert, update, delete on public.market_state_latest to service_role;

create or replace function public.refresh_market_state_latest()
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_interval text;
  v_count integer := 0;
  v_row jsonb;
begin
  foreach v_interval in array array['4h', '1d', '1w'] loop
    select to_jsonb(r) into v_row
    from public.compute_market_state_matrix_latest('BTCUSDT', v_interval, 'binance') r
    limit 1;
    if v_row is not null then
      insert into public.market_state_latest (interval, data, computed_at)
      values (v_interval, v_row, now())
      on conflict (interval) do update set data = excluded.data, computed_at = excluded.computed_at;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.refresh_market_state_latest() from public, anon, authenticated;
grant execute on function public.refresh_market_state_latest() to service_role;

-- Alle 15 Min, versetzt zu den Jobs auf :00/:15/:30/:45 (dort laeuft u. a.
-- refresh-market-state-matrix mit ~23 s). Laeuft in der Datenbank, keine
-- REST-Anfragen, kein zusaetzliches Log-Volumen in edge_logs.
select cron.schedule(
  'refresh-market-state-latest-every-15-min',
  '7,22,37,52 * * * *',
  $$select public.refresh_market_state_latest();$$
);

select public.refresh_market_state_latest();
