import type { EmailMessage, EmailProvider } from "./types";
import { resendProvider } from "./providers/resend";

// Zentrale Registry, analog zu lib/ai/providers/index.ts. Aktuell nur
// Resend, aber Business-Logik importiert NIE einen konkreten Provider
// direkt -- ausschliesslich sendReportEmail() unten (Vorgabe Teil U:
// provider-unabhaengige Abstraktion, Resend nicht hartcodiert).
const emailProviderRegistry: EmailProvider[] = [resendProvider];

function getConfiguredEmailProvider(): EmailProvider | null {
  return emailProviderRegistry.find((p) => p.isConfigured()) ?? null;
}

export interface SendReportEmailResult {
  /** false = kein Provider konfiguriert, es wurde gar nicht erst versucht. */
  attempted: boolean;
  success: boolean;
  provider?: string;
  error?: string;
}

/**
 * Versendet eine Report-Benachrichtigung, falls ein E-Mail-Provider
 * konfiguriert ist. Wirft NIE -- E-Mail-Versand ist ein optionales Add-on,
 * kein Blocker fuer den eigentlichen Report-Lauf. Ist kein Provider
 * konfiguriert, kommt ein klar als "nicht versucht" markiertes Ergebnis
 * zurueck statt eines stillen No-Ops (siehe app/api/reports/run/route.ts,
 * das email_sent entsprechend in report_runs vermerkt).
 */
export async function sendReportEmail(message: EmailMessage): Promise<SendReportEmailResult> {
  const provider = getConfiguredEmailProvider();
  if (!provider) {
    return { attempted: false, success: false, error: "Kein E-Mail-Provider konfiguriert." };
  }

  const result = await provider.send(message);
  return { attempted: true, success: result.success, provider: provider.id, error: result.error };
}
