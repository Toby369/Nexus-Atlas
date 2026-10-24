import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Einmalige Debug-Funktion (analog debug-fetch-farside): listet aktuell
// tatsaechlich kostenlose OpenRouter-Modelle live, da das Free-Angebot sich
// haeufig aendert und Web-Suchergebnisse dazu schnell veraltet sind.
Deno.serve(async (_req: Request) => {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const json = await res.json();
  const free = (json.data ?? [])
    .filter((m: any) => m.id?.endsWith(":free"))
    .map((m: any) => ({
      id: m.id,
      context_length: m.context_length,
      prompt_price: m.pricing?.prompt,
      completion_price: m.pricing?.completion,
    }));
  return new Response(JSON.stringify({ count: free.length, free }), {
    headers: { "Content-Type": "application/json" },
  });
});
