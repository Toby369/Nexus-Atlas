import { describe, expect, it } from "vitest";
import { visibleOrder, reorderWithinSubset, swapWithinSubset } from "./dashboardTabReorder";

const FULL_ORDER = ["a", "b", "c", "d", "e", "f"];
const TAB_TILES = ["a", "c", "e"]; // b, d, f gehoeren einem anderen Tab

describe("visibleOrder", () => {
  it("filtert auf die Teilmenge, behaelt die relative Reihenfolge", () => {
    expect(visibleOrder(FULL_ORDER, TAB_TILES)).toEqual(["a", "c", "e"]);
  });
});

describe("reorderWithinSubset", () => {
  it("verschiebt innerhalb der Teilmenge, laesst fremde Tiles unangetastet", () => {
    // a vor e ziehen -> Reihenfolge innerhalb des Tabs wird c, e, a
    const result = reorderWithinSubset(FULL_ORDER, TAB_TILES, "a", "e");
    // a landet an der letzten Position der Teilmenge (dort wo e stand),
    // c und e ruecken je einen Platz nach vorne -- b/d/f bleiben exakt an
    // ihren urspruenglichen Positionen im vollen Array.
    expect(visibleOrder(result, TAB_TILES)).toEqual(["c", "e", "a"]);
    expect(result.filter((id) => !TAB_TILES.includes(id))).toEqual(["b", "d", "f"]);
    expect(result.indexOf("b")).toBe(FULL_ORDER.indexOf("b"));
    expect(result.indexOf("d")).toBe(FULL_ORDER.indexOf("d"));
    expect(result.indexOf("f")).toBe(FULL_ORDER.indexOf("f"));
  });

  it("gibt das Original unveraendert zurueck, wenn eine ID nicht in der Teilmenge ist", () => {
    expect(reorderWithinSubset(FULL_ORDER, TAB_TILES, "a", "b")).toBe(FULL_ORDER);
  });

  it("gibt das Original unveraendert zurueck bei identischer active/over-ID", () => {
    expect(reorderWithinSubset(FULL_ORDER, TAB_TILES, "a", "a")).toBe(FULL_ORDER);
  });
});

describe("swapWithinSubset", () => {
  it("tauscht mit dem naechsten sichtbaren Nachbarn, nicht dem naechsten im vollen Array", () => {
    // "a" nach unten (direction +1): naechster sichtbarer Nachbar ist "c"
    // (nicht "b", das gehoert einem anderen Tab).
    const result = swapWithinSubset(FULL_ORDER, TAB_TILES, "a", 1);
    expect(visibleOrder(result, TAB_TILES)).toEqual(["c", "a", "e"]);
    expect(result.indexOf("b")).toBe(FULL_ORDER.indexOf("b"));
  });

  it("bleibt unveraendert am oberen/unteren Rand der Teilmenge", () => {
    expect(swapWithinSubset(FULL_ORDER, TAB_TILES, "a", -1)).toBe(FULL_ORDER);
    expect(swapWithinSubset(FULL_ORDER, TAB_TILES, "e", 1)).toBe(FULL_ORDER);
  });
});
