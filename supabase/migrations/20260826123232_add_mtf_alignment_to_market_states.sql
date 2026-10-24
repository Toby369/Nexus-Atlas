-- Exportiert aus supabase_migrations.schema_migrations (20260826123232 add_mtf_alignment_to_market_states)

alter table public.market_states
  add column mtf_alignment jsonb;

comment on column public.market_states.mtf_alignment is 'Phase 6: Multi-Timeframe-Alignment. Gewichtete Uebereinstimmung der Struktur-Trends ueber 1H/4H/1D (Gewichte: siehe MTF_WEIGHTS in compute-market-state, hoehere Zeitrahmen zaehlen staerker -- bewusst NICHT gleichgewichtet). alignment_pct = Anteil der Gewichtung, der mit der dominanten Richtung uebereinstimmt. null, wenn keine Zeitrahmen mit frischen Daten verfuegbar waren.';
