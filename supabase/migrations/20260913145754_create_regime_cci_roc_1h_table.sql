-- Exportiert aus supabase_migrations.schema_migrations (20260913145754 create_regime_cci_roc_1h_table)

create table research_regime_cci_roc_1h (
  candle_open_time timestamptz primary key,
  cci numeric,
  roc numeric
);
