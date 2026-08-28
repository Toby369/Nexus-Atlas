import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAndRecordRateLimit } from "./rateLimit";

// Minimaler Fake fuer die konkrete Aufrufkette, die checkAndRecordRateLimit
// tatsaechlich nutzt (.from().select().eq().gte() als Count-Query,
// .from().insert() fuer den neuen Eintrag) -- kein echter Supabase-Client,
// keine Netzwerkaufrufe.
function makeFakeSupabase(opts: {
  count: number | null;
  countError: { message: string } | null;
  insertError: { message: string } | null;
}) {
  const selectChain = {
    eq: () => selectChain,
    gte: () => Promise.resolve({ count: opts.count, error: opts.countError }),
  };
  const insertSpy = vi.fn(() => Promise.resolve({ error: opts.insertError }));
  const from = vi.fn(() => ({
    select: () => selectChain,
    insert: insertSpy,
  }));
  const client = { from } as unknown as SupabaseClient;
  return { client, insertSpy };
}

describe("checkAndRecordRateLimit", () => {
  it("erlaubt die Anfrage und schreibt einen Eintrag, wenn unter dem Limit", async () => {
    const { client, insertSpy } = makeFakeSupabase({ count: 2, countError: null, insertError: null });
    const result = await checkAndRecordRateLimit(client, "reports_run", 10, 10);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeNull();
    expect(insertSpy).toHaveBeenCalledWith({ endpoint: "reports_run" });
  });

  it("blockt die Anfrage, wenn das Limit bereits erreicht ist, und schreibt KEINEN Eintrag", async () => {
    const { client, insertSpy } = makeFakeSupabase({ count: 10, countError: null, insertError: null });
    const result = await checkAndRecordRateLimit(client, "reports_run", 10, 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(600);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("blockt konservativ, wenn die Zaehler-Abfrage selbst fehlschlaegt", async () => {
    const { client } = makeFakeSupabase({
      count: null,
      countError: { message: "db down" },
      insertError: null,
    });
    const result = await checkAndRecordRateLimit(client, "reports_run", 10, 10);
    expect(result.allowed).toBe(false);
  });

  it("erlaubt die Anfrage trotzdem, wenn nur das Schreiben des Eintrags fehlschlaegt (best-effort)", async () => {
    const { client } = makeFakeSupabase({ count: 0, countError: null, insertError: { message: "insert failed" } });
    const result = await checkAndRecordRateLimit(client, "reports_run", 10, 10);
    expect(result.allowed).toBe(true);
  });

  it("behandelt count=null (kein Fehler) wie 0 -- erlaubt die Anfrage", async () => {
    const { client } = makeFakeSupabase({ count: null, countError: null, insertError: null });
    const result = await checkAndRecordRateLimit(client, "reports_run", 10, 10);
    expect(result.allowed).toBe(true);
  });
});
