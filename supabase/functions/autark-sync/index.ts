import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cleanTrade, MAX_TRADE_IDS, MAX_TRADES } from "../_shared/autarkTradeClean.ts";

// Zonen aus AutarkTrade (Toby 28.10.2026, docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).
// tools/autark-sync/autark_sync.py liest Tobys Zeichnungen (Rechtecke,
// Horizontale) nur lesend aus autarktrade.db und schickt sie hierher:
//   POST  Authorization: Bearer <AUTARK_SYNC_SECRET>
//   {"symbol": "BTCUSDT", "zones": [{"id": 12, "lo": 81000, "hi": 81300, "label": "..."}]}
// Die Zonen ersetzen own_zones vollstaendig (replace_own_zones_from_autark,
// atomar, nur bei Aenderung; autark_sync_status fuehrt den letzten Sync).
// Eine leere Liste nur mit "allow_empty": true. Eigene Edge Function mit
// verify_jwt=false wie webhook-tradingview.
//
// Seit 22.11.2026 optional zusaetzlich "drawings": alle Zeichnungen
// (chart_zeichnungen ohne pinsel/emoji/versteckt), im selben Request:
//   {"id": 7, "kind": "avwap", "label": "...", "points": [{"t": ms, "p": preis}],
//    "style": {...}, "visible_on": ["15m", ...] | null, "updated_at": ms}
// -> replace_autark_drawings (atomar, nur bei Aenderung). Bodies OHNE
// "drawings" bleiben gueltig (aeltere Skriptversion auf dem VPS).
//
// Seit 26.11.2026 optional "trades" (Journal, privat) und "all_trade_ids":
//   {"trade_id": "t1795046400_0_123", "status": "closed", "side": "long",
//    "entry_time": <Unix-Sekunden>, "net_pnl": -1.2, "journal": {...}, ...}
// -> upsert_autark_trades (nur Aenderungen). "all_trade_ids" (taeglich)
// markiert fehlende Trades als in AutarkTrade geloescht; Nexus loescht nie.
// HTML wird hier nochmals zu Text, Texte werden gekuerzt.

const MAX_ZONES = 60;
const MAX_DRAWINGS = 300;
const MAX_POINTS = 30;
const DRAWING_KINDS = new Set([
  "horizontale", "strahlH", "vertikale", "trendlinie", "strahl", "kanal", "rechteck", "fib", "fibExt",
  "position", "text", "volprofil", "avwap", "pfeil", "ellipse", "pfad",
]);
const STYLE_KEYS = ["text", "rechts", "links", "baender", "stufen"];

