-- Exportiert aus supabase_migrations.schema_migrations (20260911195412 create_confluence_signal_activation)

create table research_confluence_signal_activation (
  setup_id bigint not null,
  signal_a text not null,
  direction text not null check (direction in ('LONG','SHORT')),
  outcome text not null,
  is_active boolean not null,
  primary key (setup_id, signal_a, direction)
);
alter table research_confluence_signal_activation enable row level security;
create policy "Public read access" on research_confluence_signal_activation
  for select to public using (true);
comment on table research_confluence_signal_activation is
  'Zeilen-Ebene-Aktivierung je (Setup, Signal, Richtung) -- Grundlage fuer die Paar-Analyse (Abschnitt 5 des Confluence-Protokolls). Nur fuer Signale befuellt, die research_confluence_signal_stats.min_n_met=true erreicht haben.';
create index on research_confluence_signal_activation(signal_a, direction);
