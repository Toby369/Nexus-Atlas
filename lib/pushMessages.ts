import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPushMessageId } from "@/lib/pushMessageFormat";

// Gespeicherte Push-Nachrichten mit Erklaerung (Tabelle push_messages,
// geschrieben von der Edge Function send-state-change-push). Antippen einer
// Push oeffnet /mitteilung/<id>. Nur serverseitig mit dem Admin-Client
// gelesen, die Tabelle hat RLS ohne Policies.

export interface PushMessage {
  id: string;
  created_at: string;
  kind: string;
  title: string;
  body: string;
  explanation: string;
  details: string[];
  link_url: string | null;
}

function normalize(row: Record<string, unknown>): PushMessage {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    explanation: String(row.explanation),
    details: Array.isArray(row.details) ? row.details.map(String) : [],
    link_url: typeof row.link_url === "string" && row.link_url.length > 0 ? row.link_url : null,
  };
}

export async function getPushMessage(id: string): Promise<PushMessage | null> {
  if (!isPushMessageId(id)) return null;
  const { data, error } = await getSupabaseAdmin().from("push_messages").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("push_messages lesen:", error.message);
    return null;
  }
  return data ? normalize(data) : null;
}

export async function getRecentPushMessages(limit: number): Promise<PushMessage[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("push_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("push_messages lesen:", error.message);
    return [];
  }
  return (data ?? []).map(normalize);
}
