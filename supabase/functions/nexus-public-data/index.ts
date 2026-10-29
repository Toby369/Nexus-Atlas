import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json; charset=utf-8"};
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers});const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const [{data:marketRows,error:me},{data:news,error:ne}]=await Promise.all([
 db.from('market_snapshots').select('timestamp_utc,last_price,open_interest,open_interest_usd,funding_rate,symbol,exchange,status').eq('status','ok').eq('symbol','BTCUSDT').eq('exchange','binance').order('timestamp_utc',{ascending:false}).limit(1),
 db.from('news_events').select('published_at,title,summary,category,market_direction,impact_score,confidence_score,relevance_score,btc_impact_score,horizon,is_market_moving,is_verified,url').eq('is_market_moving',true).order('published_at',{ascending:false}).limit(10)
]);
const market=marketRows?.[0]??null;
return new Response(JSON.stringify({market,news:news??[],errors:{market:me?.message??null,news:ne?.message??null},updated_at:new Date().toISOString()}),{headers});});
