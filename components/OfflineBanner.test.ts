import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextOfflineCheckState, probeReachable } from "./OfflineBanner";

describe("nextOfflineCheckState", () => {
  it("setzt bei Erreichbarkeit sofort auf online zurück, auch nach vorherigen Fehlern", () => {
    const result = nextOfflineCheckState({ failures: 5, offline: true }, true);
    expect(result).toEqual({ failures: 0, offline: false });
  });

  it("erhöht den Fehlerzähler bei Nicht-Erreichbarkeit, zeigt aber noch nicht offline unterhalb der Schwelle", () => {
    const result = nextOfflineCheckState({ failures: 0, offline: false }, false, 2);
    expect(result).toEqual({ failures: 1, offline: false });
  });

  it("schaltet erst ab Erreichen der Schwelle auf offline (Debounce gegen einzelne Ausreisser)", () => {
    let state = { failures: 0, offline: false };
    state = nextOfflineCheckState(state, false, 2);
    expect(state.offline).toBe(false); // 1. Fehlschlag -- noch kein Alarm
    state = nextOfflineCheckState(state, false, 2);
    expect(state.offline).toBe(true); // 2. Fehlschlag -- Schwelle erreicht
  });

  it("bleibt offline, solange weitere Checks fehlschlagen", () => {
    let state = { failures: 2, offline: true };
    state = nextOfflineCheckState(state, false, 2);
    expect(state.offline).toBe(true);
    expect(state.failures).toBe(3);
  });

  it("respektiert eine benutzerdefinierte Schwelle", () => {
    let state = { failures: 0, offline: false };
    state = nextOfflineCheckState(state, false, 1);
    expect(state.offline).toBe(true); // Schwelle 1 -> sofort beim ersten Fehlschlag
  });

  it("ein einzelner Ausreisser (1 Fehlschlag, dann wieder erreichbar) löst nie offline aus", () => {
    let state = { failures: 0, offline: false };
    state = nextOfflineCheckState(state, false, 2);
    state = nextOfflineCheckState(state, true, 2);
    expect(state).toEqual({ failures: 0, offline: false });
  });
});

describe("probeReachable", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("liefert true bei jeder tatsächlich erhaltenen Antwort (auch ein Fehlerstatus zählt als erreichbar)", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const result = await probeReachable("/favicon.ico", 5000);
    expect(result).toBe(true);
  });

  it("liefert false bei einem echten Netzwerkfehler (fetch wirft)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await probeReachable("/favicon.ico", 5000);
    expect(result).toBe(false);
  });

  it("liefert false bei einem Timeout (AbortController greift)", async () => {
    global.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    const resultPromise = probeReachable("/favicon.ico", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("hängt einen Cache-Busting-Query-Parameter an, damit kein Zwischenspeicher greift", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    await probeReachable("/favicon.ico", 5000);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^\/favicon\.ico\?_=\d+$/);
  });

  it("nutzt method HEAD und cache no-store", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    await probeReachable("/favicon.ico", 5000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("HEAD");
    expect(init.cache).toBe("no-store");
  });
});
