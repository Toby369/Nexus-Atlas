import { describe, it, expect } from "vitest";
import { aggregateSignalReviewCells, type SignalStatsRow } from "./signalReviewContext";

function row(overrides: Partial<SignalStatsRow>): SignalStatsRow {
  return {
    window_label: "all",
    category: "tradingview_alert",
    signal_type: "LIQUIDITY_SWEEP_HIGH",
    horizon_hours: 4,
    direction_expected: "bearish",
    test_type: "directional",
    n: 20,
    hit_rate_pct: 60,
    baseline_hit_rate_pct: 50,
    avg_return_pct: -0.3,
    avg_abs_return_pct: 0.8,
    baseline_avg_abs_return_pct: null,
    raw_p_value: 0.2,
    significant_after_bh: false,
    computed_at: "2026-09-10T05:00:00.000Z",
    ...overrides,
  };
}

describe("aggregateSignalReviewCells", () => {
  it("liefert null ohne Zeilen (kein erfundener leerer Kontext)", () => {
    expect(aggregateSignalReviewCells([])).toBeNull();
  });

  it("paart 90d- und all-Zeile derselben (category, signal_type, horizon_hours) in eine Zelle", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", n: 12 }),
      row({ window_label: "all", n: 20 }),
    ]);
    expect(ctx?.total_cells).toBe(1);
    expect(ctx?.cells[0].window_90d?.n).toBe(12);
    expect(ctx?.cells[0].window_all?.n).toBe(20);
  });

  it("zaehlt eine Zelle als insufficient_data nur wenn BEIDE Fenster unter der Mindeststichprobe liegen", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", n: 3 }),
      row({ window_label: "all", n: 3 }),
    ]);
    expect(ctx?.insufficient_data_cells).toBe(1);
  });

  it("zaehlt eine Zelle NICHT als insufficient_data, wenn mindestens ein Fenster genug Stichprobe hat", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", n: 3 }),
      row({ window_label: "all", n: 15 }),
    ]);
    expect(ctx?.insufficient_data_cells).toBe(0);
    expect(ctx?.cells_with_min_sample).toBe(1);
  });

  it("zaehlt significant_cells, wenn significant_after_bh in mind. einem Fenster true ist", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", significant_after_bh: true }),
      row({ window_label: "all", significant_after_bh: false }),
    ]);
    expect(ctx?.significant_cells).toBe(1);
  });

  it("markiert decay_flag=true, wenn der 90d-Edge deutlich schwaecher als der Gesamt-Edge ist (beide mit Mindeststichprobe)", () => {
    const ctx = aggregateSignalReviewCells([
      // Edge 90d: 52-50 = +2pp
      row({ window_label: "90d", n: 15, hit_rate_pct: 52, baseline_hit_rate_pct: 50 }),
      // Edge all: 70-50 = +20pp -- 90d-Edge um 18pp schwaecher, ueber der 5pp-Schwelle
      row({ window_label: "all", n: 30, hit_rate_pct: 70, baseline_hit_rate_pct: 50 }),
    ]);
    expect(ctx?.cells[0].decay_flag).toBe(true);
    expect(ctx?.decaying_cells).toBe(1);
  });

  it("markiert decay_flag=false, wenn beide Fenster einen aehnlichen Edge zeigen", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", n: 15, hit_rate_pct: 62, baseline_hit_rate_pct: 50 }),
      row({ window_label: "all", n: 30, hit_rate_pct: 60, baseline_hit_rate_pct: 50 }),
    ]);
    expect(ctx?.cells[0].decay_flag).toBe(false);
  });

  it("laesst decay_flag null, wenn ein Fenster fehlt oder unter der Mindeststichprobe liegt (kein belastbarer Vergleich)", () => {
    const onlyOneWindow = aggregateSignalReviewCells([row({ window_label: "90d", n: 15 })]);
    expect(onlyOneWindow?.cells[0].decay_flag).toBeNull();

    const smallSample = aggregateSignalReviewCells([
      row({ window_label: "90d", n: 3, hit_rate_pct: 52, baseline_hit_rate_pct: 50 }),
      row({ window_label: "all", n: 30, hit_rate_pct: 70, baseline_hit_rate_pct: 50 }),
    ]);
    expect(smallSample?.cells[0].decay_flag).toBeNull();
  });

  it("wendet fuer magnitude-Zellen die Ø|Bewegung|-Schwelle statt der Prozentpunkt-Schwelle an", () => {
    const ctx = aggregateSignalReviewCells([
      row({
        window_label: "90d",
        n: 15,
        test_type: "magnitude",
        direction_expected: null,
        hit_rate_pct: null,
        baseline_hit_rate_pct: null,
        avg_abs_return_pct: 0.5,
        baseline_avg_abs_return_pct: 0.45,
      }),
      row({
        window_label: "all",
        n: 30,
        test_type: "magnitude",
        direction_expected: null,
        hit_rate_pct: null,
        baseline_hit_rate_pct: null,
        avg_abs_return_pct: 0.9,
        baseline_avg_abs_return_pct: 0.4,
      }),
    ]);
    // Edge 90d: 0.5-0.45=0.05, Edge all: 0.9-0.4=0.5 -- Differenz 0.45 > 0.1-Schwelle
    expect(ctx?.cells[0].decay_flag).toBe(true);
  });

  it("uebernimmt das juengste computed_at ueber alle Zeilen", () => {
    const ctx = aggregateSignalReviewCells([
      row({ window_label: "90d", computed_at: "2026-09-03T05:00:00.000Z" }),
      row({ window_label: "all", computed_at: "2026-09-10T05:00:00.000Z" }),
    ]);
    expect(ctx?.computed_at).toBe("2026-09-10T05:00:00.000Z");
  });
});
