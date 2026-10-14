import { describe, it, expect } from "vitest";
import { formatZurichTime, getHeroEconomicEventStatus, type MacroSnapshotFetcher } from "./economicCalendar";

// Alle Termine 08:30 ET (CPI) -- an einem Tag ohne DST-Besonderheit
// bewusst weit in der Vergangenheit/Zukunft gewaehlt, damit die Tests nicht
// vom tatsaechlichen "heute" abhaengen.
const CPI_EVENT_DATE = "2026-01-14"; // Winterzeit (EST, UTC-5) -> 13:30 UTC
const CPI_MARK_MS = new Date("2026-01-14T13:30:00Z").getTime();

function events() {
  return [{ event_key: "cpi", label: "Verbraucherpreisindex (CPI)", event_date: CPI_EVENT_DATE }];
}

function makeFetcher(rows: { last_price: number | null; timestamp_utc: string }[]): MacroSnapshotFetcher {
  return async (_symbol, bound, limit, order) => {
    let filtered =
      "beforeIso" in bound
        ? rows.filter((r) => r.timestamp_utc < bound.beforeIso)
        : rows.filter((r) => r.timestamp_utc >= bound.fromIso);
    filtered = filtered.slice().sort((a, b) => (order === "asc" ? 1 : -1) * (a.timestamp_utc < b.timestamp_utc ? -1 : 1));
    return filtered.slice(0, limit);
  };
}

describe("getHeroEconomicEventStatus", () => {
  it("zeigt nichts, solange der Termin mehr als 2h entfernt ist", async () => {
    const fetcher = makeFetcher([{ last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" }]);
    const status = await getHeroEconomicEventStatus(events(), fetcher, CPI_MARK_MS - 3 * 60 * 60 * 1000);
    expect(status).toBeNull();
  });

  it("meldet 'upcoming' ab 2h vor dem Termin", async () => {
    const fetcher = makeFetcher([{ last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" }]);
    const status = await getHeroEconomicEventStatus(events(), fetcher, CPI_MARK_MS - 60 * 60 * 1000);
    expect(status?.phase).toBe("upcoming");
    expect(status?.eventKey).toBe("cpi");
    expect(status?.markMs).toBe(CPI_MARK_MS);
  });

  it("meldet 'awaiting_result', wenn der Termin da ist, aber macro_snapshots noch den alten Wert zeigt", async () => {
    const fetcher = makeFetcher([
      { last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" },
      { last_price: 310, timestamp_utc: "2026-01-14T14:00:00Z" }, // nach dem Termin, aber unveraendert
    ]);
    const status = await getHeroEconomicEventStatus(events(), fetcher, CPI_MARK_MS + 60 * 60 * 1000);
    expect(status?.phase).toBe("awaiting_result");
    expect(status?.baselineValue).toBe(310);
    expect(status?.actualValue).toBeNull();
  });

  it("meldet 'result_recent' mit Wert + Vorwert, solange die 1h-Frist nicht abgelaufen ist", async () => {
    const resultIso = "2026-01-14T14:00:00Z";
    const fetcher = makeFetcher([
      { last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" },
      { last_price: 312.5, timestamp_utc: resultIso },
    ]);
    const nowMs = new Date(resultIso).getTime() + 30 * 60 * 1000; // 30 Min nach dem Resultat
    const status = await getHeroEconomicEventStatus(events(), fetcher, nowMs);
    expect(status?.phase).toBe("result_recent");
    expect(status?.actualValue).toBe(312.5);
    expect(status?.baselineValue).toBe(310);
    expect(status?.resultDetectedAtMs).toBe(new Date(resultIso).getTime());
  });

  it("gibt null zurueck, wenn die 1h-Frist nach dem Resultat abgelaufen ist und kein weiterer Termin folgt", async () => {
    const resultIso = "2026-01-14T14:00:00Z";
    const fetcher = makeFetcher([
      { last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" },
      { last_price: 312.5, timestamp_utc: resultIso },
    ]);
    const nowMs = new Date(resultIso).getTime() + 90 * 60 * 1000; // 1,5h nach dem Resultat -> abgelaufen
    const status = await getHeroEconomicEventStatus(events(), fetcher, nowMs);
    expect(status).toBeNull();
  });

  it("zeigt nach Ablauf der 1h-Frist den naechsten Termin erst wieder 2h vorher", async () => {
    const resultIso = "2026-01-14T14:00:00Z";
    const fetcher = makeFetcher([
      { last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" },
      { last_price: 312.5, timestamp_utc: resultIso },
    ]);
    const nfpEventDate = "2026-02-06"; // spaeterer, noch bevorstehender Termin
    const allEvents = [...events(), { event_key: "nfp", label: "Nonfarm Payrolls", event_date: nfpEventDate }];
    const nowMs = new Date(resultIso).getTime() + 2 * 60 * 60 * 1000;
    expect(await getHeroEconomicEventStatus(allEvents, fetcher, nowMs)).toBeNull();
    const nfpMarkMs = new Date("2026-02-06T13:30:00Z").getTime();
    const status = await getHeroEconomicEventStatus(allEvents, fetcher, nfpMarkMs - 60 * 60 * 1000);
    expect(status?.phase).toBe("upcoming");
    expect(status?.eventKey).toBe("nfp");
  });

  it("blendet einen Termin ohne Resultat nach 6h aus", async () => {
    const fetcher = makeFetcher([{ last_price: 310, timestamp_utc: "2026-01-10T00:00:00Z" }]);
    const status = await getHeroEconomicEventStatus(events(), fetcher, CPI_MARK_MS + 7 * 60 * 60 * 1000);
    expect(status).toBeNull();
  });
});

describe("formatZurichTime", () => {
  it("zeigt 08:30 ET als Schweizer Zeit (Winter 14:30, Sommer 14:30)", () => {
    expect(formatZurichTime(CPI_MARK_MS)).toBe("14:30 Uhr");
    expect(formatZurichTime(new Date("2026-10-14T12:30:00Z").getTime())).toBe("14:30 Uhr");
  });
});
