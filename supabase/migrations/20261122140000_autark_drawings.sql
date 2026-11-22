-- Alle Zeichnungen aus AutarkTrade nach Nexus (Toby 22.11.2026: "Nexus sollte
-- moeglichst alle meine Zeichnungen sehen/bekommen"). Abgestimmt mit der
-- AutarkTrade-Session: Quelle ist chart_zeichnungen (SQLite, nur lesend),
-- ohne pinsel/emoji und ohne versteckte Zeichnungen. Gesendet im SELBEN
-- 5-Min-Request wie die Zonen (autark-sync), kein zusaetzliches Log-Volumen.
-- Speicher: ~200 Zeichnungen x ~0,5 kB, wird nur bei Aenderung neu
-- geschrieben, waechst nicht (ersetzt statt angehaengt).
--
-- AVWAP: AutarkTrade speichert nur den Anker (points[0].t, ms UTC); den Wert
-- rechnet Nexus selbst aus candles (hlc3, Binance Perp), wie der Chart.

create table if not exists public.autark_drawings (
  autark_id integer primary key,
  symbol text not null default 'BTCUSDT',
  kind text not null,
  label text,
  points jsonb not null,
  style jsonb not null default '{}'::jsonb,
  visible_on jsonb,
  autark_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

alter table public.autark_drawings enable row level security;
create policy "Public read access" on public.autark_drawings for select using (true);
revoke all on public.autark_drawings from anon, authenticated;
grant select on public.autark_drawings to anon, authenticated;
grant select, insert, update, delete on public.autark_drawings to service_role;

alter table public.autark_sync_status
  add column if not exists drawing_count integer,
  add column if not exists drawings_changed_at timestamptz;

create or replace function public.replace_autark_drawings(p_drawings jsonb, p_allow_empty boolean)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  n integer;
  changed boolean;
begin
  if jsonb_typeof(p_drawings) <> 'array' then
    raise exception 'p_drawings muss eine Liste sein';
  end if;
  if jsonb_array_length(p_drawings) = 0 and not p_allow_empty then
    raise exception 'Leere Zeichnungsliste abgelehnt (ohne p_allow_empty)';
  end if;

  drop table if exists pg_temp.autark_neu;
  create temporary table autark_neu on commit drop as
  select (d->>'id')::integer as autark_id,
         coalesce(d->>'symbol', 'BTCUSDT') as symbol,
         d->>'kind' as kind,
         nullif(left(coalesce(d->>'label', ''), 120), '') as label,
         d->'points' as points,
         coalesce(d->'style', '{}'::jsonb) as style,
         case when jsonb_typeof(d->'visible_on') = 'array' then d->'visible_on' end as visible_on,
         case when (d->>'updated_at') ~ '^[0-9]+$' then to_timestamp((d->>'updated_at')::bigint / 1000.0) end as autark_updated_at
  from jsonb_array_elements(p_drawings) as d
  where (d->>'id') ~ '^[0-9]+$' and coalesce(d->>'kind', '') <> '' and jsonb_typeof(d->'points') = 'array';

  select count(*) into n from autark_neu;
  select exists (
    (select autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at from autark_neu
     except
     select autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at from public.autark_drawings)
    union all
    (select autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at from public.autark_drawings
     except
     select autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at from autark_neu)
  ) into changed;

  if changed then
    delete from public.autark_drawings where true;
    insert into public.autark_drawings (autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at)
    select autark_id, symbol, kind, label, points, style, visible_on, autark_updated_at from autark_neu;
  end if;

  update public.autark_sync_status
     set drawing_count = n,
         drawings_changed_at = case when changed then now() else drawings_changed_at end
   where id = 1;
  return n;
end;
$$;

revoke execute on function public.replace_autark_drawings(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.replace_autark_drawings(jsonb, boolean) to service_role;
