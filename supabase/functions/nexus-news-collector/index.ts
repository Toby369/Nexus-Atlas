import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

type Item={title:string;url:string;published:Date;summary:string};
type Feed={name:string;type:string;url:string;reliability:number};
const FEEDS:Feed[]=[
 {name:"Federal Reserve",type:"primary",url:"https://www.federalreserve.gov/feeds/press_all.xml",reliability:.99},
 {name:"BLS",type:"primary",url:"https://www.bls.gov/feed/bls_latest.rss",reliability:.99},
 {name:"SEC",type:"primary",url:"https://www.sec.gov/news/pressreleases.rss",reliability:.98},
 {name:"Google News BTC Macro",type:"wire",url:"https://news.google.com/rss/search?q=(Bitcoin%20OR%20BTC)%20(Fed%20OR%20Treasury%20OR%20CPI%20OR%20ETF%20OR%20geopolitics)&hl=en-US&gl=US&ceid=US:en",reliability:.70},
 {name:"Google News Treasury",type:"wire",url:"https://news.google.com/rss/search?q=US%20Treasury%20buyback%20OR%20Treasury%20liquidity&hl=en-US&gl=US&ceid=US:en",reliability:.70},
 {name:"BTC-ECHO",type:"crypto",url:"https://www.btc-echo.de/feed/",reliability:.75}
];
// WICHTIG: CDATA-Marker zuerst entpacken, DANACH erst evtl. verbleibende
// HTML-Tags entfernen. Umgekehrte Reihenfolge friss faelschlich den
// gesamten CDATA-Inhalt (z.B. URLs), da darin kein '>' vor dem Ende "]]>"
// vorkommt und <[^>]*> daher alles bis "]]>" als einen "Tag" interpretiert.
function clean(s:string){return s.replace(/<!\[CDATA\[/g,"").replace(/\]\]>/g,"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'").replace(/\s+/g," ").trim();}
function tag(xml:string,names:string[]){for(const n of names){const r=new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`,'i').exec(xml);if(r)return clean(r[1]);}return "";}
function items(xml:string):Item[]{const blocks=[...(xml.match(/<item[\s\S]*?<\/item>/gi)||[]),...(xml.match(/<entry[\s\S]*?<\/entry>/gi)||[])];const out:Item[]=[];for(const b of blocks){const title=tag(b,["title"]);let url=tag(b,["link"]);if(!url)url=/<link[^>]+href=["']([^"']+)["']/i.exec(b)?.[1]||"";const ds=tag(b,["pubDate","published","updated","dc:date"]);const published=new Date(ds);if(title&&url&&!Number.isNaN(published.getTime()))out.push({title,url,published,summary:tag(b,["description","summary","content"])});}return out;}
const rules:[string,string,number][]=[["fed","fed",95],["fomc","fed",95],["interest rate","fed",90],["treasury","treasury",90],["buyback","treasury",95],["cpi","cpi",95],["consumer price","cpi",90],["inflation","cpi",85],["etf","etf",90],["sec","regulation",85],["bitcoin","crypto",70],["crypto","crypto",65],["iran","geopolitics",85],["israel","geopolitics",85],["war","geopolitics",85],["tariff","macro",80],["jobs","macro",75],["employment","macro",75],["liquidity","macro",85]];
function score(t:string){const x=t.toLowerCase();let cat="other",impact=20;for(const [k,c,s] of rules)if(x.includes(k)&&s>impact){impact=s;cat=c;}const bull=["cut","lower","easing","buyback","liquidity","stimulus","approval","inflow","dovish","rate reduction"];const bear=["hike","higher rates","outflow","rejection","ban","war","hawkish","inflation rises","selloff"];const bs=bull.filter(k=>x.includes(k)).length,br=bear.filter(k=>x.includes(k)).length;const dir=bs>br?"bullish":br>bs?"bearish":"neutral";return {category:cat,relevance_score:Math.min(100,impact),impact_score:Math.min(100,impact),market_direction:dir,btc_impact_score:dir==="bullish"?impact:dir==="bearish"?-impact:0,is_market_moving:impact>=75,horizon:impact>=90?"short_term":"medium_term"};}
async function hash(s:string){const b=new TextEncoder().encode(s);const h=await crypto.subtle.digest("SHA-256",b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");}

// Jede REST-Anfrage ist ein Log-Eintrag (Supabase Log Ingestion). Deshalb
// werden die Quell-IDs einmal pro Lauf geladen, Duplikate pro Feed mit einer
// einzigen in(external_id)-Abfrage geprueft und neue Eintraege pro Feed
// gesammelt eingefuegt -- vorher eine Abfrage pro Feed-Eintrag (~4'400/Tag).
let knownSources:Map<string,number>|null=null;
// Schlaegt das Laden fehl, bleibt der Cache leer und sourceId() faellt pro
// Feed auf Insert-mit-Nachladen zurueck -- ein Fehler hier stoppt den Lauf nicht.
async function loadSources(){const {data,error}=await db.from("news_sources").select("id,name");knownSources=error?null:new Map((data??[]).map((s:any)=>[s.name,s.id]));}
// SELECT-then-INSERT ist nicht atomar: schlaegt der Insert am unique(name)-
// Constraint fehl, weil die Quelle inzwischen existiert, per Name nachladen
// statt zu werfen -- idempotent statt fragil.
async function sourceId(f:Feed){const known=knownSources?.get(f.name);if(known!==undefined)return known;const {data:n,error}=await db.from("news_sources").insert({name:f.name,source_type:f.type,base_reliability:f.reliability,url:f.url,enabled:true}).select("id").single();if(error){const {data:existing}=await db.from("news_sources").select("id").eq("name",f.name).maybeSingle();if(existing)return existing.id;throw new Error("sourceId insert: "+error.message);}return n.id;}
async function fetchFeed(f:Feed):Promise<Item[]>{const controller=new AbortController();const t=setTimeout(()=>controller.abort(),8000);let r:Response;try{r=await fetch(f.url,{signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (compatible; NEXUS-News/1.1)","Accept":"application/rss+xml, application/xml, text/xml, */*"}});}catch(e){throw new Error("fetch failed: "+(e instanceof Error?e.message:JSON.stringify(e)));}finally{clearTimeout(t);}if(!r.ok)throw new Error(`${f.name} HTTP ${r.status}`);const text=await r.text();const parsed=items(text);if(parsed.length===0)throw new Error(`0 items parsed, len=${text.length}`);return parsed.slice(0,40);}

// Deutsche Uebersetzung nur fuer neue (nicht-doppelte) Titel, einmalig bei
// der Erfassung -- nicht bei jedem Seitenaufruf. MyMemory ist kostenlos und
// braucht keinen API-Key (Anonymous-Tier). Best-effort: schlaegt die
// Uebersetzung fehl, blockiert das den News-Import nicht (Titel bleibt
// englisch, Frontend faellt darauf zurueck).
//
// BTC-ECHO liefert bereits deutsche Titel -- eine Rueckuebersetzung DE->DE
// waere sinnlos und wuerde nur unnoetig MyMemory-Kontingent verbrauchen,
// daher ueberspringt processFeed() die Uebersetzung fuer BTC-ECHO.
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

async function processFeed(f:Feed,since:number){const sid=await sourceId(f);const its=await fetchFeed(f);
  const fresh:{it:Item;external:string}[]=[];for(const it of its){if(it.published.getTime()<since)continue;fresh.push({it,external:await hash(f.name+"|"+it.url)});}
  if(fresh.length===0)return {inserted:0,skipped:0};
  const {data:existing,error:selError}=await db.from("news_events").select("external_id").eq("source_id",sid).in("external_id",[...new Set(fresh.map(x=>x.external))]);if(selError)throw new Error("dedupe: "+selError.message);
  const seen=new Set((existing??[]).map((r:any)=>r.external_id));let skipped=0;const rows=[];
  for(const {it,external} of fresh){if(seen.has(external)){skipped++;continue;}seen.add(external);const s=score(it.title+" "+it.summary);const title=it.title.slice(0,500);const title_de=f.name==="BTC-ECHO"?title:await translateToGerman(title);rows.push({source_id:sid,external_id:external,published_at:it.published.toISOString(),title,title_de,summary:it.summary.slice(0,2000),url:it.url,category:s.category,market_direction:s.market_direction,impact_score:s.impact_score,confidence_score:Math.round(f.reliability*100),relevance_score:s.relevance_score,btc_impact_score:s.btc_impact_score,horizon:s.horizon,is_market_moving:s.is_market_moving,is_verified:f.type==="primary",raw_hash:external});}
  if(rows.length>0){const {error}=await db.from("news_events").upsert(rows,{onConflict:"source_id,external_id",ignoreDuplicates:true});if(error)throw new Error("insert: "+error.message);}
  return {inserted:rows.length,skipped};}

Deno.serve(async(_req)=>{const since=Date.now()-72*60*60*1000;await loadSources();const results=await Promise.allSettled(FEEDS.map(f=>processFeed(f,since)));let inserted=0,skipped=0;const errors:any[]=[];results.forEach((r,i)=>{if(r.status==="fulfilled"){inserted+=r.value.inserted;skipped+=r.value.skipped;}else{errors.push({source:FEEDS[i].name,error:r.reason instanceof Error?r.reason.message:String(r.reason)});}});return new Response(JSON.stringify({ok:errors.length===0,inserted,skipped,errors,feeds:FEEDS.map(x=>x.name),ran_at:new Date().toISOString()}),{headers:{"Content-Type":"application/json"}})});
