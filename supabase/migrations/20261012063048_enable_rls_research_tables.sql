-- Exportiert aus supabase_migrations.schema_migrations (20261012063048 enable_rls_research_tables)

ALTER TABLE public.research_regime_cci_roc_1h ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_funding_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_rsi_reversal_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.research_regime_cci_roc_1h FOR SELECT USING (true);
CREATE POLICY "Public read access" ON public.research_funding_rate_history FOR SELECT USING (true);
CREATE POLICY "Public read access" ON public.research_rsi_reversal_results FOR SELECT USING (true);
