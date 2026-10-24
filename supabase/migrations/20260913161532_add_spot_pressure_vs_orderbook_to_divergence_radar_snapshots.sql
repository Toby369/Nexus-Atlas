-- Exportiert aus supabase_migrations.schema_migrations (20260913161532 add_spot_pressure_vs_orderbook_to_divergence_radar_snapshots)

-- Neue Divergenz-Radar-Zeile (13.09.2026, Nutzer-Wunsch nach Rueckfrage zu
-- Netto-Taker-Flow +20%/Preis +0.5%): Spot-Pressure vs. Orderbuch-Tiefe,
-- siehe lib/divergenceRadar.ts::computeSpotPressureVsOrderbookDivergence.
-- Ergaenzt (nicht ersetzt) spot_pressure_vs_price -- die beiden pruefen
-- unterschiedliche Dinge (Preis-Reaktion vs. tatsaechliche Orderbuch-Tiefe
-- im selben Fenster).
alter table divergence_radar_snapshots
  add column spot_pressure_vs_orderbook text;
