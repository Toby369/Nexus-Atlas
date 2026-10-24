-- Exportiert aus supabase_migrations.schema_migrations (20260911175359 add_mfe_pct_1m_to_swing_setup_results)

alter table research_swing_setup_results add column mfe_pct_1m numeric;
comment on column research_swing_setup_results.mfe_pct_1m is
  '1m-verfeinerter MFE fuer SL-Ausgaenge: Kreuzungspreis der ersten 1m-Kerze innerhalb der 15m-Ausloeser-Kerze, die die SL-Marke tatsaechlich beruehrt, statt des 15m-Kerzentiefs/-hochs. Siehe SWING-SETUP-TRAILING-BACKTEST_2026-09-11.md Abschnitt 4. NULL fuer alle nicht-SL-Ausgaenge.';
