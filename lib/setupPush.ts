import { classifyFlow } from "./spotPerpFlow";
import { FLAT_THRESHOLD_PCT as SPOT_FLAT_THRESHOLD_PCT } from "./spotPressure";
import { EXIT_RULE_TEXT } from "./exitRule";
import { MAX_POINTS, type SetupIdea } from "./setupEngine";
import type { SpotPressurePoint } from "./types";

// Setup-Push (Toby 23.11.2026, Ausbau A): Der Setup-Rechner laeuft alle
// 15 Min auf dem Server (POST /api/setup/push). Springt die erste Idee auf
// "steht", kommt EIN Push. Sperre: dieselbe Seite am selben Cluster
// (Bereiche ueberlappen) hoechstens alle 6 Stunden, damit es ruhig bleibt.

export const SETUP_PUSH_KIND = "setup";
export const SETUP_PUSH_LOCK_HOURS = 6;

/** Ruhezeit (Toby 26.11.2026): keine Setup-Pushes von 23:00 bis 06:00 Schweizer Zeit. */
export const QUIET_FROM_HOUR = 23;
export const QUIET_TO_HOUR = 6;

export function isQuietHour(nowMs: number): boolean {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" }).format(nowMs));
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}

/** Gleiche Texte wie components/TradingHoursBadge.tsx (dort Client-Modul). */
export const RISK_LABELS: Record<string, string> = {
  opening: "US-Kasseneröffnung",
  macro: "Wichtige Makro-Daten",
  fomc: "FOMC-Zinsentscheid",
  close: "US-Kassenschluss",
  cme: "CME-Wartungspause",
};

const fmt = (n: number) => Math.round(n).toLocaleString("de-CH");
const pct = (n: number, d = 1) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Spot-Richtung ueber die letzten 4 Stunden, wie die Lage-Zeile "Wer treibt?". */
export function spotDirection4h(points: SpotPressurePoint[], nowMs: number): "up" | "down" | "flat" | null {
  let b = 0;
  let s = 0;
  for (const p of points) {
    if (Date.parse(p.timestamp_utc) < nowMs - 4 * 3_600_000) continue;
    b += Number(p.taker_buy_vol ?? 0);
    s += Number(p.taker_sell_vol ?? 0);
  }
  return b + s > 0 ? classifyFlow(((b - s) / (b + s)) * 100, SPOT_FLAT_THRESHOLD_PCT) : null;
}

export interface SetupPushMessage {
  title: string;
  body: string;
  explanation: string;
  side: "long" | "short";
  lo: number;
  hi: number;
}

export function setupPushMessage(idea: SetupIdea | undefined): SetupPushMessage | null {
  if (!idea || idea.verdict.tone !== "trade") return null;
  const sideWord = idea.side === "long" ? "Long" : "Short";
  const { lo, hi } = idea.cluster;
  const range = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  const t = idea.targets[0];
  const half = idea.halfSize.length > 0;
  const body = [
    `Einstieg ${fmt(idea.entry)}`,
    `Stop ${fmt(idea.stop)} (−${pct(idea.stopPct, 2)} %)`,
    t ? `Ziel ${fmt(t.price)} (CRV ${pct(t.crv)})` : null,
    `${idea.leverage}x`,
    `${idea.score}/${MAX_POINTS} Belege`,
    half ? "halbe Grösse" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const yes = idea.evidence.filter((e) => e.points > 0).map((e) => e.text);
  const explanation = [
    `Der Setup-Rechner sieht an deinem Cluster ${range} (${idea.cluster.levels.map((l) => l.name).join(", ")}) ein ${sideWord}-Setup.`,
    `Belege: ${yes.join("; ")}.`,
    idea.against.length > 0 ? `Dagegen (Hintergrund): ${idea.against.join("; ")}.` : null,
    half ? `Halbe Grösse: ${idea.halfSize.join(", ")}.` : null,
    "Mit deinem Chart abgleichen, dann Einstieg nach Plan.",
    EXIT_RULE_TEXT,
  ]
    .filter(Boolean)
    .join(" ");
  return { title: `${sideWord}-Setup steht · ${range}`, body, explanation, side: idea.side, lo, hi };
}

/** Bereich und Seite aus einem frueheren Push-Titel ("Long-Setup steht · 58'960–59'531"). */
export function parseSetupTitle(title: string): { side: "long" | "short"; lo: number; hi: number } | null {
  const m = title.match(/^(Long|Short)-Setup steht · ([\d'’]+)(?:–([\d'’]+))?/);
  if (!m) return null;
  const num = (s: string) => Number(s.replace(/['’]/g, ""));
  const lo = num(m[2]);
  return { side: m[1] === "Long" ? "long" : "short", lo, hi: m[3] ? num(m[3]) : lo };
}

/** Gleiche Seite und ueberlappender Bereich (0,3 % Spiel) = schon gemeldet. */
export function alreadyPushed(msg: SetupPushMessage, recentTitles: string[]): boolean {
  return recentTitles.some((title) => {
    const p = parseSetupTitle(title);
    if (!p || p.side !== msg.side) return false;
    const tol = 0.003;
    return p.lo <= msg.hi * (1 + tol) && msg.lo <= p.hi * (1 + tol);
  });
}
