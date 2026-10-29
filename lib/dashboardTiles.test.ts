import { describe, it, expect } from "vitest";
import { DASHBOARD_TILES, DASHBOARD_TILE_IDS } from "./dashboardTiles";
import { DATA_SOURCE_KEYS } from "./dataFreshness";

// Strukturelle Regressionstests: DashboardLayout.tsx verlaesst sich darauf,
// dass jede Kachel-ID eindeutig ist und DASHBOARD_TILE_IDS exakt aus
// DASHBOARD_TILES abgeleitet ist -- ein Tippfehler bei einer doppelten ID
// wuerde sonst erst zur Laufzeit (falsches Drag&Drop-Verhalten) auffallen.

describe("dashboardTiles registry", () => {
  it("hat fuer jede Kachel eine eindeutige id", () => {
    const ids = DASHBOARD_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DASHBOARD_TILE_IDS entspricht exakt den ids in DASHBOARD_TILES, in derselben Reihenfolge", () => {
    expect(DASHBOARD_TILE_IDS).toEqual(DASHBOARD_TILES.map((t) => t.id));
  });

  it("jede Kachel hat einen nicht-leeren Titel", () => {
    for (const tile of DASHBOARD_TILES) {
      expect(tile.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("dashboardTiles quellen", () => {
  it("nennt nur Datenquellen, die lib/dataFreshness.ts kennt", () => {
    for (const tile of DASHBOARD_TILES) {
      for (const key of tile.quellen ?? []) {
        expect(DATA_SOURCE_KEYS, `${tile.id}: ${key}`).toContain(key);
      }
    }
  });
});

describe("dashboardTiles herkunft", () => {
  it("jede Kachel ausser Lernen nennt ihre Herkunft", () => {
    for (const tile of DASHBOARD_TILES) {
      if (tile.id === "lernen") continue;
      expect(tile.herkunft.length, tile.id).toBeGreaterThan(0);
    }
  });

  it("KI-Kacheln sind als KI gekennzeichnet", () => {
    for (const tile of DASHBOARD_TILES.filter((t) => t.title.includes("(KI)"))) {
      expect(tile.herkunft.some((q) => q.art === "ki"), tile.id).toBe(true);
    }
  });
});
