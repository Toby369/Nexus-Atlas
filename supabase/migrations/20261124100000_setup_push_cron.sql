-- Setup-Push (Toby 23.11.2026): alle 15 Min POST /api/setup/push.
-- Ruft die Vercel-Route direkt aus pg_cron auf (ohne Edge-Function-Umweg,
-- also ohne zusaetzlichen edge_logs-Eintrag). Das CRON_SECRET kommt zur
-- Laufzeit aus dem Vault und steht nicht im Job-Text.
-- Log-Kontingent: je Lauf 2 Supabase-Abfragen (get_setup_inputs, Poll-
-- Bundle), bei "Setup steht" +1 (Sperre) und der Push -> ~200 Eintraege
-- pro Tag, ~6'000 pro Monat.
-- Versetzt zu :00/:15/:30/:45 (dort laufen die grossen Jobs).
select cron.schedule(
  'setup-push-every-15-min',
  '11,26,41,56 * * * *',
  $$
  select net.http_post(
    url := 'https://nexus-atlas-zeta.vercel.app/api/setup/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