function cleanDrawing(raw: Record<string, unknown>): Record<string, unknown> | string {
  const id = Number(raw?.id);
  if (!Number.isInteger(id) || id < 0) return "Zeichnung ohne gültige id.";
  const kind = typeof raw?.kind === "string" ? raw.kind : "";
  if (!DRAWING_KINDS.has(kind)) return `Zeichnungstyp ${JSON.stringify(kind)} nicht erlaubt.`;
  if (!Array.isArray(raw?.points) || raw.points.length === 0 || raw.points.length > MAX_POINTS) {
    return `Zeichnung ${id}: 1 bis ${MAX_POINTS} Punkte erwartet.`;
  }
  const points = [];
  for (const pt of raw.points as Record<string, unknown>[]) {
    const t = Number(pt?.t);
    const p = Number(pt?.p);
    if (!Number.isFinite(t) || !Number.isFinite(p)) return `Zeichnung ${id}: ungültiger Punkt.`;
    points.push({ t, p });
  }
  const style: Record<string, unknown> = {};
  const rawStyle = raw?.style && typeof raw.style === "object" ? (raw.style as Record<string, unknown>) : {};
  for (const k of STYLE_KEYS) if (k in rawStyle) style[k] = rawStyle[k];
  if (JSON.stringify(style).length > 4096) return `Zeichnung ${id}: Stil zu gross.`;
  const visible = Array.isArray(raw?.visible_on)
    ? (raw.visible_on as unknown[]).filter((v) => typeof v === "string").slice(0, 20)
    : null;
  const updated = Number(raw?.updated_at);
  return {
    id,
    kind,
    label: typeof raw?.label === "string" ? raw.label.trim().slice(0, 120) : "",
    points,
    style,
    visible_on: visible,
    updated_at: Number.isFinite(updated) && updated > 0 ? Math.round(updated) : null,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "Nur POST erlaubt." }, 405);

  const expected = Deno.env.get("AUTARK_SYNC_SECRET") ?? "";
  if (!expected) return json({ success: false, error: "Sync serverseitig nicht konfiguriert." }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !sameSecret(provided, expected)) return json({ success: false, error: "Nicht authentifiziert." }, 401);

  let body: { symbol?: unknown; zones?: unknown; drawings?: unknown; allow_empty?: unknown; trades?: unknown; all_trade_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Ungültiges JSON." }, 400);
  }
  if (body.symbol !== "BTCUSDT") return json({ success: false, error: "Nur BTCUSDT wird übernommen." }, 400);
  if (!Array.isArray(body.zones) || body.zones.length > MAX_ZONES) {
    return json({ success: false, error: `zones muss eine Liste mit höchstens ${MAX_ZONES} Einträgen sein.` }, 400);
  }

  const zones = [];
  for (const raw of body.zones as Record<string, unknown>[]) {
    const lo = Number(raw?.lo);
    const hi = Number(raw?.hi);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
      return json({ success: false, error: "Zone mit ungültigem Bereich." }, 400);
    }
    const id = Number(raw?.id);
    zones.push({
      id: Number.isInteger(id) ? id : null,
      lo,
      hi,
      label: typeof raw?.label === "string" ? raw.label.slice(0, 120) : "",
    });
  }

  let drawings: Record<string, unknown>[] | null = null;
  const skipped: string[] = [];
  if (body.drawings !== undefined) {
    if (!Array.isArray(body.drawings) || body.drawings.length > MAX_DRAWINGS) {
      return json({ success: false, error: `drawings muss eine Liste mit höchstens ${MAX_DRAWINGS} Einträgen sein.` }, 400);
    }
    // Eine kaputte Zeichnung soll weder die Zonen noch die uebrigen
    // Zeichnungen blockieren: ueberspringen und im Ergebnis melden.
    drawings = [];
    for (const raw of body.drawings as Record<string, unknown>[]) {
      const d = cleanDrawing(raw);
      if (typeof d === "string") skipped.push(d);
      else drawings.push(d);
    }
  }

  let trades: Record<string, unknown>[] | null = null;
  if (body.trades !== undefined) {
    if (!Array.isArray(body.trades) || body.trades.length > MAX_TRADES) {
      return json({ success: false, error: `trades muss eine Liste mit höchstens ${MAX_TRADES} Einträgen sein.` }, 400);
    }
    trades = [];
    for (const raw of body.trades as Record<string, unknown>[]) {
      const t = cleanTrade(raw);
      if (typeof t === "string") skipped.push(t);
      else trades.push(t);
    }
  }
  let allTradeIds: string[] | null = null;
  if (body.all_trade_ids !== undefined) {
    if (!Array.isArray(body.all_trade_ids) || body.all_trade_ids.length > MAX_TRADE_IDS) {
      return json({ success: false, error: `all_trade_ids muss eine Liste mit höchstens ${MAX_TRADE_IDS} Einträgen sein.` }, 400);
    }
    allTradeIds = (body.all_trade_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("replace_own_zones_from_autark", {
    p_zones: zones,
    p_allow_empty: body.allow_empty === true,
  });
  if (error) return json({ success: false, error: error.message }, 500);

  let drawingCount: number | null = null;
  if (drawings !== null && (drawings.length > 0 || body.allow_empty === true)) {
    const res = await supabase.rpc("replace_autark_drawings", {
      p_drawings: drawings,
      p_allow_empty: body.allow_empty === true,
    });
    if (res.error) return json({ success: false, zones: data, error: `Zeichnungen: ${res.error.message}` }, 500);
    drawingCount = res.data as number;
  }
  let tradeResult: Record<string, unknown> | null = null;
  if (trades !== null && (trades.length > 0 || (allTradeIds !== null && allTradeIds.length > 0))) {
    const res = await supabase.rpc("upsert_autark_trades", {
      p_trades: trades,
      p_all_ids: allTradeIds && allTradeIds.length > 0 ? allTradeIds : null,
    });
    if (res.error) {
      return json({ success: false, zones: data, drawings: drawingCount, error: `Trades: ${res.error.message}` }, 500);
    }
    tradeResult = res.data as Record<string, unknown>;
  }
  return json({ success: true, zones: data, drawings: drawingCount, trades: tradeResult, skipped: skipped.slice(0, 10) }, 200);
});
