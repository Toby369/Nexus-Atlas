import { sendReportEmail } from "@/lib/email";
import { sendReportPush } from "@/lib/push";
import type { SystemBriefingResult } from "@/lib/types";

// E-Mail und Push nach einem erfolgreichen System-Briefing (uebernommen vom
// frueheren Master-Report der AI Report Engine). Beides ist optional
// (system_briefing_config.email_enabled/push_enabled) und blockiert den Lauf
// nie: Fehler landen nur im Log, das Ergebnis meldet, was verschickt wurde.

// Alle KI-generierten Strings MUESSEN escapeHtml() durchlaufen: ein String
// wie "<img src=x onerror=...>" waere im Mail-Client sonst als Markup
// interpretierbar.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BIAS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  bullish: { bg: "#e7f7ee", fg: "#16a34a", label: "Bullisch" },
  bearish: { bg: "#fdecec", fg: "#dc2626", label: "Bärisch" },
  neutral: { bg: "#f1f2f4", fg: "#6b7280", label: "Neutral" },
};

function section(title: string, body: string): string {
  return (
    `<div style="margin:0 0 16px;"><p style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin:0 0 6px;">${escapeHtml(title)}</p>` +
    body +
    `</div>`
  );
}

function paragraph(text: string): string {
  return `<p style="font-size:14px;line-height:1.6;color:#374151;margin:0;white-space:pre-line;">${escapeHtml(text)}</p>`;
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

export function buildBriefingEmailHtml(result: SystemBriefingResult): string {
  const style = BIAS_STYLE[result.fazit.bias] ?? BIAS_STYLE.neutral;
  const biasSection =
    `<div style="margin:0 0 16px;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;` +
    `background:${style.bg};color:${style.fg};font-weight:600;font-size:13px;">${escapeHtml(style.label)}</span>` +
    `<span style="margin-left:10px;color:#6b7280;font-size:13px;">Briefing-Überzeugungsgrad ${Math.round(result.fazit.confidence)}/100</span></div>`;

  const kernaussage = `<p style="font-size:15px;line-height:1.5;color:#111827;margin:0 0 16px;">${escapeHtml(result.fazit.kernaussage)}</p>`;

  const aenderung = result.aenderungSeitLetztem
    ? `<p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0 0 16px;font-style:italic;">Seit dem letzten Lauf: ${escapeHtml(result.aenderungSeitLetztem)}</p>`
    : "";

  const konfluenz = result.konfluenzCheck
    ? `<div style="margin:0 0 16px;padding:12px 14px;background:#fef3e2;border-radius:8px;">` +
      `<p style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#d97706;margin:0 0 6px;font-weight:600;">Widerspruch</p>` +
      `<p style="margin:0;color:#78350f;font-size:14px;line-height:1.6;">${escapeHtml(result.konfluenzCheck)}</p></div>`
    : "";

  const scenario = (label: string, s: SystemBriefingResult["trigger"]["bullish"]) =>
    `<p style="font-size:14px;color:#111827;margin:0 0 4px;font-weight:600;">${escapeHtml(label)}` +
    (s.kursziel !== null ? ` · Kursziel ${escapeHtml(formatPrice(s.kursziel))}` : "") +
    `</p>` +
    (s.bedingungen.length > 0
      ? `<ul style="margin:0 0 8px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">` +
        s.bedingungen.map((b) => `<li>${escapeHtml(b)}</li>`).join("") +
        `</ul>`
      : `<p style="margin:0 0 8px;color:#9ca3af;font-size:13px;">Kein plausibles Szenario ableitbar.</p>`);

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">` +
    `<div style="padding:20px 24px;background:#111827;border-radius:12px 12px 0 0;">` +
    `<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">NEXUS Atlas</p>` +
    `<h1 style="margin:4px 0 0;color:#fff;font-size:18px;">System-Briefing</h1></div>` +
    `<div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">` +
    biasSection +
    kernaussage +
    aenderung +
    konfluenz +
    section("Regelwerk-Check", paragraph(result.regelwerkCheck)) +
    section("Chart-Struktur", paragraph(result.chartStruktur)) +
    section(
      "Trigger & Szenario",
      scenario("Bullisches Szenario", result.trigger.bullish) +
        scenario("Bärisches Szenario", result.trigger.bearish) +
        `<p style="margin:0;color:#6b7280;font-size:13px;">Ungültig wenn: ${escapeHtml(result.trigger.invalidierung)}</p>`
    ) +
    `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;">Automatisch generiert von NEXUS Atlas · Entscheidungsunterstützung, keine Anlageberatung</p>` +
    `</div></div>`
  );
}

export interface BriefingNotifySettings {
  email_enabled: boolean;
  push_enabled: boolean;
}

export async function notifyBriefing(
  result: SystemBriefingResult,
  settings: BriefingNotifySettings
): Promise<{ emailSent: boolean; pushSent: boolean }> {
  let emailSent = false;
  let pushSent = false;

  if (settings.email_enabled) {
    const to = process.env.REPORT_EMAIL_TO;
    if (!to) {
      console.warn("System-Briefing: email_enabled ist an, aber REPORT_EMAIL_TO ist nicht gesetzt -- Versand uebersprungen.");
    } else {
      const emailResult = await sendReportEmail({
        to,
        subject: `NEXUS Atlas · System-Briefing (${BIAS_STYLE[result.fazit.bias]?.label ?? result.fazit.bias})`,
        html: buildBriefingEmailHtml(result),
      });
      if (!emailResult.attempted) {
        console.warn("System-Briefing: kein E-Mail-Provider konfiguriert, Versand uebersprungen.");
      } else if (!emailResult.success) {
        console.error(`System-Briefing: E-Mail-Versand fehlgeschlagen: ${emailResult.error}`);
      } else {
        emailSent = true;
      }
    }
  }

  if (settings.push_enabled) {
    const pushResult = await sendReportPush({
      title: "NEXUS Atlas · System-Briefing",
      body: result.fazit.kernaussage,
      url: "/",
    });
    if (!pushResult.attempted) {
      console.warn(`System-Briefing: Push konnte nicht versucht werden: ${pushResult.error}`);
    } else if (!pushResult.success) {
      console.error(`System-Briefing: Push-Versand fehlgeschlagen: ${pushResult.error}`);
    } else {
      pushSent = true;
    }
  }

  return { emailSent, pushSent };
}
