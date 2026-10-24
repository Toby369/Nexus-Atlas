import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Wirtschaftskalender-Collector: naechster bekannter Termin je verfolgtem
// Ereignis, mit statischer BTC-Einordnung im Frontend (lib/economicCalendar.ts
// -- kein KI-Modell, gleiche "regelbasiert statt Blend-Score"-Philosophie wie
// der Rest der App). Zwei Quellen:
//
// 1) FRED (St. Louis Fed, api.stlouisfed.org) -- derselbe FRED_API_KEY aus
//    dem Vault wie collect-macro. FRED liefert selbst keinen direkten
//    "naechster Termin"-Endpunkt je Serie -- zwei Schritte noetig:
//    a) fred/series/release -> release_id der Serie ermitteln (bewusst
//       nicht hartcodiert, falls FRED die Zuordnung je aendert).
//    b) fred/release/dates?release_id=X -> alle bekannten Termine dieses
//       Release, davon der erste >= heute.
//
// 2) FOMC-Sitzungstermine -- FRED bildet das NICHT als Data-Release ab
//    (siehe Kommentar in collect-macro/index.ts). Der Fed-Sitzungskalender
//    wird lange im Voraus offiziell veroeffentlicht (federalreserve.gov/
//    monetarypolicy/fomccalendars.htm) und aendert sich praktisch nie --
//    darum hier als kleine statisch gepflegte Liste hinterlegt, wie die
//    FRED_SERIES-Konstante in collect-macro. Muss jaehrlich um den
//    naechsten Jahrgang ergaenzt werden, sobald der Fed ihn veroeffentlicht.
//
// Tabelle wird UPSERTED (ein Datensatz pro event_key), nicht wie die
// uebrigen Collector-Tabellen fortlaufend angehaengt -- hier interessiert
// nur der aktuell bekannte naechste Termin, keine Historie vergangener
// Vorhersagen.

interface FredTrackedSeries {
  eventKey: string;
  seriesId: string;
  label: string;
  typicalTimeEt: string;
}

// Serien-IDs identisch zu FRED_SERIES in collect-macro/index.ts (dieselben
// drei decken CPI/PCE/NFP ab). typicalTimeEt ist eine bekannte, oeffentliche
// Tatsache (BLS/BEA veroeffentlichen grundsaetzlich um 8:30 Uhr ET) -- FRED
// liefert selbst keine Uhrzeit, nur das Datum.
const FRED_TRACKED: FredTrackedSeries[] = [
  { eventKey: "cpi", seriesId: "CPIAUCSL", label: "Verbraucherpreisindex (CPI)", typicalTimeEt: "8:30 Uhr ET" },
  { eventKey: "pce", seriesId: "PCEPI", label: "PCE-Preisindex", typicalTimeEt: "8:30 Uhr ET" },
  { eventKey: "nfp", seriesId: "PAYEMS", label: "Nonfarm Payrolls", typicalTimeEt: "8:30 Uhr ET" },
];

// Offizieller Fed-Sitzungskalender (federalreserve.gov/monetarypolicy/
// fomccalendars.htm, per 01.09.2026 verifiziert) -- Datum des jeweils
// zweiten Sitzungstags, an dem der Zinsentscheid veroeffentlicht wird.
const FOMC_DECISION_DATES_2026 = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FRED_STAGGER_MS = 300;

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

interface CalendarRow {
  event_key: string;
  label: string;
  event_date: string | null;
  typical_time_et: string | null;
  source: string;
}

async function resolveNextFredDate(
  apiKey: string,
  tracked: FredTrackedSeries,
  todayIso: string,
): Promise<CalendarRow> {
  try {
    const releaseJson = await fetchJson(
      `https://api.stlouisfed.org/fred/series/release?series_id=${encodeURIComponent(
        tracked.seriesId,
      )}&api_key=${apiKey}&file_type=json`,
    );
    const releaseId = releaseJson?.releases?.[0]?.id;
    if (!releaseId) throw new Error(`Keine Release-ID fuer ${tracked.seriesId} gefunden`);

    // sort_order=asc faengt bei FRED beim aeltesten bekannten Termin an
    // (fuer CPI z.B. 1913) -- verifiziert per Live-Aufruf, dort liegt
    // innerhalb der ersten 50 Eintraege nichts in Zukunftsnaehe. desc
    // liefert stattdessen die zuletzt bekannten (und damit auch die
    // bereits im Voraus angekuendigten kuenftigen) Termine zuerst.
    const datesJson = await fetchJson(
      `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&sort_order=desc&include_release_dates_with_no_data=true&limit=10`,
    );
    const dates: string[] = (datesJson?.release_dates ?? [])
      .map((d: any) => d?.date)
      .filter((d: unknown): d is string => typeof d === "string");
    const futureDates = dates.filter((d) => d >= todayIso).sort();
    const nextDate = futureDates[0] ?? null;

    if (!nextDate) throw new Error(`Kein zukuenftiges Datum fuer Release ${releaseId} in den letzten 10 Eintraegen`);

    return {
      event_key: tracked.eventKey,
      label: tracked.label,
      event_date: nextDate,
      typical_time_et: tracked.typicalTimeEt,
      source: "fred",
    };
  } catch (err) {
    return {
      event_key: tracked.eventKey,
      label: tracked.label,
      event_date: null,
      typical_time_et: null,
      source: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function resolveNextFomcDate(todayIso: string): CalendarRow {
  const nextDate = FOMC_DECISION_DATES_2026.find((d) => d >= todayIso) ?? null;
  return {
    event_key: "fomc",
    label: "FOMC-Zinsentscheid",
    event_date: nextDate,
    typical_time_et: "14:00 Uhr ET",
    source: nextDate ? "static" : "error: Liste 2026 erschoepft, naechsten Jahrgang ergaenzen",
  };
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const todayIso = new Date().toISOString().slice(0, 10);
  const rows: CalendarRow[] = [];

  const { data: fredApiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "FRED_API_KEY",
  });

  if (keyError || !fredApiKey) {
    for (const tracked of FRED_TRACKED) {
      rows.push({
        event_key: tracked.eventKey,
        label: tracked.label,
        event_date: null,
        typical_time_et: null,
        source: keyError ? `error: ${keyError.message}` : "error: FRED_API_KEY nicht in Vault hinterlegt",
      });
    }
  } else {
    for (let i = 0; i < FRED_TRACKED.length; i++) {
      if (i > 0) await sleep(FRED_STAGGER_MS);
      rows.push(await resolveNextFredDate(fredApiKey, FRED_TRACKED[i], todayIso));
    }
  }

  rows.push(resolveNextFomcDate(todayIso));

  // Nur Zeilen mit tatsaechlich aufgeloestem Datum upserten -- ein Fehler
  // bei einer Quelle soll den zuletzt bekannten guten Wert der anderen
  // event_keys nicht ueberschreiben oder loeschen.
  const validRows = rows.filter((r) => r.event_date !== null);

  let upsertError: { message: string } | null = null;
  if (validRows.length > 0) {
    const { error } = await supabase.from("economic_calendar_events").upsert(
      validRows.map((r) => ({
        event_key: r.event_key,
        label: r.label,
        event_date: r.event_date,
        typical_time_et: r.typical_time_et,
        source: r.source,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "event_key" },
    );
    upsertError = error;
  }

  if (upsertError) {
    return new Response(JSON.stringify({ success: false, error: upsertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      results: rows.map((r) => ({ event_key: r.event_key, event_date: r.event_date, source: r.source })),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
