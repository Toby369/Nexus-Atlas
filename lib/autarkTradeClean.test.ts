import { describe, expect, it } from "vitest";
import { cleanTrade, toText } from "../supabase/functions/_shared/autarkTradeClean";

describe("Journal-Trades aus AutarkTrade bereinigen", () => {
  it("HTML wird Text, Entities aufgeloest", () => {
    expect(toText("<p>Retest <b>VWAP</b></p><p>A &amp; B&nbsp;ok</p>", 100)).toBe("Retest VWAP\nA & B ok");
    expect(toText("<script>x</script>", 100)).toBe("x");
    expect(toText("   ", 100)).toBeNull();
    expect(toText(5, 100)).toBeNull();
  });

  it("Pflichtfelder, Zahlen, Zeiten in Sekunden, Tags", () => {
    const t = cleanTrade({
      trade_id: "t1795046400_0_42",
      status: "closed",
      position_id: 42,
      side: "long",
      entry_price: "59150.5",
      exit_price: 58000,
      entry_time: 1795075200,
      exit_time: 1795078800000,
      net_pnl: -1.2,
      gross_pnl: "x",
      strategy_followed: true,
      tags: ["Retest", "", 5, " AVWAP "],
      journal: { entry_note: "<p>Plan A</p>", entry_stress: "3", feelings: null, evil: "<img>", tpsl_history: [{ sl: 58000 }] },
    }) as Record<string, unknown>;
    expect(t.position_id).toBe("42");
    expect(t.entry_price).toBe(59150.5);
    expect(t.gross_pnl).toBeNull();
    expect(t.entry_time).toBe("2026-11-19T08:00:00.000Z");
    expect(t.exit_time).toBe("2026-11-19T09:00:00.000Z");
    expect(t.tags).toEqual(["Retest", "AVWAP"]);
    expect(t.strategy_followed).toBe(true);
    expect(t.journal).toEqual({ entry_note: "Plan A", entry_stress: 3, tpsl_history: [{ sl: 58000 }] });
  });

  it("ungueltige Trades werden mit Grund abgelehnt", () => {
    expect(cleanTrade({ status: "closed" })).toMatch(/trade_id/);
    expect(cleanTrade({ trade_id: "a", status: "bot" })).toMatch(/status/);
  });
});
