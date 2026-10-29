import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// NEXUS Briefing-Scheduler (Funktionsname "report-scheduler" bleibt, weil
// der pg_cron-Job ihn so aufruft). Seit der Zusammenlegung von Master-Report
// und System-Briefing startet er keine Report-Slots mehr, sondern das
// System-Briefing zu den Uhrzeiten aus system_briefing_config.schedule_times
// (Schweizer Zeit, Europe/Zurich -- Sommer-/Winterzeit wird hier ueber Intl
// umgerechnet, eine Uhrzeit bleibt also das ganze Jahr dieselbe lokale
// Uhrzeit). Er ruft KEINE AI-Provider selbst auf -- nur die bestehende,
// auf Vercel gehostete Route POST /api/system-briefing/generate, die danach
// auch E-Mail/Push verschickt (system_briefing_config.email_enabled/
// push_enabled).
//
// verify_jwt=false (wie zuvor): pg_cron ruft per net.http_post OHNE
// Authorization-Header auf. Die Absicherung ist das CRON_SECRET aus dem
// Supabase Vault, das diese Funktion an die Vercel-Route weiterreicht
// (lib/authGate.ts vergleicht gegen die Vercel-Env CRON_SECRET).
//
// Cron-Takt: alle 5 Minuten. Faellig ist eine geplante Uhrzeit, wenn sie
// (Schweizer Zeit) hoechstens CATCH_UP_MINUTES zurueckliegt und seit diesem
// Zeitpunkt noch kein Briefing (ok ODER Fehler) gespeichert wurde. Dadurch
// holt ein spaeterer Tick einen verpassten Termin nach (Vorfall 12.10.2026
// 10:15: die DB war ueberlastet, dieser Aufruf scheiterte mit 500, ohne
// Nachholen fiel der Termin ganz aus), und ein wiederholter Tick loest
// keinen zweiten Lauf aus. Die Minutendifferenz reicht ohne
// Zeitzonen-Umrechnung: die Zuercher Zeitzone weicht nur um ganze Stunden
// von UTC ab.
//
// Die Briefing-Route braucht bis zu einigen Minuten (KI-Aufrufe). Die
// Antwort an pg_cron wartet deshalb nicht darauf; EdgeRuntime.waitUntil
// haelt die Verbindung zur Vercel-Route trotzdem offen, bis sie fertig ist.
// Das Ergebnis landet ohnehin in system_briefings.

const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://nexus-atlas-zeta.vercel.app";
// Wie lange auf den Start der Vercel-Funktion gewartet wird, bevor dieser
// Aufruf zurueckkehrt (die Vercel-Funktion laeuft unabhaengig weiter). Klein
// halten: pg_net bricht den Aufruf dieser Funktion nach 5s ab.
const DISPATCH_WAIT_MS = 2_000;

const TIME_ZONE = "Europe/Zurich";
const CATCH_UP_MINUTES = 20;
const MINUTES_PER_DAY = 24 * 60;

function zurichHourMinute(d: Date): [number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [part("hour"), part("minute")];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cronSecret, error: secretError } = await supabase.rpc("get_secret", {
    secret_name: "CRON_SECRET",
  });
  if (secretError || !cronSecret) {
    return json({ success: false, error: secretError ? secretError.message : "CRON_SECRET nicht in Vault hinterlegt" }, 500);
  }

  const { data: config, error: configError } = await supabase
    .from("system_briefing_config")
    .select("schedule_times")
    .eq("id", 1)
    .maybeSingle();
  if (configError) return json({ success: false, error: configError.message }, 500);

  const now = new Date();
  const [nowHh, nowMm] = zurichHourMinute(now);
  const nowMinutes = nowHh * 60 + nowMm;
  const nowLabel = `${String(nowHh).padStart(2, "0")}:${String(nowMm).padStart(2, "0")}`;

  // Juengste geplante Uhrzeit innerhalb des Nachhol-Fensters.
  let due: { time: string; minutesAgo: number } | null = null;
  for (const t of (config?.schedule_times ?? []) as string[]) {
    const [hh, mm] = t.split(":").map(Number);
    const minutesAgo = (nowMinutes - (hh * 60 + mm) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (minutesAgo < CATCH_UP_MINUTES && (!due || minutesAgo < due.minutesAgo)) due = { time: t, minutesAgo };
  }
  if (!due) return json({ success: true, now: nowLabel, triggered: false });
  const dueTime = due.time;

  // Zeitpunkt der geplanten Uhrzeit, auf die Minute genau.
  const scheduledAtUtc = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000 - due.minutesAgo * 60_000
  ).toISOString();

  const { count, error: runCheckError } = await supabase
    .from("system_briefings")
    .select("id", { count: "exact", head: true })
    .gte("generated_at", scheduledAtUtc);
  if (runCheckError) return json({ success: false, error: runCheckError.message }, 500);
  if ((count ?? 0) > 0) return json({ success: true, now: nowLabel, time: dueTime, triggered: false, reason: "bereits gelaufen" });

  const request = fetch(`${APP_URL}/api/system-briefing/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  }).then(
    (res) => ({ status: res.status }),
    (err) => ({ error: err instanceof Error ? err.message : String(err) })
  );
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(request);
  const outcome = await Promise.race([
    request,
    new Promise((resolve) => setTimeout(() => resolve({ dispatched: true }), DISPATCH_WAIT_MS)),
  ]);

  return json({ success: true, now: nowLabel, time: dueTime, triggered: true, outcome });
});
