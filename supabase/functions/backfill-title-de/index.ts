import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function translateToGerman(text: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|de`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const translated = json?.responseData?.translatedText;
    return typeof translated === "string" && translated.length > 0 ? translated : null;
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (_req) => {
  const { data: rows, error } = await db
    .from("news_events")
    .select("id, title")
    .eq("is_market_moving", true)
    .gte("published_at", new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .is("title_de", null)
    .order("published_at", { ascending: false })
    .limit(30);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let updated = 0;
  const failed: number[] = [];
  for (const row of rows ?? []) {
    const title_de = await translateToGerman(row.title);
    if (title_de) {
      const { error: updErr } = await db.from("news_events").update({ title_de }).eq("id", row.id);
      if (!updErr) updated++;
      else failed.push(row.id);
    } else {
      failed.push(row.id);
    }
  }

  return new Response(JSON.stringify({ ok: true, total: rows?.length ?? 0, updated, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
