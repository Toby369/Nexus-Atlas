-- Zonen-Sync aus AutarkTrade, Nachbesserung nach Abstimmung mit der
-- Aufraeum-Session (28.10.2026):
-- 1. autark_sync_status: Zeitpunkt des letzten Syncs (auch ohne Aenderung)
--    und der letzten Aenderung, damit die Zonen-Kachel einen ausgefallenen
--    Sync erkennt.
-- 2. Eine leere Liste ersetzt die Zonen nur mit ausdruecklichem Flag.
-- 3. Unveraenderte Zonen werden nicht neu geschrieben (created_at bleibt).

create table public.autark_sync_status (
  id integer primary key default 1 check (id = 1),
  last_sync_at timestamptz,
  last_change_at timestamptz,
  zone_count integer not null default 0
);
insert into public.autark_sync_status (id) values (1);

alter table public.autark_sync_status enable row level security;
create policy "Public read access" on public.autark_sync_status for select using (true);
grant select on public.autark_sync_status to anon, authenticated;
grant select, insert, update, delete on public.autark_sync_status to service_role;
revoke insert, update, delete, truncate, references, trigger on public.autark_sync_status from anon, authenticated;

-- Neue Fassung mit zwei Parametern. p_allow_empty ohne Standardwert, damit
-- ein Aufruf nur mit p_zones eindeutig die alte Fassung (jsonb) trifft.
-- Die alte Fassung bleibt ungenutzt stehen (nur service_role), weil das
-- Loeschen per MCP eine Bestaetigung braucht, die bei Toby nicht ankommt.
create or replace function public.replace_own_zones_from_autark(p_zones jsonb, p_allow_empty boolean)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
  changed boolean;
begin
  if jsonb_typeof(p_zones) <> 'array' then
    raise exception 'p_zones muss eine Liste sein';
  end if;
  if jsonb_array_length(p_zones) = 0 and not p_allow_empty then
    raise exception 'Leere Zonenliste abgelehnt (ohne p_allow_empty)';
  end if;

  with neu as (
    select (z->>'lo')::numeric as price_low,
           (z->>'hi')::numeric as price_high,
           nullif(left(coalesce(z->>'label', ''), 120), '') as label,
           nullif(z->>'id', '')::integer as autark_id
    from jsonb_array_elements(p_zones) as z
    where (z->>'lo')::numeric > 0 and (z->>'hi')::numeric >= (z->>'lo')::numeric
  )
  select (select count(*) from neu),
         exists (
           (select price_low, price_high, label, autark_id from neu
            except
            select price_low, price_high, label, autark_id from public.own_zones where source = 'autark')
           union all
           (select price_low, price_high, label, autark_id from public.own_zones
            except
            select price_low, price_high, label, autark_id from neu)
         )
    into n, changed;

  if changed then
    delete from public.own_zones where true;
    insert into public.own_zones (price, price_low, price_high, label, source, autark_id)
    select (lo + hi) / 2, lo, hi, nullif(left(coalesce(z->>'label', ''), 120), ''), 'autark', nullif(z->>'id', '')::integer
    from jsonb_array_elements(p_zones) as z,
         lateral (select (z->>'lo')::numeric as lo, (z->>'hi')::numeric as hi) as v
    where lo > 0 and hi >= lo;
  end if;

  update public.autark_sync_status
     set last_sync_at = now(),
         last_change_at = case when changed then now() else last_change_at end,
         zone_count = n
   where id = 1;
  return n;
end;
$$;

revoke all on function public.replace_own_zones_from_autark(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.replace_own_zones_from_autark(jsonb, boolean) to service_role;
