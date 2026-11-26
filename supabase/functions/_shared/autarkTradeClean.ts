// Journal-Trades aus AutarkTrade bereinigen (Toby 26.11.2026). Geteilt von
// der Edge Function autark-sync und den Vitest-Tests (lib/autarkTradeClean.test.ts).
// Kein Import von Deno/jsr, damit Node es laden kann.

export const MAX_TRADES = 3000;
export const MAX_TRADE_IDS = 50000;
const NUM_KEYS = [
  "entry_price", "exit_price", "quantity", "leverage", "gross_pnl", "net_pnl", "trading_fee",
  "funding_fee", "stop_loss", "mae_price", "mfe_price",
];
const JOURNAL_TEXT = [
  "note", "entry_note", "closing_note", "playbook", "closing_playbook", "timeframe", "closing_timeframe",
  "trade_type", "closing_trade_type", "feelings", "closing_feelings",
];
const JOURNAL_NUM = [
  "entry_stress", "closing_stress", "emotion", "closing_emotion", "take_profit", "planned_rrr", "margin", "position_size",
];

export function toText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/<\s*(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t ? t.slice(0, max) : null;
}

function isoFromSeconds(v: unknown): string | null {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n <= 0) return null;
  // Sekunden erwartet; Millisekunden sicherheitshalber erkennen.
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

export function cleanTrade(raw: Record<string, unknown>): Record<string, unknown> | string {
  const id = typeof raw?.trade_id === "string" ? raw.trade_id.trim() : "";
  if (!id || id.length > 120) return "Trade ohne gültige trade_id.";
  const status = raw?.status === "open" || raw?.status === "closed" ? raw.status : null;
  if (!status) return `Trade ${id}: status open/closed erwartet.`;
  const out: Record<string, unknown> = {
    trade_id: id,
    status,
    position_id: typeof raw?.position_id === "string" || typeof raw?.position_id === "number" ? String(raw.position_id).slice(0, 120) : null,
    broker: typeof raw?.broker === "string" ? raw.broker.slice(0, 40) : null,
    symbol: typeof raw?.symbol === "string" ? raw.symbol.slice(0, 40) : null,
    side: raw?.side === "long" || raw?.side === "short" ? raw.side : null,
    entry_time: isoFromSeconds(raw?.entry_time),
    exit_time: isoFromSeconds(raw?.exit_time),
    autark_updated_at: isoFromSeconds(raw?.autark_updated_at),
    strategy_followed: typeof raw?.strategy_followed === "boolean" ? raw.strategy_followed : null,
    satisfaction: typeof raw?.satisfaction === "boolean" ? raw.satisfaction : null,
  };
  for (const k of NUM_KEYS) {
    const n = raw?.[k] === null || raw?.[k] === undefined ? NaN : Number(raw[k]);
    out[k] = Number.isFinite(n) ? n : null;
  }
  for (const k of ["tags", "closing_tags"]) {
    out[k] = Array.isArray(raw?.[k])
      ? (raw[k] as unknown[]).filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim().slice(0, 80)).slice(0, 40)
      : [];
  }
  const j = raw?.journal && typeof raw.journal === "object" ? (raw.journal as Record<string, unknown>) : {};
  const journal: Record<string, unknown> = {};
  for (const k of JOURNAL_TEXT) {
    const t = toText(j[k], k === "note" || k.includes("_note") || k.includes("playbook") ? 4000 : 200);
    if (t !== null) journal[k] = t;
  }
  for (const k of JOURNAL_NUM) {
    const n = j[k] === null || j[k] === undefined ? NaN : Number(j[k]);
    if (Number.isFinite(n)) journal[k] = n;
  }
  if (Array.isArray(j.tpsl_history)) {
    const h = (j.tpsl_history as unknown[]).slice(-50);
    if (JSON.stringify(h).length <= 8000) journal.tpsl_history = h;
  }
  out.journal = journal;
  return out;
}
