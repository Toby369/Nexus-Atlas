import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ANCHOR_PARAM,
  formatAnchorBadge,
  formatAnchorInputValue,
  parseAnchorInputValue,
  parseAnchorParam,
} from "./anchor";

describe("ANCHOR_PARAM", () => {
  it("ist ein stabiler, nicht-leerer Query-Param-Name", () => {
    expect(ANCHOR_PARAM).toBe("anchor");
  });
});

describe("parseAnchorParam", () => {
  it("liefert null fuer fehlenden Wert (null/undefined/leerer String)", () => {
    expect(parseAnchorParam(null)).toBeNull();
    expect(parseAnchorParam(undefined)).toBeNull();
    expect(parseAnchorParam("")).toBeNull();
  });

  it("liefert null fuer einen nicht parsbaren Wert", () => {
    expect(parseAnchorParam("kein-datum")).toBeNull();
  });

  it("parst einen gueltigen ISO-Zeitstempel in der Vergangenheit", () => {
    const result = parseAnchorParam("2026-08-15T14:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-08-15T14:00:00.000Z");
  });

  describe("Zukunfts-Anker (kein sinnvoller Ankerpunkt)", () => {
    afterEach(() => vi.useRealTimers());

    it("liefert null fuer einen Zeitstempel in der Zukunft", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
      expect(parseAnchorParam("2026-08-30T00:00:00.000Z")).toBeNull();
    });

    it("akzeptiert einen Zeitstempel exakt jetzt", () => {
      vi.useFakeTimers();
      const now = new Date("2026-08-29T12:00:00.000Z");
      vi.setSystemTime(now);
      expect(parseAnchorParam(now.toISOString())).not.toBeNull();
    });
  });
});

describe("formatAnchorBadge", () => {
  it("formatiert exakt als 'Anchored to: YYYY-MM-DD HH:mm UTC'", () => {
    const date = new Date("2026-08-15T14:23:00.000Z");
    expect(formatAnchorBadge(date)).toBe("Anchored to: 2026-08-15 14:23 UTC");
  });

  it("padded einstellige Stunden/Minuten korrekt (ISO liefert das bereits)", () => {
    const date = new Date("2026-01-05T04:07:00.000Z");
    expect(formatAnchorBadge(date)).toBe("Anchored to: 2026-01-05 04:07 UTC");
  });
});

describe("formatAnchorInputValue / parseAnchorInputValue (Roundtrip)", () => {
  it("formatiert fuer <input type=datetime-local> ohne Sekunden/Zeitzone", () => {
    const date = new Date("2026-08-15T14:23:45.000Z");
    expect(formatAnchorInputValue(date)).toBe("2026-08-15T14:23");
  });

  it("interpretiert den Input-Rohwert explizit als UTC, nicht als Lokalzeit", () => {
    const parsed = parseAnchorInputValue("2026-08-15T14:23");
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe("2026-08-15T14:23:00.000Z");
  });

  it("liefert null fuer einen leeren Input-Wert", () => {
    expect(parseAnchorInputValue("")).toBeNull();
  });

  it("Roundtrip format -> parse liefert denselben Zeitpunkt (auf die Minute)", () => {
    const original = new Date("2026-08-15T14:23:00.000Z");
    const roundtripped = parseAnchorInputValue(formatAnchorInputValue(original));
    expect(roundtripped!.getTime()).toBe(original.getTime());
  });
});
