import { describe, it, expect } from "vitest";
import { formatRelative } from "./ClientTimestamp";

const BASE = "2026-08-28T12:00:00.000Z";
const baseMs = new Date(BASE).getTime();

describe("formatRelative", () => {
  it("returns 'gerade eben' for a timestamp in the future (negative delta)", () => {
    expect(formatRelative(BASE, baseMs - 5_000)).toBe("gerade eben");
  });

  it("returns 'vor 0s' for exactly zero delta", () => {
    expect(formatRelative(BASE, baseMs)).toBe("vor 0s");
  });

  it("formats sub-minute deltas in seconds", () => {
    expect(formatRelative(BASE, baseMs + 1_000)).toBe("vor 1s");
    expect(formatRelative(BASE, baseMs + 59_000)).toBe("vor 59s");
  });

  it("formats sub-hour deltas in minutes", () => {
    expect(formatRelative(BASE, baseMs + 60_000)).toBe("vor 1 Min");
    expect(formatRelative(BASE, baseMs + 59 * 60_000)).toBe("vor 59 Min");
  });

  it("formats sub-day deltas in hours", () => {
    expect(formatRelative(BASE, baseMs + 60 * 60_000)).toBe("vor 1 Std");
    expect(formatRelative(BASE, baseMs + 23 * 60 * 60_000)).toBe("vor 23 Std");
  });

  it("formats multi-day deltas in days", () => {
    expect(formatRelative(BASE, baseMs + 24 * 60 * 60_000)).toBe("vor 1 Tg");
    expect(formatRelative(BASE, baseMs + 5 * 24 * 60 * 60_000)).toBe("vor 5 Tg");
  });
});
