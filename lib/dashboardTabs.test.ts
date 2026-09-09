import { describe, expect, it } from "vitest";
import { DASHBOARD_TABS, DEFAULT_DASHBOARD_TAB, assertAllTilesAssigned } from "./dashboardTabs";
import { DASHBOARD_TILE_IDS } from "./dashboardTiles";

describe("DASHBOARD_TABS", () => {
  it("weist jede registrierte Kachel genau einem Tab zu (keine verlorene/doppelte Kachel)", () => {
    expect(() => assertAllTilesAssigned()).not.toThrow();

    const allTileIds = DASHBOARD_TABS.flatMap((tab) => tab.tileIds);
    expect(new Set(allTileIds).size).toBe(allTileIds.length);
    expect(new Set(allTileIds)).toEqual(new Set(DASHBOARD_TILE_IDS));
  });

  it("hat eindeutige Tab-IDs", () => {
    const ids = DASHBOARD_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DEFAULT_DASHBOARD_TAB ist ein tatsaechlich existierender Tab", () => {
    expect(DASHBOARD_TABS.some((tab) => tab.id === DEFAULT_DASHBOARD_TAB)).toBe(true);
  });
});
