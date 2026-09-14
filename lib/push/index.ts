export interface ReportPushMessage {
  title: string;
  body: string;
  url: string;
}

export interface SendReportPushResult {
  /** false = keine Subscriptions/kein Aufruf versucht (siehe unten). */
  attempted: boolean;
  success: boolean;
  error?: string;
}

/**
 * Versendet eine Report-Push-Benachrichtigung ueber die bestehende
 * send-state-change-push Edge Function (Body-Modus { custom: {...} },
 * siehe supabase/functions/send-state-change-push -- dort bereits fuer
 * andere Scheduler wie youtube-monitor-scheduler genutzt, hier nur um ein
 * optionales url-Feld erweitert). Wirft NIE -- Push ist wie E-Mail ein
 * optionales Add-on, kein Blocker fuer den eigentlichen Report-Lauf
 * (gleiches Muster wie lib/email/index.ts::sendReportEmail).
 *
 * "attempted: false" bedeutet hier: NEXT_PUBLIC_SUPABASE_URL fehlt, es
 * wurde also gar nicht erst versucht. Anders als bei E-Mail gibt es keine
 * separate "ist ein Provider konfiguriert"-Frage -- die Edge Function ist
 * immer deployed, faellt aber selbst ins Leere, wenn keine Subscriptions
 * registriert sind (das zaehlt hier als success, kein Fehler).
 */
export async function sendReportPush(message: ReportPushMessage): Promise<SendReportPushResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return { attempted: false, success: false, error: "NEXT_PUBLIC_SUPABASE_URL fehlt." };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-state-change-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        custom: { title: message.title, body: message.body, url: message.url },
      }),
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
      return { attempted: true, success: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { attempted: true, success: true };
  } catch (err) {
    return { attempted: true, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
