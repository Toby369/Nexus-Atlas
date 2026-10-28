// Tagesplan (Toby 28.10.2026): fester Morgen-Ablauf in fuenf Schritten,
// Ergebnis ist ein Wenn-Dann-Plan mit Alarmen. Gespeichert pro Tag in
// daily_plans (jsonb), geschrieben ueber /api/daily-plan.
//
// Zonen hier sind Bereiche mit Rolle und Notiz (Docht bis Koerper). Die
// eigenen Zonen aus own_zones (nur Preise) lassen sich uebernehmen.
// D13 gehoert seit 27.10.2026 nicht mehr zum Regelwerk und fehlt deshalb.

export type ZoneRole = "sell" | "buy";
export type Trend = "up" | "down" | "range";
export type FundingState = "base" | "high" | "neg";
export type OiMove = "up" | "flat" | "down";
export type Driver = "spot" | "perp" | "none";
export type Direction = "long" | "short";

export interface PlanZone {
  role: ZoneRole;
  lo: string;
  hi: string;
  note: string;
}

export interface Scenario {
  dir: Direction;
  /** Index in zones, als String ("" = keine gewaehlt). */
  zone: string;
  confirm: string;
  entry: string;
  stop: string;
  target: string;
  invalid: string;
}

export interface DailyPlanData {
  events: "ja" | "nein" | null;
  block: string;
  price: string;
  trend: Trend | null;
  zones: PlanZone[];
  poc: string;
  funding: FundingState | null;
  crowd: string;
  gap: string;
  oi: OiMove | null;
  driver: Driver | null;
  scens: Scenario[];
  notrade: string;
  happened: "A" | "B" | "C" | "D" | "keins" | null;
  kept: "ja" | "nein" | null;
  review: string;
}

export const MIN_CRV = 1.5;
export const MAX_ZONES = 6;
export const MAX_SCENARIOS = 4;
/** Minuten je Schritt: Termine, Tageschart, Zonen, Perp-Lage, Plan. */
export const STEP_MINUTES = [2, 5, 5, 3, 5] as const;
export const STEP_NAMES = ["Termine", "Tageschart", "Zonen", "Perp-Lage", "Plan schreiben"] as const;
/** Breite einer aus own_zones uebernommenen Zone: +-0,2 % um den Preis. */
export const OWN_ZONE_HALF_WIDTH = 0.002;

export const SCENARIO_LETTERS = "ABCD";

export function defaultConfirm(dir: Direction): string {
  return dir === "long"
    ? "1H schliesst über der Zone, 15m-Bestätigung, Verkäufe aufgefangen"
    : "1H schliesst unter der Zone, 15m-Bestätigung, Käufe aufgefangen";
}

export function newScenario(dir: Direction): Scenario {
  return { dir, zone: "", confirm: defaultConfirm(dir), entry: "", stop: "", target: "", invalid: "" };
}

/** Neuer Tag: Zonen vom Vortag uebernehmen (morgens nur pruefen, nicht neu zeichnen). */
export function emptyPlan(previousZones: PlanZone[] = []): DailyPlanData {
  return {
    events: null,
    block: "",
    price: "",
    trend: null,
    zones: previousZones.length
      ? previousZones.map((z) => ({ ...z }))
      : [
          { role: "sell", lo: "", hi: "", note: "" },
          { role: "buy", lo: "", hi: "", note: "" },
        ],
    poc: "",
    funding: null,
    crowd: "",
    gap: "",
    oi: null,
    driver: null,
    scens: [newScenario("long"), newScenario("short")],
    notrade: "",
    happened: null,
    kept: null,
    review: "",
  };
}

