import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVisibleInterval, type VisibilityTarget } from "./visibleInterval";

function fakeDocument(initial: DocumentVisibilityState) {
  let listener: (() => void) | null = null;
  const doc = {
    visibilityState: initial,
    addEventListener: (_: "visibilitychange", l: () => void) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    listener?.();
  };
  return { doc: doc as VisibilityTarget, setVisibility, hasListener: () => listener !== null };
}

describe("setVisibleInterval", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("laeuft bei sichtbarem Tab im Takt", () => {
    const fn = vi.fn();
    const { doc } = fakeDocument("visible");
    setVisibleInterval(fn, 1000, doc, () => Date.now());
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("pausiert bei verstecktem Tab", () => {
    const fn = vi.fn();
    const { doc, setVisibility } = fakeDocument("visible");
    setVisibleInterval(fn, 1000, doc, () => Date.now());
    vi.advanceTimersByTime(1000);
    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("laedt beim Zurueckkehren sofort nach, wenn ein Intervall verpasst wurde", () => {
    const fn = vi.fn();
    const { doc, setVisibility } = fakeDocument("visible");
    setVisibleInterval(fn, 1000, doc, () => Date.now());
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    setVisibility("visible");
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("laedt beim kurzen Wegschauen nicht doppelt", () => {
    const fn = vi.fn();
    const { doc, setVisibility } = fakeDocument("visible");
    setVisibleInterval(fn, 1000, doc, () => Date.now());
    setVisibility("hidden");
    vi.advanceTimersByTime(300);
    setVisibility("visible");
    expect(fn).not.toHaveBeenCalled();
  });

  it("startet nicht, wenn der Tab beim Mount versteckt ist", () => {
    const fn = vi.fn();
    const { doc, setVisibility } = fakeDocument("hidden");
    setVisibleInterval(fn, 1000, doc, () => Date.now());
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("raeumt Timer und Listener auf", () => {
    const fn = vi.fn();
    const { doc, hasListener } = fakeDocument("visible");
    const stop = setVisibleInterval(fn, 1000, doc, () => Date.now());
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(hasListener()).toBe(false);
  });
});
