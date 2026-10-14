import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { headlinesReady, matchResultHeadlines, resultBiasDisplay } from "./economicEventResult";

const MARK_MS = new Date("2026-10-14T12:30:00Z").getTime();

function headline(iso: string, title: string, title_de: string | null = null) {
  return { published_at: iso, title, title_de };
}

describe("matchResultHeadlines", () => {
  it("nimmt nur passende Schlagzeilen ab dem Termin, aelteste zuerst", () => {
    const news = [
      headline("2026-10-14T12:42:00Z", "US-Inflation steigt stärker als erwartet"),
      headline("2026-10-14T12:20:00Z", "CPI preview: what to expect"), // vor dem Termin
      headline("2026-10-14T12:33:00Z", "September CPI comes in hot, bitcoin slides"),
      headline("2026-10-14T12:35:00Z", "Spot bitcoin ETF inflows continue"), // passt nicht
    ];
    const matched = matchResultHeadlines("cpi", news, MARK_MS);
    expect(matched.map((h) => h.published_at)).toEqual(["2026-10-14T12:33:00Z", "2026-10-14T12:42:00Z"]);
  });

  it("prueft auch den deutschen Titel", () => {
    const news = [headline("2026-10-14T12:40:00Z", "Bitcoin drops", "Verbraucherpreise steigen stärker")];
    expect(matchResultHeadlines("cpi", news, MARK_MS)).toHaveLength(1);
  });

  it("liefert nichts fuer unbekannte Termine", () => {
    expect(matchResultHeadlines("gdp", [headline("2026-10-14T12:40:00Z", "GDP")], MARK_MS)).toEqual([]);
  });
});

describe("headlinesReady", () => {
  const now = new Date("2026-10-14T12:40:00Z").getTime();
  it("braucht zwei Schlagzeilen oder eine, die 10 Min alt ist", () => {
    expect(headlinesReady([], now)).toBe(false);
    expect(headlinesReady([headline("2026-10-14T12:35:00Z", "CPI hot")], now)).toBe(false);
    expect(headlinesReady([headline("2026-10-14T12:29:00Z", "CPI hot")], now)).toBe(true);
    expect(headlinesReady([headline("2026-10-14T12:35:00Z", "a"), headline("2026-10-14T12:38:00Z", "b")], now)).toBe(true);
  });
});

describe("resultBiasDisplay", () => {
  it("uebersetzt bias in Emoji, Wort und Farbe", () => {
    expect(resultBiasDisplay("bearish")).toEqual({ emoji: "🔴", label: "bärisch", colorClass: "text-down" });
    expect(resultBiasDisplay("bullish").label).toBe("bullisch");
  });
});
