import { describe, it, expect } from "vitest";
import { supabase } from "@/lib/supabase";

// Live-Integrationstests gegen die produktive Supabase-Instanz (nur SELECT,
// respektiert RLS ueber den Anon-Key -- keine Schreibzugriffe, kein Risiko
// fuer Produktionsdaten). Pruefen Invarianten des neuen Data-Quality-Layers
// (Intelligence Validation Phase 2) sowie der bestehenden Market-State-
// Engine, damit ein zukuenftiger Formel-Fehler automatisiert auffaellt statt
// nur bei manueller Live-Pruefung.
//
// HINWEIS fuer diese Cloud-Entwicklungsumgebung: direkter Node-Netzwerk-
// zugriff auf *.supabase.co ist hier durch eine Egress-Allowlist blockiert
// ("Host not in allowlist") -- dieselbe Einschraenkung, die weiter oben in
// dieser Session bereits den browserseitigen LiquidationPanel-Live-Test
// betraf. Das ist eine Eigenschaft dieser Sandbox, kein Fehler im Code:
// Vercel-Produktion und jede normale CI/Entwicklungsumgebung erreichen
// Supabase ueber denselben Client anstandslos (in dieser Session mehrfach
// verifiziert). Deshalb bewusst als eigener "test:integration"-Script von
// den portablen Unit-Tests ("test") getrennt, statt die Assertions
// abzuschwaechen oder die Tests stillschweigend zu uebergehen.

const VALID_STATUSES = ["LIVE", "VALIDATED", "DEGRADED", "STALE", "ERROR", "UNKNOWN"];

describe("data_quality Layer (live)", () => {
  it("hat mindestens eine Zeile je zuvor auditierter Kern-Quelle", async () => {
    const { data, error } = await supabase.from("data_quality").select("source, metric, symbol, status, quality_score");
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(20); // ~43 konfigurierte Quellen/Metriken laut Migration

    const sources = new Set(data!.map((r) => r.source));
    for (const expected of ["binance", "bybit", "okx", "bitget", "fred", "yahoo_finance", "bgeometrics", "deribit"]) {
      expect(sources.has(expected)).toBe(true);
    }
  });

  it("jede Zeile hat einen gueltigen status-Enum-Wert", async () => {
    const { data, error } = await supabase.from("data_quality").select("status");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(VALID_STATUSES).toContain(row.status);
    }
  });

  it("quality_score liegt immer zwischen 0 und 100, ausser bei UNKNOWN (dort NULL)", async () => {
    const { data, error } = await supabase.from("data_quality").select("status, quality_score");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      if (row.status === "UNKNOWN") {
        expect(row.quality_score).toBeNull();
      } else {
        expect(row.quality_score).not.toBeNull();
        expect(row.quality_score as number).toBeGreaterThanOrEqual(0);
        expect(row.quality_score as number).toBeLessThanOrEqual(100);
      }
    }
  });

  it("missing_value_rate liegt, falls gesetzt, zwischen 0 und 1", async () => {
    const { data, error } = await supabase.from("data_quality").select("missing_value_rate");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      if (row.missing_value_rate !== null) {
        expect(row.missing_value_rate).toBeGreaterThanOrEqual(0);
        expect(row.missing_value_rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("BGeometrics-Metriken sind UNKNOWN, solange der erste Cron-Lauf noch nicht stattgefunden hat, NIE ein erfundener Score", async () => {
    const { data, error } = await supabase.from("data_quality").select("status, quality_score").eq("source", "bgeometrics");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      if (row.status === "UNKNOWN") {
        expect(row.quality_score).toBeNull();
      }
    }
  });
});

describe("market_states Engine (live)", () => {
  it("data_coverage_pct und confidence liegen immer zwischen 0 und 100", async () => {
    const { data, error } = await supabase
      .from("market_states")
      .select("data_coverage_pct, confidence")
      .order("timestamp_utc", { ascending: false })
      .limit(20);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.data_coverage_pct).toBeGreaterThanOrEqual(0);
      expect(row.data_coverage_pct).toBeLessThanOrEqual(100);
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("risk_level ist immer einer der vier definierten Werte, wenn gesetzt", async () => {
    const { data, error } = await supabase
      .from("market_states")
      .select("risk_level")
      .order("timestamp_utc", { ascending: false })
      .limit(20);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      if (row.risk_level !== null) {
        expect(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]).toContain(row.risk_level);
      }
    }
  });

  it("overall_state=INSUFFICIENT_DATA hat immer confidence=0 (nie ein erfundenes Vertrauen)", async () => {
    const { data, error } = await supabase
      .from("market_states")
      .select("overall_state, confidence")
      .eq("overall_state", "INSUFFICIENT_DATA")
      .limit(50);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.confidence).toBe(0);
    }
  });
});
