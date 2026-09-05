// Datenbeschaffung fuer die News-Kachel (KI-Ergaenzung, 05.09.2026) --
// reines Lesen, kein Schreiben. Nutzt dieselbe Auswahl (markbewegend,
// letzte 72h, Top 5) wie das bestehende regelbasierte News-Risk-Panel
// (siehe getHighImpactNews() in app/page.tsx) -- keine zweite, abweichende
// Definition von "markbewegend".
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";

const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LIMIT = 5;

interface NewsRow {
  title: string;
  title_de: string | null;
  summary: string | null;
  category: string;
  market_direction: string;
  impact_score: number;
}

/**
 * Liefert einen Freitext-Kontext fuer das "news-analysis"-Prompt-Profile,
 * oder null, wenn es in den letzten 72h keine markbewegende News gibt --
 * dann lohnt sich kein bezahlter AI-Aufruf (siehe Aufrufer-Route).
 */
export async function buildNewsAnalysisContext(): Promise<string | null> {
  const cutoff = new Date(Date.now() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("news_events")
    .select("title, title_de, summary, category, market_direction, impact_score")
    .eq("is_market_moving", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(NEWS_LIMIT);

  if (error) {
    console.error("newsAnalysisContext: Fehler beim Laden der News:", error.message);
    return null;
  }

  const rows = (data ?? []) as NewsRow[];
  if (rows.length === 0) return null;

  const lines = rows.map((n, i) => {
    const title = n.title_de ?? n.title;
    const summaryPart = n.summary ? ` -- ${n.summary}` : "";
    return `${i + 1}. [${n.category}, Impact-Score ${n.impact_score}, Nexus-Klassifikation: ${n.market_direction}] ${title}${summaryPart}`;
  });

  return [
    `Von Nexus regelbasiert als markbewegend eingestufte BTC-relevante Nachrichten der letzten ${NEWS_LOOKBACK_HOURS}h:`,
    ...lines,
  ].join("\n");
}
