import { describe as suite, it, expect } from "vitest";
import {
  AUSGEFALLEN_FAKTOR,
  DATA_SOURCES,
  dataSource,
  evaluateSource,
  evaluateSources,
  formatAge,
  summarizeTile,
  worstStatus,
} from "./dataFreshness";

const NOW = Date.parse("2026-10-29T08:40:00Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

suite("evaluateSource", () => {
  const futures = dataSource("futures_binance"); // normal bis 12 Min

  it("ist frisch bis zum Normalalter", () => {
    expect(evaluateSource(futures, minAgo(12), NOW).status).toBe("frisch");
  });

  it("ist verspaetet ueber dem Normalalter", () => {
    expect(evaluateSource(futures, minAgo(13), NOW).status).toBe("verspaetet");
  });

  it(`ist ausgefallen ab dem ${AUSGEFALLEN_FAKTOR}-fachen Normalalter`, () => {
    expect(evaluateSource(futures, minAgo(36), NOW).status).toBe("verspaetet");
    expect(evaluateSource(futures, minAgo(37), NOW).status).toBe("ausgefallen");
  });

  it("ohne Zeitstempel: ausgefallen -- eine fehlende Quelle darf nie wie eine ruhige aussehen", () => {
    expect(evaluateSource(futures, null, NOW)).toMatchObject({ status: "ausgefallen", ageMs: null });
    expect(evaluateSource(futures, undefined, NOW).status).toBe("ausgefallen");
    expect(evaluateSource(futures, "kein Datum", NOW).status).toBe("ausgefallen");
  });

  it("optionale Quelle ohne Zeitstempel ist unbekannt, nicht ausgefallen", () => {
    expect(evaluateSource(dataSource("autark_sync"), null, NOW).status).toBe("unbekannt");
  });

  it("Zeitstempel knapp in der Zukunft (Uhrenabweichung) gilt als frisch mit Alter 0", () => {
    expect(evaluateSource(futures, minAgo(-1), NOW)).toMatchObject({ status: "frisch", ageMs: 0 });
  });

  it("1h-Kerze mit Eroeffnungszeit vor gut 2 Std ist im Normalbetrieb frisch", () => {
    // 10:59 Uhr: letzte geschlossene 1h-Kerze ist die 09:00er.
    expect(evaluateSource(dataSource("candles_1h"), minAgo(119), NOW).status).toBe("frisch");
  });
});

suite("worstStatus", () => {
  it("nimmt den schlechtesten Zustand, unbekannt zieht nicht nach unten", () => {
    const items = evaluateSources(["futures_binance", "autark_sync"], { futures_binance: minAgo(2) }, NOW);
    expect(worstStatus(items)).toBe("frisch");
    const schlecht = evaluateSources(
      ["futures_binance", "futures_bybit", "news"],
      { futures_binance: minAgo(2), futures_bybit: minAgo(20), news: null },
      NOW
    );
    expect(worstStatus(schlecht)).toBe("ausgefallen");
  });
});

suite("summarizeTile", () => {
  it("alles frisch: Alter der aeltesten Quelle", () => {
    const items = evaluateSources(["futures_binance", "spot_binance"], {
      futures_binance: minAgo(2),
      spot_binance: minAgo(9),
    }, NOW);
    expect(summarizeTile(items)).toEqual({ status: "frisch", text: "vor 9 Min" });
  });

  it("eine Quelle betroffen: beim Namen", () => {
    const items = evaluateSources(["futures_binance", "futures_pionex"], {
      futures_binance: minAgo(2),
      futures_pionex: minAgo(120),
    }, NOW);
    expect(summarizeTile(items)).toEqual({ status: "ausgefallen", text: "Futures Pionex vor 2 Std" });
  });

  it("fehlende Quelle: 'fehlt'", () => {
    const items = evaluateSources(["futures_pionex"], {}, NOW);
    expect(summarizeTile(items).text).toBe("Futures Pionex fehlt");
  });

  it("mehrere betroffen: Anzahl und schlechtester Zustand", () => {
    const items = evaluateSources(["futures_binance", "futures_bybit"], {
      futures_binance: minAgo(15),
      futures_bybit: minAgo(45),
    }, NOW);
    expect(summarizeTile(items)).toEqual({ status: "ausgefallen", text: "2 Quellen ausgefallen" });
  });
});

suite("formatAge", () => {
  it("formatiert Minuten, Stunden und Tage", () => {
    expect(formatAge(null)).toBe("keine Daten");
    expect(formatAge(30_000)).toBe("gerade eben");
    expect(formatAge(4 * 60_000)).toBe("vor 4 Min");
    expect(formatAge(5 * 3_600_000)).toBe("vor 5 Std");
    expect(formatAge(72 * 3_600_000)).toBe("vor 3 Tg");
  });
});

suite("DATA_SOURCES", () => {
  it("hat eindeutige Schluessel und positive Normalalter", () => {
    const keys = DATA_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of DATA_SOURCES) expect(s.normalMaxMin).toBeGreaterThan(0);
  });

  it("dataSource wirft bei einem Tippfehler", () => {
    expect(() => dataSource("futures_binanse")).toThrow(/Unbekannte Datenquelle/);
  });
});
