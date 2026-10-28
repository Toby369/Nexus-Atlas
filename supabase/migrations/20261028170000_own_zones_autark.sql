-- Eigene Zonen aus AutarkTrade (Toby 28.10.2026: "Journal-Zonen sollen eigene
-- Zonen ersetzen", docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).
-- Rein additiv: price bleibt (Mitte der Zone), damit Zonen-Kachel, Plan-Satz,
-- Regelcheck und Push unveraendert weiterrechnen. Neu sind Bereich, Name,
-- Quelle und die Id der Zeichnung in AutarkTrade.
alter table public.own_zones
  add column if not exists price_low numeric,
  add column if not exists price_high numeric,
  add column if not exists label text,
  add column if not exists source text not null default 'manual',
  add column if not exists autark_id integer;

-- Ersetzt alle eigenen Zonen in einem Schritt durch die aus AutarkTrade
-- (atomar, damit Nexus nie kurz ohne Zonen dasteht). Aufruf nur mit
-- Service-Role aus der Edge Function autark-sync.
-- p_zones: [{"id": 12, "lo": 81000, "hi": 81300, "label": "Range-Oberkante"}, ...]
create or replace function public.replace_own_zones_from_autark(p_zones jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.own_zones where true;
  insert into public.own_zones (price, price_low, price_high, label, source, autark_id)
  select ((z->>'lo')::numeric + (z->>'hi')::numeric) / 2,
         (z->>'lo')::numeric,
         (z->>'hi')::numeric,
         nullif(left(coalesce(z->>'label', ''), 120), ''),
         'autark',
         nullif(z->>'id', '')::integer
  from jsonb_array_elements(p_zones) as z
  where (z->>'lo')::numeric > 0 and (z->>'hi')::numeric >= (z->>'lo')::numeric;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.replace_own_zones_from_autark(jsonb) from public, anon, authenticated;
grant execute on function public.replace_own_zones_from_autark(jsonb) to service_role;
