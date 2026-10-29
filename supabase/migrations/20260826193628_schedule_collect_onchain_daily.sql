-- Exportiert aus supabase_migrations.schema_migrations (20260826193628 schedule_collect_onchain_daily)

-- Bewusst NUR einmal taeglich (nicht alle 5/15/30 Min wie die uebrigen
-- Collectoren) -- BGeometrics kostenloser Tier erlaubt nur 10 Requests/
-- Stunde und 15/Tag (per Live-Test verifiziert, live HTTP 429 erhalten).
-- 7 Metriken x 1 Lauf/Tag = 7 Requests/Tag, deutlich unter dem Limit.
select cron.schedule(
  'collect-onchain-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-onchain',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
