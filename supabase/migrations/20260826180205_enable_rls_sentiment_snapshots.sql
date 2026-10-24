-- Exportiert aus supabase_migrations.schema_migrations (20260826180205 enable_rls_sentiment_snapshots)

-- sentiment_snapshots war die einzige Snapshot-Tabelle ohne RLS (Sicherheits-
-- Advisory: voll fuer anon/authenticated les-/schreibbar). Gleiches Muster wie
-- die bereits bestehende "Public read access"-Policy auf candles/
-- macro_snapshots/market_features/market_states/options_snapshots: RLS an,
-- nur SELECT fuer public, kein INSERT/UPDATE/DELETE (Schreibzugriff bleibt
-- ausschliesslich ueber den Service-Role-Key der Edge Function, der RLS
-- ohnehin umgeht -- keine Verhaltensaenderung fuer collect-sentiment).
ALTER TABLE public.sentiment_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.sentiment_snapshots
  FOR SELECT
  TO public
  USING (true);
