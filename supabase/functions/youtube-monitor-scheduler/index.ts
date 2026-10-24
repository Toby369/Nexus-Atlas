import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Krypto-YouTube-Monitor: taeglicher automatischer Check + Push (Nutzer-
// Wunsch 08.09.2026: "30 Minuten nach dem letzten [taeglichen Post] eine
// automatische Abfrage mit Report generiert, inklusive Push-Benachrichti-
// gung"). Cron-Zeit 06:30 UTC (= 08:30 Schweizer Sommerzeit) gewaehlt, weil
// nur Bitbull unter den 6 konfigurierten Kanaelen einen wirklich
// verlaesslichen taeglichen Post-Zeitpunkt hat (~06:30 UTC morgens, per
// echten Upload-Zeitstempeln verifiziert) -- die anderen posten entweder zu
// unregelmaessig (Blocktrainer, Cowen) oder gar nicht mehr (DataDash,
// tokentus, seit Monaten/Jahren inaktiv).
//
// Ruft KEINE AI-Provider selbst auf und dupliziert auch nicht die Analyse-
// Logik -- reiner Trigger fuer die bereits bestehende, auf Vercel gehostete
// Route POST /api/youtube-monitor/generate, gleiches Muster wie
// report-scheduler.
//
// Fund 09.09.2026 (Nutzer-Meldung "keine Push-Nachricht bekommen"): der
// urspruengliche Bearer-Mechanismus (SUPABASE_SERVICE_ROLE_KEY) hat in
// Produktion nie zuverlaessig funktioniert -- Live-Test ergab 401 "Nicht
// authentifiziert", obwohl der Cron selbst puenktlich um 06:30 UTC feuerte.
// Ersetzt durch ein dediziertes CRON_SECRET aus dem Supabase Vault
// (get_secret-RPC, gleiches Muster wie VAPID_PRIVATE_KEY in
// send-state-change-push) -- unabhaengig vom DB-Master-Key. proxy.ts/
// lib/authGate.ts vergleicht dagegen die Vercel-Umgebungsvariable
// CRON_SECRET (identischer Wert, dort manuell gesetzt).
//
// Nach einem erfolgreichen Lauf MIT neuen Analysen wird direkt (nicht ueber
// den Zustandswechsel-Umweg) eine Push-Nachricht ueber
// send-state-change-push (Body { custom: {...} }) verschickt -- der Text
// fasst den Kanal-Vergleich (lib/youtubeConsensus.ts, von der Route bereits
// mitgeliefert) zusammen. Keine neuen Videos an diesem Tag -> kein Push
// (kein Spam bei einem Tag ohne Upload).

const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://nexus-atlas-zeta.vercel.app";

interface ConsensusOutlier {
  channelTitle: string;
  bias: string;
}

interface Consensus {
  channelsCompared: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  majorityBias: string | null;
  agreementLevel: "einig" | "mehrheitlich" | "gespalten";
  outliers: ConsensusOutlier[];
}

interface GenerateResponse {
  success: boolean;
  analyzed?: number;
  checked?: number;
  error?: string;
  consensus?: Consensus | null;
}

const BIAS_LABELS_DE: Record<string, string> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
};

function buildPushBody(analyzed: number, consensus: Consensus | null | undefined): string {
  if (!consensus || consensus.channelsCompared < 2) {
    return `${analyzed} neue(s) Video(s) analysiert.`;
  }

  const counts = `${consensus.bullishCount} bullish, ${consensus.bearishCount} bearish, ${consensus.neutralCount} neutral`;

  if (consensus.agreementLevel === "einig") {
    const label = consensus.majorityBias ? BIAS_LABELS_DE[consensus.majorityBias] ?? consensus.majorityBias : "unklar";
    return `Alle ${consensus.channelsCompared} verglichenen Kanaele einig: ${label}. (${analyzed} neue Videos)`;
  }

  if (consensus.agreementLevel === "mehrheitlich") {
    const label = consensus.majorityBias ? BIAS_LABELS_DE[consensus.majorityBias] ?? consensus.majorityBias : "unklar";
    const outlierText = consensus.outliers
      .map((o) => `${o.channelTitle} (${BIAS_LABELS_DE[o.bias] ?? o.bias})`)
      .join(", ");
    return `Mehrheitlich ${label} (${counts}). Abweichend: ${outlierText}.`;
  }

  return `Gespalten -- keine Mehrheit unter den Kanaelen (${counts}).`;
}

async function sendPush(supabaseUrl: string, title: string, body: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-state-change-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom: { title, body } }),
    });
  } catch {
    // Push-Fehler soll den Scheduler-Lauf nicht als fehlgeschlagen melden --
    // die Analysen selbst sind bereits erfolgreich gespeichert.
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: cronSecret, error: secretError } = await supabase.rpc("get_secret", {
    secret_name: "CRON_SECRET",
  });
  if (secretError || !cronSecret) {
    return new Response(
      JSON.stringify({ success: false, error: secretError ? secretError.message : "CRON_SECRET nicht in Vault hinterlegt" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let res: Response;
  try {
    res = await fetch(`${APP_URL}/api/youtube-monitor/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: `Aufruf von /api/youtube-monitor/generate fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const json = (await res.json().catch(() => ({}))) as GenerateResponse;

  // 422 = "keine neuen Videos in den letzten 24h" -- kein Fehler, nur nichts
  // zu tun (siehe app/api/youtube-monitor/generate/route.ts).
  if (res.status === 422) {
    return new Response(JSON.stringify({ success: true, skipped: "no_new_videos" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!res.ok || json.success !== true) {
    return new Response(
      JSON.stringify({ success: false, error: json.error ?? `HTTP ${res.status}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const analyzed = json.analyzed ?? 0;
  if (analyzed === 0) {
    return new Response(JSON.stringify({ success: true, skipped: "no_new_analyses" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const pushBody = buildPushBody(analyzed, json.consensus);
  await sendPush(supabaseUrl, "Nexus Atlas — YouTube-Monitor", pushBody);

  return new Response(JSON.stringify({ success: true, analyzed, pushBody }), {
    headers: { "Content-Type": "application/json" },
  });
});
