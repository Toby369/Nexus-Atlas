import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "text/html; charset=utf-8" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, key);
  const [{ data: market }, { data: news }] = await Promise.all([
    db.from("market_snapshots").select("timestamp_utc,last_price,open_interest_usd,funding_rate,symbol,exchange,status").eq("status","ok").order("timestamp_utc", { ascending:false }).limit(1),
    db.from("news_events").select("published_at,title,summary,category,market_direction,impact_score,confidence_score,relevance_score,btc_impact_score,horizon,is_market_moving,is_verified,url").eq("is_market_moving",true).order("published_at", { ascending:false }).limit(10)
  ]);
  const m = market?.[0];
  const fmt = (v: unknown) => v == null ? "—" : String(v);
  const newsHtml = (news ?? []).map(n => `<article><b>${n.market_direction === 'bullish' ? '🟢' : n.market_direction === 'bearish' ? '🔴' : '🟡'} ${esc(n.category)}</b><h3>${esc(n.title)}</h3><p>${esc(n.summary ?? '')}</p><div>Impact <strong>${n.impact_score}</strong> · BTC <strong>${n.btc_impact_score > 0 ? '+' : ''}${n.btc_impact_score}</strong> · Confidence <strong>${n.confidence_score}</strong></div></article>`).join("") || '<p>No market-moving news yet.</p>';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>NEXUS V1</title><style>body{font-family:system-ui;margin:0;background:#0b1020;color:#eef2ff;padding:18px}main{max-width:900px;margin:auto}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card,article{background:#151c31;border:1px solid #283352;border-radius:14px;padding:16px;margin:10px 0}.value{font-size:24px;font-weight:700}h1{margin-bottom:4px}small{color:#9aa6c2}article h3{margin:8px 0}button{padding:10px 14px;border:0;border-radius:10px} @media(max-width:650px){.grid{grid-template-columns:1fr 1fr}}</style></head><body><main><h1>NEXUS BTC</h1><small>LIVE · Supabase · auto refresh 60s</small><div class="grid"><div class="card">BTC<div class="value">$${fmt(m?.last_price)}</div></div><div class="card">Funding<div class="value">${fmt(m?.funding_rate)}</div></div><div class="card">OI USD<div class="value">${fmt(m?.open_interest_usd)}</div></div></div><section><h2>🔥 Market-Moving News</h2>${newsHtml}</section><small>Last market update: ${fmt(m?.timestamp_utc)}</small></main></body></html>`;
  return new Response(html, { headers: cors });
});
function esc(s: unknown){ return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
