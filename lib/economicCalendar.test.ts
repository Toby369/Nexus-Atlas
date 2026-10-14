import { describe, it, expect } from "vitest";
import { formatZurichTime, getHeroEconomicEventStatus, type EconomicResultFetcher } from "./economicCalendar";
import type { EconomicEventResult } from "./economicEventResult";

// Alle Termine 08:30 ET (CPI) -- bewusst weit in der Vergangenheit/Zukunft
// gewaehlt, damit die Tests nicht vom tatsaechlichen "heute" abhaengen.
const CPI_EVENT_DATE = "2026-01-14"; // Winterzeit (EST, UTC-5) -> 13:30 UTC
const CPI_MARK_MS = new Date("2026-01-14T13:30:00Z").getTime();
const HOUR = 60 * 60 * 1000;

function events() {
  return [{ event_key: "cpi", label: "Verbraucherpreisindex (CPI)", event_date: CPI_EVENT_DATE }];
}

function makeFetcher(results: EconomicEventResult[]): EconomicResultFetcher {
  return async (eventKey, eventDate) =>
    results.find((r) => r.event_key === eventKey && r.event_date === eventDate) ?? null;
}

const RESULT_ISO = "2026-01-14T13:40:00Z";
const CPI_RESULT: EconomicEventResult = {
  event_key: "cpi",
  event_date: CPI_EVENT_DATE,
  bias: "bearish",
  summary: "Inflation höher als erwartet, BTC fällt.",
  created_at: RESULT_ISO,
};

describe("getHeroEconomicEventStatus", () => {
  it("zeigt nichts, solange der Termin mehr als 2h entfernt ist", async () => {
    expect(await getHeroEconomicEventStatus(events(), makeFetcher([]), CPI_MARK_MS - 3 * HOUR)).toBeNull();
  });

  it("meldet 'upcoming' ab 2h vor dem Termin", async () => {
    const status = await getHeroEconomicEventStatus(events(), makeFetcher([]), CPI_MARK_MS - HOUR);
    expect(status?.phase).toBe("upcoming");
    expect(status?.eventKey).toBe("cpi");
    expect(status?.markMs).toBe(CPI_MARK_MS);
  });

  it("meldet 'awaiting_result', solange keine Einordnung gespeichert ist", async () => {
    const status = await getHeroEconomicEventStatus(events(), makeFetcher([]), CPI_MARK_MS + HOUR);
    expect(status?.phase).toBe("awaiting_result");
    expect(status?.result).toBeNull();
  });

  it("meldet 'result_recent' mit der Einordnung, solange die 1h-Frist laeuft", async () => {
    const nowMs = new Date(RESULT_ISO).getTime() + 30 * 60 * 1000;
    const status = await getHeroEconomicEventStatus(events(), makeFetcher([CPI_RESULT]), nowMs);
    expect(status?.phase).toBe("result_recent");
    expect(status?.result?.bias).toBe("bearish");
    expect(status?.eventDate).toBe(CPI_EVENT_DATE);
  });

  it("gibt null zurueck, wenn die 1h-Frist nach dem Ergebnis abgelaufen ist", async () => {
    const nowMs = new Date(RESULT_ISO).getTime() + 90 * 60 * 1000;
    expect(await getHeroEconomicEventStatus(events(), makeFetcher([CPI_RESULT]), nowMs)).toBeNull();
  });

  it("zeigt nach Ablauf der 1h-Frist den naechsten Termin erst wieder 2h vorher", async () => {
    const allEvents = [...events(), { event_key: "nfp", label: "Nonfarm Payrolls", event_date: "2026-02-06" }];
    const fetcher = makeFetcher([CPI_RESULT]);
    expect(await getHeroEconomicEventStatus(allEvents, fetcher, new Date(RESULT_ISO).getTime() + 2 * HOUR)).toBeNull();
    const nfpMarkMs = new Date("2026-02-06T13:30:00Z").getTime();
    const status = await getHeroEconomicEventStatus(allEvents, fetcher, nfpMarkMs - HOUR);
    expect(status?.phase).toBe("upcoming");
    expect(status?.eventKey).toBe("nfp");
  });

  it("blendet einen Termin ohne Ergebnis nach 6h aus", async () => {
    expect(await getHeroEconomicEventStatus(events(), makeFetcher([]), CPI_MARK_MS + 7 * HOUR)).toBeNull();
  });
});

describe("formatZurichTime", () => {
  it("zeigt 08:30 ET als Schweizer Zeit (Winter 14:30, Sommer 14:30)", () => {
    expect(formatZurichTime(CPI_MARK_MS)).toBe("14:30 Uhr");
    expect(formatZurichTime(new Date("2026-10-14T12:30:00Z").getTime())).toBe("14:30 Uhr");
  });
});
