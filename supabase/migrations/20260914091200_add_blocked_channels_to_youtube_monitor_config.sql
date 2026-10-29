-- Exportiert aus supabase_migrations.schema_migrations (20260914091200 add_blocked_channels_to_youtube_monitor_config)

alter table youtube_monitor_config add column blocked_channels text[] not null default '{}';

-- Nutzer-Wunsch 14.09.2026: "diese verfasser moechte ich nicht mehr dabei
-- haben" (4 Kanaele aus einem Screenshot: ElTys4n, EasyCrypto101,
-- Paisa Today, TRADE WITH AARO -- keiner davon ist in der Liste der
-- vertrauenswuerdigen konfigurierten Kanaele, alle kamen ueber einen
-- breiteren Fund rein). Sofort wirksam gesperrt, nicht erst nach manueller
-- UI-Eingabe.
update youtube_monitor_config
set blocked_channels = array['ElTys4n', 'EasyCrypto101', 'Paisa Today', 'TRADE WITH AARO']
where id = 1;
