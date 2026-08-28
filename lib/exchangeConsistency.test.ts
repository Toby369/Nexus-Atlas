import { describe, it, expect } from "vitest";
import { isExchangeSetConsistentOverWindow } from "./exchangeConsistency";

describe("isExchangeSetConsistentOverWindow", () => {
  const windowStartMs = new Date("2026-06-01T00:00:00Z").getTime();

  it("true, wenn alle Boersen vor Fensterstart existierten", () => {
    const firstSeen = [
      { exchange: "bybit", first_seen: "2025-01-01T00:00:00Z" },
      { exchange: "binance", first_seen: "2025-01-01T00:00:00Z" },
      { exchange: "okx", first_seen: "2025-06-01T00:00:00Z" },
    ];
    expect(
      isExchangeSetConsistentOverWindow(firstSeen, ["bybit", "binance", "okx"], windowStartMs)
    ).toBe(true);
  });

  it("false, wenn eine Boerse erst innerhalb des Fensters dazukam", () => {
    const firstSeen = [
      { exchange: "bybit", first_seen: "2025-01-01T00:00:00Z" },
      { exchange: "binance", first_seen: "2025-01-01T00:00:00Z" },
      { exchange: "okx", first_seen: "2026-06-15T00:00:00Z" }, // nach Fensterstart
    ];
    expect(
      isExchangeSetConsistentOverWindow(firstSeen, ["bybit", "binance", "okx"], windowStartMs)
    ).toBe(false);
  });

  it("false, wenn zu einer Boerse noch gar keine Daten vorliegen", () => {
    const firstSeen = [{ exchange: "bybit", first_seen: "2025-01-01T00:00:00Z" }];
    expect(
      isExchangeSetConsistentOverWindow(firstSeen, ["bybit", "binance"], windowStartMs)
    ).toBe(false);
  });

  it("true bei einer Boerse, deren erste Meldung exakt dem Fensterstart entspricht", () => {
    const firstSeen = [{ exchange: "bybit", first_seen: new Date(windowStartMs).toISOString() }];
    expect(isExchangeSetConsistentOverWindow(firstSeen, ["bybit"], windowStartMs)).toBe(true);
  });
});
