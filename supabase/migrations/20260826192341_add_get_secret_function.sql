-- Exportiert aus supabase_migrations.schema_migrations (20260826192341 add_get_secret_function)

-- Sichere, service-role-only Abfrage von Supabase-Vault-Secrets aus Edge
-- Functions heraus (keine native "Edge Function Secrets"-Verwaltung ueber
-- die verfuegbaren MCP-Tools moeglich; Vault ist die von Supabase selbst
-- dokumentierte Alternative fuer genau diesen Fall). SECURITY DEFINER, aber
-- explizit nur fuer service_role freigegeben -- anon/authenticated koennen
-- diese Funktion nicht aufrufen, selbst wenn sie den Funktionsnamen kennen.
create or replace function public.get_secret(secret_name text)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

comment on function public.get_secret(text) is 'Service-role-only Zugriff auf Supabase-Vault-Secrets (z.B. FRED_API_KEY) aus Edge Functions. Niemals fuer anon/authenticated freigeben.';
