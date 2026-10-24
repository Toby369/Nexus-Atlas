-- Exportiert aus supabase_migrations.schema_migrations (20260910020920 fix_signal_outcomes_unique_constraint)


-- Bugfix: die urspruengliche Unique-Constraint (source_table, source_id,
-- horizon_hours) ignorierte signal_type -- zwei verschiedene Signal-Typen
-- aus DERSELBEN market_states-Zeile (z.B. Muster "Fragile Bullish" UND der
-- generische Risk-Faktor "warning_pattern", beide an source_id=<gleiche
-- market_states.id>) kollidierten dadurch ueber ON CONFLICT DO NOTHING --
-- der zweite Insert wurde faelschlich als "bereits vorhanden" uebersprungen
-- statt als eigenstaendiges Signal gespeichert zu werden. Ergebnis: alle
-- warning_pattern-Risk-Faktor-Transitionen gingen beim ersten Lauf verloren.
alter table public.signal_outcomes drop constraint signal_outcomes_unique_instance;
alter table public.signal_outcomes add constraint signal_outcomes_unique_instance
  unique (source_table, source_id, signal_type, horizon_hours);
