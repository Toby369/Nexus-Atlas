-- Exportiert aus supabase_migrations.schema_migrations (20260825145935 add_oi_change_by_exchange_rpc)

-- Pro-Boerse-OI-Change% fuer den gewaehlten Zeitraum, in einer einzigen
-- Query statt N Einzelabfragen. Liefert nur Boersen, die ueberhaupt jemals
-- Open Interest gemeldet haben (Bitunix faellt damit automatisch raus --
-- die Boerse hat keine oeffentliche OI-Route, siehe collect-btc). Das
-- Frontend zeigt fuer bekannte OI-lose Boersen explizit "UNAVAILABLE" statt
-- sie stillschweigend wegzulassen. "aggregated" taucht hier nie auf, da es
-- kein echter exchange-Wert in market_snapshots ist.
--
-- Referenzpunkt: naechster Wert VOR p_since, faellt (wie
-- get_market_reference_snapshot) auf den aeltesten verfuegbaren Punkt
-- zurueck statt zu approximieren, falls die Historie noch nicht so weit
-- zurueckreicht -- has_full_history zeigt das transparent an.
create or replace function public.get_oi_change_by_exchange(p_since timestamptz)
returns table (
  exchange text,
  oi_change_pct numeric,
  current_oi numeric,
  reference_oi numeric,
  reference_timestamp_utc timestamptz,
  current_timestamp_utc timestamptz,
  has_full_history boolean
)
language sql stable
as $$
  with exchanges as (
    select distinct m.exchange
    from market_snapshots m
    where m.status = 'ok' and m.open_interest is not null
  ),
  latest as (
    select e.exchange, l.open_interest as current_oi, l.timestamp_utc as current_ts
    from exchanges e
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
      order by m.timestamp_utc desc
      limit 1
    ) l on true
  ),
  reference as (
    select e.exchange,
      coalesce(r.open_interest, rf.open_interest) as reference_oi,
      coalesce(r.timestamp_utc, rf.timestamp_utc) as reference_ts
    from exchanges e
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
        and m.timestamp_utc <= p_since
      order by m.timestamp_utc desc
      limit 1
    ) r on true
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
      order by m.timestamp_utc asc
      limit 1
    ) rf on true
  )
  select
    latest.exchange,
    case
      when reference.reference_oi is not null and reference.reference_oi <> 0
        then ((latest.current_oi - reference.reference_oi) / reference.reference_oi) * 100
      else null
    end as oi_change_pct,
    latest.current_oi,
    reference.reference_oi,
    reference.reference_ts,
    latest.current_ts,
    (reference.reference_ts is not null and reference.reference_ts <= p_since + interval '15 minutes') as has_full_history
  from latest
  left join reference using (exchange)
  order by latest.exchange;
$$;

grant execute on function public.get_oi_change_by_exchange(timestamptz) to anon, authenticated;
