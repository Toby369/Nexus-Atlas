-- Trade-Journal aus AutarkTrade nach Nexus (Toby 26.11.2026). Abgestimmt mit
-- der AutarkTrade-Session: Quelle ist die TradeNote-Datenbank (SQLite, nur
-- lesend): trades (eine Zeile pro Tag, Trades als JSON), notes, tags,
-- satisfactions, excursions, incoming_positions (offene Positionen).
-- Gesendet im SELBEN 5-Min-Request wie Zonen und Zeichnungen (autark-sync),
-- nur geaenderte Trades der letzten 7 Tage plus offene; einmal taeglich alle
-- Trades und die vollstaendige ID-Liste.
--
-- PRIVAT: PnL, Notizen, Gefuehle und Stress. RLS an, KEINE Policy, kein Recht
-- fuer anon/authenticated. Lesen nur serverseitig (Service-Role).
--
-- Entscheide Toby 26.11.: Gefuehle und Stress mitnehmen, Grid-Bots weglassen,
-- in AutarkTrade geloeschte Trades nur MARKIEREN (deleted_in_autark_at),
-- Nexus loescht nie selbst ("nichts wird geloescht, ausser ich gebe ok").
--
-- Speicher: ~2 kB pro Trade mit Notizen, bei ~1000 Trades pro Jahr ~2 MB/Jahr.
-- Deshalb keine automatische Aufbewahrungsfrist (waere ein Loeschen ohne OK);
-- die 400-MB-Warnung deckt es ab. Unveraenderte Trades werden nicht neu
-- geschrieben. Log-Volumen: keine zusaetzliche Anfrage (gleicher Request).

