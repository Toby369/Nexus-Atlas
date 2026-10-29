import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 5 Market-Intelligence-Engine: On-Chain-Collector.
//
// Datenquelle: BGeometrics / bitcoin-data.com (api.bitcoin-data.com),
// kostenloser Tier -- API-Key vom Nutzer selbst angelegt, aus Supabase
// Vault gelesen (get_secret('BGEOMETRICS_API_KEY'), niemals im Code/Repo).
//
// Rate-Limit des kostenlosen Tiers (per Live-Test verifiziert, live 429
// erhalten): 10 Requests/Stunde, 15/Tag. Deshalb bewusst nur EINMAL
// TAEGLICH per pg_cron erfasst (Datengranularitaet der Metriken ist
// ohnehin taeglich -- haeufigere Erfassung waere reine Verschwendung des
// knappen Kontingents), und nur mit den auf dem kostenlosen Tier
// tatsaechlich zugaenglichen Metriken (siehe METRICS unten).
//
// exchange-netflow-btc, exchange-reserve-btc UND miner-net-flow sind Teil
// der API-Dokumentation, lieferten aber live HTTP 403 auf dem kostenlosen
// Tier (Subscription-only) -- miner-net-flow zuletzt am 27.08.2026 live
// bestaetigt (die anderen 7 Metriken liefern an diesem Tag erstmals
// durchgehend status='ok' mit echten Werten). Deshalb bewusst NICHT mehr
// abgefragt, um das knappe Kontingent nicht mit taeglich garantiert
// fehlschlagenden Anfragen zu verschwenden.
//
// "Whale"-Naeherung (Spec-Vorgabe: Wallet/Smart-Money-Layer vorbereiten,
// aber NIE automatisch eine Adresse als "Smart Money" behaupten): die
// kostenlose API bietet keine transaktionsbasierte Whale-Transfer-Erkennung
// (das waere ein Bezahl-Feature bei den meisten Anbietern), sondern nur die
// Anzahl Adressen je Balance-Band. balance-addr-10K-BTC = Anzahl Adressen
// mit >10.000 BTC Bestand -- ein Adress-COUNT-Proxy fuer Whale-Aktivitaet,
// explizit als solcher benannt/gelabelt, keine Transfer-Erkennung und keine
// Smart-Money-Behauptung.
const API_BASE = "https://api.bitcoin-data.com";

interface Metric {
  endpoint: string;
  label: string;
}

const METRICS: Metric[] = [
  { endpoint: "sopr", label: "SOPR" },
  { endpoint: "mvrv", label: "MVRV" },
  { endpoint: "realized-price", label: "Realized Price" },
  { endpoint: "lth-net-position-change-btc", label: "LTH Net-Position-Change (BTC)" },
  { endpoint: "sth-net-position-change-btc", label: "STH Net-Position-Change (BTC)" },
  { endpoint: "stablecoin-supply", label: "Stablecoin-Supply (gesamt, USD)" },
  { endpoint: "balance-addr-10K-BTC", label: "Whale-Adressen (>10K BTC, Anzahl)" },
];

const STAGGER_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url.split("?")[0]}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

interface OnchainRow {
  metric: string;
  label: string;
  value: number | null;
  prev_value: number | null;
  change_pct: number | null;
  observation_date: string | null;
  status: "ok" | "error";
  error: string | null;
}

// Generische Werteextraktion: die API liefert je Zeile {d, unixTs, <feldname>},
// wobei <feldname> je nach Metrik unterschiedlich heisst (z.B. "sopr", "mvrv").
// Statt jeden Feldnamen hart zu kodieren, wird das erste Feld genommen, das
// weder "d" noch "unixTs" heisst.
function extractGenericValue(entry: Record<string, unknown>): number | null {
  for (const [key, val] of Object.entries(entry)) {
    if (key === "d" || key === "unixTs") continue;
    const num = typeof val === "number" ? val : parseFloat(String(val));
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

// stablecoin-supply liefert mehrere Stablecoin-Felder gleichzeitig (dai,
// usdc, usdt, ...) statt eines einzelnen Werts -- Summe aller als
// Gesamt-Stablecoin-Angebot.
function extractStablecoinTotal(entry: Record<string, unknown>): number | null {
  let sum = 0;
  let found = false;
  for (const [key, val] of Object.entries(entry)) {
    if (key === "d" || key === "unixTs") continue;
    const num = typeof val === "number" ? val : parseFloat(String(val));
    if (!Number.isNaN(num)) {
      sum += num;
      found = true;
    }
  }
  return found ? sum : null;
}

async function collectMetric(apiKey: string, metric: Metric): Promise<OnchainRow> {
  try {
    const json = await fetchJson(`${API_BASE}/v1/${metric.endpoint}?token=${apiKey}`);
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error(`Leere/unerwartete Antwort fuer ${metric.endpoint}`);
    }
    const extract = metric.endpoint === "stablecoin-supply" ? extractStablecoinTotal : extractGenericValue;
    const latest = json[json.length - 1];
    const prior = json.length > 1 ? json[json.length - 2] : null;

    const value = extract(latest);
    const prevValue = prior ? extract(prior) : null;
    const changePct =
      value !== null && prevValue !== null && prevValue !== 0
        ? ((value - prevValue) / Math.abs(prevValue)) * 100
        : null;
    const observationDate = typeof latest?.d === "string" ? latest.d : null;

    return {
      metric: metric.endpoint,
      label: metric.label,
      value,
      prev_value: prevValue,
      change_pct: changePct,
      observation_date: observationDate,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return {
      metric: metric.endpoint,
      label: metric.label,
      value: null,
      prev_value: null,
      change_pct: null,
      observation_date: null,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();
  const rows: OnchainRow[] = [];

  const { data: apiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "BGEOMETRICS_API_KEY",
  });

  if (keyError || !apiKey) {
    for (const metric of METRICS) {
      rows.push({
        metric: metric.endpoint,
        label: metric.label,
        value: null,
        prev_value: null,
        change_pct: null,
        observation_date: null,
        status: "error",
        error: keyError ? keyError.message : "BGEOMETRICS_API_KEY nicht in Vault hinterlegt",
      });
    }
  } else {
    for (let i = 0; i < METRICS.length; i++) {
      if (i > 0) await sleep(STAGGER_MS);
      rows.push(await collectMetric(apiKey, METRICS[i]));
    }
  }

  const { error: insertError } = await supabase.from("onchain_snapshots").insert(
    rows.map((r) => ({
      timestamp_utc: now,
      metric: r.metric,
      label: r.label,
      value: r.value,
      prev_value: r.prev_value,
      change_pct: r.change_pct,
      observation_date: r.observation_date,
      status: r.status,
      error: r.error,
    })),
  );

  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, results: rows.map((r) => ({ metric: r.metric, status: r.status, error: r.error })) }),
    { headers: { "Content-Type": "application/json" } },
  );
});
