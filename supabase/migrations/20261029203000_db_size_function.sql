-- Datenbank-Groesse fuer die Konto-Seite (Toby 29.10.2026: Free-Plan, unter 500 MB bleiben).
-- Nur serverseitig (service_role); security definer, weil pg_database_size sonst
-- je nach Rolle CONNECT-Rechte braucht.
create or replace function public.get_db_size_bytes()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$ select pg_database_size(current_database()) $$;

revoke all on function public.get_db_size_bytes() from public, anon, authenticated;
grant execute on function public.get_db_size_bytes() to service_role;
