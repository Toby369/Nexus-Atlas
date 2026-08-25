// Provider-unabhaengige E-Mail-Abstraktion (Vorgabe Teil U). Business-Logik
// (z.B. app/api/reports/run/route.ts) ruft ausschliesslich sendReportEmail()
// aus lib/email/index.ts auf und kennt keinen konkreten Anbieter -- Resend
// ist nur EIN moeglicher Kandidat, nicht fest in die Report-Logik verdrahtet.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface EmailProvider {
  readonly id: string;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
