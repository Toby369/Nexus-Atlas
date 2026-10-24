-- Exportiert aus supabase_migrations.schema_migrations (20261014123204 options_snapshots_30d_skew)

-- 2026-10-14: 30-Tage-ATM-IV und 30-Tage-Skew (gleiche Rechnung wie die
-- Volatilitaets-Kachel, lib/volatility.ts::thirtyDayOptions) fuer den
-- Vorwaertstest des Skew-Pfeils (docs/research/SKEW-PFEIL-VORWAERTSTEST.md).
alter table public.options_snapshots
  add column if not exists iv_30d numeric,
  add column if not exists skew_30d numeric,
  add column if not exists expiries_30d text;
