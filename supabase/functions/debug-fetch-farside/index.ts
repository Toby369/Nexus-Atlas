import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url") ?? "https://farside.co.uk/btc/";
  const apiKey = url.searchParams.get("apiKey");
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; NexusAtlasBot/1.0)",
    Prefer: "count=exact",
  };
  if (apiKey) headers["x-soso-api-key"] = apiKey;
  try {
    const res = await fetch(target, { headers });
    const text = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (respHeaders[k] = v));
    return new Response(
      JSON.stringify({ status: res.status, length: text.length, headers: respHeaders, snippet: text.slice(0, 1000) }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
