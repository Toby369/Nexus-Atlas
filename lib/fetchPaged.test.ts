import { describe, expect, it } from "vitest";
import { fetchPaged } from "./fetchPaged";

// Simuliert eine Tabelle mit `total` Zeilen hinter einem 1000er-Deckel.
function table(total: number, cap = 1000) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, total - 1, from + cap - 1);
    const data = end < from ? [] : Array.from({ length: end - from + 1 }, (_, i) => from + i);
    return { data, error: null };
  };
  return { fetchPage, calls };
}

describe("fetchPaged", () => {
  it("laedt ueber den 1000-Zeilen-Deckel hinaus alle Zeilen in Reihenfolge", async () => {
    const { fetchPage, calls } = table(2880);
    const { rows, error } = await fetchPaged(fetchPage, 3080);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2880);
    expect(rows[2879]).toBe(2879);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stoppt bei maxRows", async () => {
    const { fetchPage } = table(5000);
    const { rows } = await fetchPaged(fetchPage, 1500);
    expect(rows).toHaveLength(1500);
  });

  it("gibt bei einem Fehler das bisher Geladene zurueck", async () => {
    let n = 0;
    const { rows, error } = await fetchPaged(async (from, to) => {
      n++;
      if (n === 2) return { data: null, error: { message: "boom" } };
      return { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null };
    }, 3000);
    expect(error).toBe("boom");
    expect(rows).toHaveLength(1000);
  });
});
