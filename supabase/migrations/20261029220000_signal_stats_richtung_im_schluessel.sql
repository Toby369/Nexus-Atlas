-- Woechentliche Signal-Statistik lief seit 12.10.2026 nicht mehr durch
-- (Befund 29.10.2026, docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md,
-- Punkt H). compute_signal_stats() gruppiert nach (Kategorie, Signal,
-- Horizont, erwartete Richtung), signal_stats_results war aber nur eindeutig
-- je (Fenster, Kategorie, Signal, Horizont). Der Risiko-Faktor basis_crowding
-- leitet seine Richtung aus dem Vorzeichen der Basis ab und kommt seit Herbst
-- in beiden Richtungen vor -> zwei Zeilen fuer denselben Schluessel ->
-- "ON CONFLICT DO UPDATE command cannot affect row a second time", der ganze
-- Lauf (90d und all) bricht ab, der KI-Rueckblick las seither den Stand
-- vom 12.10.
--
-- Loesung: die erwartete Richtung gehoert zum Schluessel. NULLS NOT DISTINCT,
-- weil richtungslose Faktoren (Magnitude-Test) direction_expected = NULL haben
-- und weiterhin genau eine Zeile je Zelle bekommen sollen. Keine neue Tabelle,
-- keine neuen Rechte.
alter table public.signal_stats_results
  drop constraint signal_stats_results_unique_cell;

alter table public.signal_stats_results
  add constraint signal_stats_results_unique_cell
  unique nulls not distinct (window_label, category, signal_type, horizon_hours, direction_expected);

-- compute_signal_stats(): nur das Konfliktziel anpassen (Richtung ist jetzt
-- Teil des Schluessels und wird nicht mehr ueberschrieben). Ersetzt wird in
-- der laufenden Definition, damit spaetere Korrekturen an der Funktion
-- (numeric-Casts) erhalten bleiben; bricht ab, wenn die Stelle fehlt.
do $$
declare
  alt text := pg_get_functiondef('public.compute_signal_stats(text)'::regprocedure);
  neu text;
begin
  neu := regexp_replace(
    alt,
    'on conflict \(window_label, category, signal_type, horizon_hours\) do update set\s+direction_expected = excluded\.direction_expected,',
    'on conflict (window_label, category, signal_type, horizon_hours, direction_expected) do update set'
  );
  if neu = alt then
    raise exception 'compute_signal_stats: Konfliktziel nicht gefunden, Funktion unveraendert';
  end if;
  execute neu;
end
$$;