create table if not exists public.autark_trades (
  trade_id text primary key,
  position_id text,
  status text not null check (status in ('open', 'closed')),
  broker text,
  symbol text,
  side text check (side in ('long', 'short')),
  entry_price numeric,
  exit_price numeric,
  entry_time timestamptz,
  exit_time timestamptz,
  quantity numeric,
  leverage numeric,
  gross_pnl numeric,
  net_pnl numeric,
  trading_fee numeric,
  funding_fee numeric,
  stop_loss numeric,
  mae_price numeric,
  mfe_price numeric,
  strategy_followed boolean,
  satisfaction boolean,
  tags text[] not null default '{}',
  closing_tags text[] not null default '{}',
  -- Notizen, Playbook (als Text), Zeiteinheit, Typ, Gefuehle, Stress, TP/SL-Verlauf
  journal jsonb not null default '{}'::jsonb,
  autark_updated_at timestamptz,
  deleted_in_autark_at timestamptz,
  synced_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
create index if not exists idx_autark_trades_entry on public.autark_trades (entry_time desc);
create index if not exists idx_autark_trades_position on public.autark_trades (position_id);

alter table public.autark_trades enable row level security;
revoke all on public.autark_trades from public, anon, authenticated;
grant select, insert, update, delete on public.autark_trades to service_role;

alter table public.autark_sync_status
  add column if not exists trade_count integer,
  add column if not exists trades_changed_at timestamptz;

create or replace function public.upsert_autark_trades(p_trades jsonb, p_all_ids jsonb default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_changed integer := 0;
  v_renamed integer := 0;
  v_marked integer := 0;
  v_restored integer := 0;
  v_total integer;
begin
  if jsonb_typeof(p_trades) <> 'array' then
    raise exception 'p_trades muss eine Liste sein';
  end if;

  drop table if exists pg_temp.trades_neu;
  create temporary table trades_neu on commit drop as
  select
    left(t->>'trade_id', 120) as trade_id,
    nullif(left(coalesce(t->>'position_id', ''), 120), '') as position_id,
    t->>'status' as status,
    nullif(left(coalesce(t->>'broker', ''), 40), '') as broker,
    nullif(left(coalesce(t->>'symbol', ''), 40), '') as symbol,
    case when t->>'side' in ('long', 'short') then t->>'side' end as side,
    (t->>'entry_price')::numeric as entry_price,
    (t->>'exit_price')::numeric as exit_price,
    (t->>'entry_time')::timestamptz as entry_time,
    (t->>'exit_time')::timestamptz as exit_time,
    (t->>'quantity')::numeric as quantity,
    (t->>'leverage')::numeric as leverage,
    (t->>'gross_pnl')::numeric as gross_pnl,
    (t->>'net_pnl')::numeric as net_pnl,
    (t->>'trading_fee')::numeric as trading_fee,
    (t->>'funding_fee')::numeric as funding_fee,
    (t->>'stop_loss')::numeric as stop_loss,
    (t->>'mae_price')::numeric as mae_price,
    (t->>'mfe_price')::numeric as mfe_price,
    (t->>'strategy_followed')::boolean as strategy_followed,
    (t->>'satisfaction')::boolean as satisfaction,
    coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(case when jsonb_typeof(t->'tags') = 'array' then t->'tags' else '[]' end) x), '{}') as tags,
    coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(case when jsonb_typeof(t->'closing_tags') = 'array' then t->'closing_tags' else '[]' end) x), '{}') as closing_tags,
    case when jsonb_typeof(t->'journal') = 'object' then t->'journal' else '{}'::jsonb end as journal,
    (t->>'autark_updated_at')::timestamptz as autark_updated_at
  from jsonb_array_elements(p_trades) as t
  where coalesce(t->>'trade_id', '') <> '' and t->>'status' in ('open', 'closed');

  -- Offene Position wurde geschlossen: dieselbe Zeile uebernimmt die neue ID
  -- (aus "open:<positionId>" wird "t<Tag>_0_<positionId>"), nichts geloescht.
  update public.autark_trades a
     set trade_id = n.trade_id
    from trades_neu n
   where n.status = 'closed' and n.position_id is not null
     and a.trade_id = 'open:' || n.position_id
     and not exists (select 1 from public.autark_trades b where b.trade_id = n.trade_id);
  get diagnostics v_renamed = row_count;

  insert into public.autark_trades as a (
    trade_id, position_id, status, broker, symbol, side, entry_price, exit_price, entry_time, exit_time,
    quantity, leverage, gross_pnl, net_pnl, trading_fee, funding_fee, stop_loss, mae_price, mfe_price,
    strategy_followed, satisfaction, tags, closing_tags, journal, autark_updated_at)
  select trade_id, position_id, status, broker, symbol, side, entry_price, exit_price, entry_time, exit_time,
    quantity, leverage, gross_pnl, net_pnl, trading_fee, funding_fee, stop_loss, mae_price, mfe_price,
    strategy_followed, satisfaction, tags, closing_tags, journal, autark_updated_at
  from (select distinct on (trade_id) * from trades_neu order by trade_id) n
  on conflict (trade_id) do update set
    position_id = excluded.position_id, status = excluded.status, broker = excluded.broker,
    symbol = excluded.symbol, side = excluded.side, entry_price = excluded.entry_price,
    exit_price = excluded.exit_price, entry_time = excluded.entry_time, exit_time = excluded.exit_time,
    quantity = excluded.quantity,
    -- Hebel steht nur bei offenen Positionen; beim Schliessen nicht verlieren.
    leverage = coalesce(excluded.leverage, a.leverage),
    gross_pnl = excluded.gross_pnl, net_pnl = excluded.net_pnl, trading_fee = excluded.trading_fee,
    funding_fee = excluded.funding_fee, stop_loss = excluded.stop_loss, mae_price = excluded.mae_price,
    mfe_price = excluded.mfe_price, strategy_followed = excluded.strategy_followed,
    satisfaction = excluded.satisfaction, tags = excluded.tags, closing_tags = excluded.closing_tags,
    journal = excluded.journal, autark_updated_at = excluded.autark_updated_at,
    deleted_in_autark_at = null, synced_at = now(), changed_at = now()
  where (a.position_id, a.status, a.broker, a.symbol, a.side, a.entry_price, a.exit_price, a.entry_time,
         a.exit_time, a.quantity, a.leverage, a.gross_pnl, a.net_pnl, a.trading_fee, a.funding_fee,
         a.stop_loss, a.mae_price, a.mfe_price, a.strategy_followed, a.satisfaction, a.tags,
         a.closing_tags, a.journal, a.autark_updated_at, a.deleted_in_autark_at)
    is distinct from
        (excluded.position_id, excluded.status, excluded.broker, excluded.symbol, excluded.side,
         excluded.entry_price, excluded.exit_price, excluded.entry_time, excluded.exit_time,
         excluded.quantity, coalesce(excluded.leverage, a.leverage), excluded.gross_pnl, excluded.net_pnl,
         excluded.trading_fee, excluded.funding_fee, excluded.stop_loss, excluded.mae_price,
         excluded.mfe_price, excluded.strategy_followed, excluded.satisfaction, excluded.tags,
         excluded.closing_tags, excluded.journal, excluded.autark_updated_at, null::timestamptz);
  get diagnostics v_changed = row_count;

  -- Vollstaendige ID-Liste (taeglich): fehlende Trades nur markieren, nie loeschen.
  -- Eine leere Liste wird ignoriert (Lesefehler darf nicht alles markieren).
  if p_all_ids is not null and jsonb_typeof(p_all_ids) = 'array' and jsonb_array_length(p_all_ids) > 0 then
    update public.autark_trades
       set deleted_in_autark_at = now(), changed_at = now()
     where deleted_in_autark_at is null
       and trade_id not in (select jsonb_array_elements_text(p_all_ids));
    get diagnostics v_marked = row_count;
    update public.autark_trades
       set deleted_in_autark_at = null, changed_at = now()
     where deleted_in_autark_at is not null
       and trade_id in (select jsonb_array_elements_text(p_all_ids));
    get diagnostics v_restored = row_count;
  end if;

  select count(*) into v_total from public.autark_trades where deleted_in_autark_at is null;
  update public.autark_sync_status
     set trade_count = v_total,
         trades_changed_at = case when v_changed + v_renamed + v_marked + v_restored > 0 then now() else trades_changed_at end
   where id = 1;

  return jsonb_build_object('total', v_total, 'changed', v_changed, 'renamed', v_renamed,
                            'marked_deleted', v_marked, 'restored', v_restored);
end;
$$;

revoke execute on function public.upsert_autark_trades(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_autark_trades(jsonb, jsonb) to service_role;
