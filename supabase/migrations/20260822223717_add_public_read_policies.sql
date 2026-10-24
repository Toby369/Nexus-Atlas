-- Exportiert aus supabase_migrations.schema_migrations (20260822223717 add_public_read_policies)


create policy "Public read access" on public.market_snapshots for select using (true);
create policy "Public read access" on public.spot_market_snapshots for select using (true);
create policy "Public read access" on public.liquidation_events for select using (true);
create policy "Public read access" on public.news_sources for select using (true);
create policy "Public read access" on public.news_events for select using (true);
create policy "Public read access" on public.nexus_events for select using (true);
