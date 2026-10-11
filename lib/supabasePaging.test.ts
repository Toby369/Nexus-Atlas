import { describe, expect, it } from "vitest";
import { fetchAllPages } from "./supabasePaging";

// Simuliert eine Tabelle mit `total` Zeilen hinter einem 1000-Zeilen-Deckel.
function fakeTable(total: number, cap = 1000) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, total, from + cap);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { fetchPage, calls };
}

describe("fetchAllPages", () => {
  it("laedt ueber den 1000er-Deckel hinaus bis zur juengsten Zeile", async () => {
    const { fetchPage, calls } = fakeTable(2880);
    const { rows, error } = await fetchAllPages(fetchPage, 3080);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2880);
    expect(rows[rows.length - 1]).toBe(2879);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("respektiert maxRows", async () => {
    const { fetchPage } = fakeTable(5000);
    const { rows } = await fetchAllPages(fetchPage, 1500);
    expect(rows).toHaveLength(1500);
  });

  it("gibt bei Fehler die bisherigen Zeilen und die Meldung zurueck", async () => {
    let n = 0;
    const { rows, error } = await fetchAllPages(async () => {
      n++;
      return n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { message: "timeout" } };
    }, 3000);
    expect(rows).toHaveLength(1000);
    expect(error).toBe("timeout");
  });
});
