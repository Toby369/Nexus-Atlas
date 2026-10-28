import { describe, expect, it } from "vitest";
import {
  alarmPrices,
  checkScenario,
  currentStep,
  emptyPlan,
  nearestPlanZones,
  noTradeSuggestion,
  normalizePlan,
  perpVerdict,
  planText,
  scenariosForAlarm,
  zonesFromOwn,
  type DailyPlanData,
} from "./dailyPlan";

// Tagesplan vom 28.10.2026: Range 79'200-81'300, Preis 81'050.
function example(): DailyPlanData {
  return {
    ...emptyPlan(),
    events: "nein",
    price: "81050",
    trend: "range",
    zones: [
      { role: "sell", lo: "84400", hi: "84900", note: "Abweisung 21.10." },
      { role: "sell", lo: "81800", hi: "82050", note: "4H-Zone 23.10." },
      { role: "sell", lo: "81000", hi: "81300", note: "Range-Oberkante" },
      { role: "buy", lo: "79200", hi: "79600", note: "Range-Unterkante" },
    ],
    scens: [
      { dir: "short", zone: "2", confirm: "1H schliesst wieder unter 81'000", entry: "80950", stop: "81550", target: "79800", invalid: "4H-Schluss über 81'300" },
      { dir: "long", zone: "3", confirm: "Verkäufe aufgefangen, 1H-Schluss darüber", entry: "79650", stop: "78950", target: "80900", invalid: "" },
      { dir: "long", zone: "2", confirm: "4H-Körper über 81'300, Retest", entry: "81400", stop: "80900", target: "81800", invalid: "" },
    ],
  };
}

describe("checkScenario", () => {
  const plan = example();

  it("Short an der Range-Oberkante: CRV 1,9, auf dem Plan", () => {
    const c = checkScenario(plan, plan.scens[0]);
    expect(c.crv).toBeCloseTo(1150 / 600);
    expect(c.onPlan).toBe(true);
    expect(c.problems.filter((p) => p.blocking)).toHaveLength(0);
  });

  it("Ausbruchs-Long mit nahem Ziel: CRV 0,8, nicht auf dem Plan", () => {
    const c = checkScenario(plan, plan.scens[2]);
    expect(c.crv).toBeCloseTo(0.8);
    expect(c.onPlan).toBe(false);
  });

  it("warnt, wenn eine Gegen-Zone zwischen Einstieg und Ziel liegt", () => {
    const c = checkScenario(plan, { ...plan.scens[1], target: "82500" });
    expect(c.problems.some((p) => p.text.includes("Zwischen Einstieg und Ziel"))).toBe(true);
  });

  it("Stop auf der falschen Seite blockiert", () => {
    const c = checkScenario(plan, { ...plan.scens[1], stop: "80000" });
    expect(c.onPlan).toBe(false);
    expect(c.problems.some((p) => p.blocking)).toBe(true);
  });

  it("unvollstaendig ohne Ziel", () => {
    expect(checkScenario(plan, { ...plan.scens[0], target: "" }).ready).toBe(false);
  });
});

describe("Zonen, Alarme, Kein-Trade-Bereich", () => {
  const plan = example();

  it("naechste Zone oben und unten; Preis in der Oberkante", () => {
    const n = nearestPlanZones(plan);
    expect(n.inside?.lo).toBe(81000);
    expect(n.above?.lo).toBe(81800);
    expect(n.below?.hi).toBe(79600);
  });

  it("Kein-Trade-Vorschlag bei Preis in einer Zone", () => {
    expect(noTradeSuggestion(plan)).toContain("nur mit Bestätigung");
    expect(noTradeSuggestion({ ...plan, price: "80300" })).toMatch(/zwischen 79.600 und 81.000/);
  });

  it("Alarme: Zonenkanten und Zonen der gueltigen Szenarien", () => {
    expect(alarmPrices(plan)).toEqual([81800, 81000, 79600]);
  });
});

describe("perpVerdict", () => {
  it("Masse stark long und Top-Trader dagegen -> Vorsicht bei Long", () => {
    const v = perpVerdict({ ...emptyPlan(), crowd: "69", gap: "-3", funding: "base" });
    expect(v.text).toContain("Vorsicht bei Long");
    expect(v.reasons).toHaveLength(2);
  });
  it("negatives Funding und Short-lastige Masse -> Rueckenwind Long", () => {
    expect(perpVerdict({ ...emptyPlan(), crowd: "45", funding: "neg" }).text).toContain("Rückenwind für Long");
  });
});

describe("Hilfen", () => {
  it("eigene Zonen werden zu Bereichen mit Rolle nach Lage zum Kurs", () => {
    const z = zonesFromOwn(
      [
        { price: 79500, lo: null, hi: null, label: null, source: "manual" },
        { price: 82000, lo: null, hi: null, label: null, source: "manual" },
      ],
      81000
    );
    expect(z[0]).toMatchObject({ role: "sell", lo: "81836", hi: "82164", note: "eigene Zone" });
    expect(z[1].role).toBe("buy");
  });

  it("Zonen aus AutarkTrade behalten Bereich und Namen", () => {
    const z = zonesFromOwn([{ price: 81150, lo: 81000, hi: 81300, label: "Range-Oberkante", source: "autark" }], 80500);
    expect(z[0]).toEqual({ role: "sell", lo: "81000", hi: "81300", note: "Range-Oberkante" });
    const unnamed = zonesFromOwn([{ price: 79400, lo: 79200, hi: 79600, label: null, source: "autark" }], 80500);
    expect(unnamed[0]).toMatchObject({ role: "buy", note: "aus AutarkTrade" });
  });

  it("20-Minuten-Ablauf: Schritt nach Zeit", () => {
    expect(currentStep(0)?.index).toBe(0);
    expect(currentStep(3)?.index).toBe(1);
    expect(currentStep(12.5)?.index).toBe(3);
    expect(currentStep(20)).toBeNull();
  });

  it("neuer Tag uebernimmt die Zonen vom Vortag", () => {
    const prev = example().zones;
    expect(emptyPlan(prev).zones).toEqual(prev);
    expect(emptyPlan(prev).scens).toHaveLength(2);
  });

  it("normalizePlan fuellt fehlende Felder", () => {
    const p = normalizePlan({ price: "80000" });
    expect(p.price).toBe("80000");
    expect(p.scens).toHaveLength(2);
    expect(normalizePlan(null).zones).toHaveLength(2);
  });

  it("Plan-Text enthaelt Szenarien, Kein-Trade und Alarme", () => {
    const t = planText("2026-10-28", example());
    expect(t).toContain("TAGESPLAN 28.10.2026");
    expect(t).toMatch(/C LONG \[CRV 0[.,]8 → NICHT HANDELN\]/);
    expect(t).toContain("KEIN TRADE:");
    expect(t).toMatch(/ALARME: +81.800 \/ 81.000 \/ 79.600/);
  });
});

describe("scenariosForAlarm", () => {
  const plan = example();
  it("Alarm an der Range-Oberkante betrifft Szenario A (Short), nicht C (CRV zu klein)", () => {
    expect(scenariosForAlarm(plan, 81_300)).toEqual(["A"]);
  });
  it("Alarm an der Unterkante betrifft B, in der Mitte keines", () => {
    expect(scenariosForAlarm(plan, 79_550)).toEqual(["B"]);
    expect(scenariosForAlarm(plan, 80_300)).toEqual([]);
    expect(scenariosForAlarm(plan, null)).toEqual([]);
  });
});