export function num(v: string | null | undefined): number | null {
  const n = parseFloat(String(v ?? "").replace(/'/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const fmt = (n: number | null, d = 0) =>
  n === null || !Number.isFinite(n) ? "—" : n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

export interface ResolvedZone {
  index: number;
  role: ZoneRole;
  lo: number;
  hi: number;
  note: string;
}

export function resolvedZones(plan: DailyPlanData): ResolvedZone[] {
  return plan.zones
    .map((z, index) => ({ index, role: z.role, a: num(z.lo), b: num(z.hi), note: z.note }))
    .filter((z): z is typeof z & { a: number; b: number } => z.a !== null && z.b !== null)
    .map((z) => ({ index: z.index, role: z.role, lo: Math.min(z.a, z.b), hi: Math.max(z.a, z.b), note: z.note }))
    .sort((x, y) => y.hi - x.hi);
}

export function zoneLabel(z: ResolvedZone): string {
  return `${z.role === "sell" ? "Verkäufer" : "Käufer"} ${fmt(z.lo)}–${fmt(z.hi)}${z.note ? ` (${z.note})` : ""}`;
}

export function nearestPlanZones(plan: DailyPlanData): {
  above: ResolvedZone | null;
  below: ResolvedZone | null;
  inside: ResolvedZone | null;
} {
  const p = num(plan.price);
  const zs = resolvedZones(plan);
  if (p === null) return { above: null, below: null, inside: null };
  return {
    above: zs.filter((z) => z.lo > p).sort((a, b) => a.lo - b.lo)[0] ?? null,
    below: zs.filter((z) => z.hi < p).sort((a, b) => b.hi - a.hi)[0] ?? null,
    inside: zs.find((z) => z.lo <= p && p <= z.hi) ?? null,
  };
}

/** Eigene Zonen (nur Preise) als Bereiche; Rolle nach Lage zum Kurs (Rollentausch). */
export function zonesFromOwn(prices: number[], price: number | null): PlanZone[] {
  return [...prices]
    .sort((a, b) => b - a)
    .map((p) => ({
      role: price !== null && p < price ? "buy" : "sell",
      lo: String(Math.round(p * (1 - OWN_ZONE_HALF_WIDTH))),
      hi: String(Math.round(p * (1 + OWN_ZONE_HALF_WIDTH))),
      note: "eigene Zone",
    }));
}

const TREND_TEXT: Record<Trend, string> = {
  up: "Aufwärts (höhere Hochs und Tiefs)",
  down: "Abwärts (tiefere Hochs und Tiefs)",
  range: "Seitwärts (Range)",
};

export function trendText(plan: DailyPlanData): string {
  return plan.trend ? TREND_TEXT[plan.trend] : "—";
}

export interface PerpVerdict {
  text: string;
  reasons: string[];
}

/** Rueckenwind aus Funding, Positionierung, OI und Treiber (Schwellen wie lib/positioning, lib/fundingLevels). */
export function perpVerdict(plan: DailyPlanData): PerpVerdict {
  const reasons: string[] = [];
  let longCrowded = 0;
  let shortCrowded = 0;
  if (plan.funding === "high") {
    longCrowded++;
    reasons.push("Funding über 0,01 %: Longs zahlen mehr");
  }
  if (plan.funding === "neg") {
    shortCrowded++;
    reasons.push("Funding negativ: Shorts zahlen");
  }
  const crowd = num(plan.crowd);
  const gap = num(plan.gap);
  if (crowd !== null && crowd >= 65) {
    longCrowded++;
    reasons.push(`Masse ${fmt(crowd)} % long: viele kleine Longs`);
  }
  if (crowd !== null && crowd < 50) {
    shortCrowded++;
    reasons.push(`Masse nur ${fmt(crowd)} % long: Short-lastig`);
  }
  if (gap !== null && gap <= 0) {
    longCrowded++;
    reasons.push("Top-Trader nicht longer als die Masse");
  }
  if (plan.driver === "perp" && plan.oi === "up") reasons.push("Bewegung von Hebel getragen, OI steigt: fragil");
  if (plan.driver === "spot") reasons.push("Bewegung von Spot getragen: belastbarer");
  let text = "Kein Rückenwind für eine Seite";
  if (shortCrowded > longCrowded) text = "Rückenwind für Long (Short-Seite überfüllt)";
  if (longCrowded > shortCrowded) text = "Vorsicht bei Long (Long-Seite überfüllt)";
  return { text, reasons };
}

export interface ScenarioCheck {
  ready: boolean;
  risk: number | null;
  reward: number | null;
  crv: number | null;
  onPlan: boolean;
  zone: ResolvedZone | null;
  problems: { text: string; blocking: boolean }[];
}

export function checkScenario(plan: DailyPlanData, sc: Scenario): ScenarioCheck {
  const zs = resolvedZones(plan);
  const zone = zs.find((z) => String(z.index) === sc.zone) ?? null;
  const e = num(sc.entry);
  const s = num(sc.stop);
  const t = num(sc.target);
  if (e === null || s === null || t === null) {
    return { ready: false, risk: null, reward: null, crv: null, onPlan: false, zone, problems: [] };
  }
  const dir = sc.dir === "long" ? 1 : -1;
  const risk = (e - s) * dir;
  const reward = (t - e) * dir;
  const crv = risk > 0 ? reward / risk : null;
  const problems: ScenarioCheck["problems"] = [];
  if (risk <= 0) problems.push({ text: `Stop liegt auf der falschen Seite (muss ${sc.dir === "long" ? "unter" : "über"} dem Einstieg sein).`, blocking: true });
  if (reward <= 0) problems.push({ text: `Ziel liegt auf der falschen Seite (muss ${sc.dir === "long" ? "über" : "unter"} dem Einstieg sein).`, blocking: true });
  if (zone) {
    const against = (sc.dir === "long" && zone.role === "sell") || (sc.dir === "short" && zone.role === "buy");
    if (against && !/ausbruch|körper|retest/i.test(sc.confirm)) {
      problems.push({
        text: `${sc.dir === "long" ? "Long an einer Verkäufer-Zone" : "Short an einer Käufer-Zone"}: nur als Ausbruch mit 4H-Körper und Retest.`,
        blocking: false,
      });
    }
    if (sc.dir === "long" && s >= zone.lo) problems.push({ text: "Stop liegt nicht unter der Zone.", blocking: false });
    if (sc.dir === "short" && s <= zone.hi) problems.push({ text: "Stop liegt nicht über der Zone.", blocking: false });
  }
  if (plan.trend === "down" && sc.dir === "long") problems.push({ text: "Long gegen den Tages-Abwärtstrend.", blocking: false });
  if (plan.trend === "up" && sc.dir === "short") problems.push({ text: "Short gegen den Tages-Aufwärtstrend.", blocking: false });
  const blocker = zs.find((z) =>
    sc.dir === "long" ? z.role === "sell" && z.lo > e && z.lo < t : z.role === "buy" && z.hi < e && z.hi > t
  );
  if (blocker) problems.push({ text: `Zwischen Einstieg und Ziel liegt ${zoneLabel(blocker)}. Ziel davor setzen.`, blocking: false });
  const onPlan = crv !== null && crv >= MIN_CRV && risk > 0 && reward > 0;
  return { ready: true, risk, reward, crv, onPlan, zone, problems };
}

export function alarmPrices(plan: DailyPlanData): number[] {
  const out = new Set<number>();
  const { above, below } = nearestPlanZones(plan);
  if (above) out.add(above.lo);
  if (below) out.add(below.hi);
  for (const sc of plan.scens) {
    const c = checkScenario(plan, sc);
    if (c.onPlan && c.zone) out.add(sc.dir === "long" ? c.zone.hi : c.zone.lo);
  }
  return [...out].sort((a, b) => b - a);
}

export function noTradeSuggestion(plan: DailyPlanData): string {
  const { above, below, inside } = nearestPlanZones(plan);
  if (inside) return `Preis steht in der Zone ${fmt(inside.lo)}–${fmt(inside.hi)}: nur mit Bestätigung handeln`;
  if (above && below) return `zwischen ${fmt(below.hi)} und ${fmt(above.lo)}`;
  return "";
}

export function planText(dateIso: string, plan: DailyPlanData): string {
  const lines: string[] = [];
  lines.push(`TAGESPLAN ${dateIso.split("-").reverse().join(".")}`, "");
  lines.push(`Termine:    ${plan.events === "ja" ? `Sperrzeit ${plan.block || "(eintragen)"}` : plan.events === "nein" ? "keine" : "—"}`);
  lines.push(`Tageschart: ${trendText(plan)}`);
  lines.push(`Perp-Lage:  ${perpVerdict(plan).text}`);
  lines.push(`Preis:      ${fmt(num(plan.price))}`, "");
  lines.push("ZONEN");
  for (const z of resolvedZones(plan)) lines.push(`  ${z.role === "sell" ? "▼" : "▲"} ${zoneLabel(z)}`);
  lines.push("");
  plan.scens.forEach((sc, i) => {
    const c = checkScenario(plan, sc);
    const tag = !c.ready ? "unvollständig" : c.onPlan ? `CRV ${fmt(c.crv, 1)}` : `CRV ${fmt(c.crv, 1)} → NICHT HANDELN`;
    lines.push(`${SCENARIO_LETTERS[i]} ${sc.dir === "long" ? "LONG" : "SHORT"} [${tag}]`);
    lines.push(`  WENN Preis an ${c.zone ? zoneLabel(c.zone) : "(Zone wählen)"}`);
    lines.push(`  UND  ${sc.confirm || "(Bestätigung)"}`);
    lines.push(`  DANN Einstieg ${fmt(num(sc.entry))}  Stop ${fmt(num(sc.stop))}  Ziel ${fmt(num(sc.target))}`);
    if (sc.invalid) lines.push(`  UNGÜLTIG wenn ${sc.invalid}`);
    lines.push("");
  });
  lines.push(`KEIN TRADE: ${plan.notrade || noTradeSuggestion(plan) || "(eintragen)"}`);
  const al = alarmPrices(plan);
  lines.push(`ALARME:     ${al.length ? al.map((a) => fmt(a)).join(" / ") : "(Zonen eintragen)"}`);
  if (plan.happened || plan.kept || plan.review) {
    lines.push("", `ABENDS: eingetreten ${plan.happened ?? "—"}, Plan eingehalten ${plan.kept ?? "—"}`);
    if (plan.review) lines.push(`  ${plan.review}`);
  }
  return lines.join("\n");
}

/** Welcher Schritt laut 20-Minuten-Ablauf gerade dran ist (null = fertig). */
export function currentStep(elapsedMinutes: number): { index: number; leftMinutes: number } | null {
  let end = 0;
  for (let i = 0; i < STEP_MINUTES.length; i++) {
    end += STEP_MINUTES[i];
    if (elapsedMinutes < end) return { index: i, leftMinutes: end - elapsedMinutes };
  }
  return null;
}

/** Defensive Uebernahme gespeicherter Daten (aeltere Plaene, fehlende Felder). */
export function normalizePlan(raw: unknown): DailyPlanData {
  const base = emptyPlan();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<DailyPlanData>;
  return {
    ...base,
    ...r,
    zones: Array.isArray(r.zones) ? r.zones.slice(0, MAX_ZONES) : base.zones,
    scens: Array.isArray(r.scens) ? r.scens.slice(0, MAX_SCENARIOS) : base.scens,
  };
}
