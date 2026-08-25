import type { EmailMessage, EmailProvider, EmailSendResult } from "../types";

// Resend (https://resend.com) -- ein moeglicher Free-Tier-Kandidat fuer den
// Report-E-Mail-Versand (Vorgabe Teil U). Bewusst NICHT in die Business-
// Logik verdrahtet: app/api/reports/run/route.ts kennt nur das
// EmailProvider-Interface (lib/email/types.ts) ueber sendReportEmail(),
// nicht diese Datei direkt. Raw fetch statt SDK, analog zu
// lib/ai/providers/openaiCompatible.ts -- keine zusaetzliche Abhaengigkeit
// fuer einen einzelnen REST-Call.
export const resendProvider: EmailProvider = {
  id: "resend",

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.REPORT_EMAIL_FROM);
  },

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.REPORT_EMAIL_FROM;

    if (!apiKey || !from) {
      return {
        success: false,
        error: "resend: RESEND_API_KEY oder REPORT_EMAIL_FROM nicht gesetzt.",
      };
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { success: false, error: `resend: HTTP ${res.status} – ${errText.slice(0, 300)}` };
      }

      const json = await res.json();
      return { success: true, id: typeof json?.id === "string" ? json.id : undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
