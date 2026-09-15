import { supabase } from "./supabase";
import type { KnowledgeBaseEntry } from "./types";

// Datenbeschaffung fuer die Wissens-Kacheln auf /lernen (Welz/Salomon/Mein
// System). Reines Lesen aus knowledge_base (statischer Referenztext, siehe
// Migration create_knowledge_base_table + seed_knowledge_base).

export async function getKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  const { data, error } = await supabase.from("knowledge_base").select("*").order("sort_order");
  if (error) {
    console.error("knowledgeBaseContext: Fehler beim Laden von knowledge_base:", error.message);
    return [];
  }
  return data ?? [];
}
