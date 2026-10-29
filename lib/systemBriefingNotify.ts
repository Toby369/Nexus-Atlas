import { sendReportEmail } from "@/lib/email";
import { sendReportPush } from "@/lib/push";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { splitLeadSentence } from "@/lib/briefingText";
import { buildBriefingPush, withBtcPrefix } from "@/lib/briefingPush";
import type { ZoneLevel } from "@/lib/zones";
import type { SystemBriefingResult, SystemBriefingScenario } from "@/lib/types";

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

// Aufbau wie ein BTC-Marktbericht-Newsletter: gruene Abschnitts-Titel,
// jeder Abschnitt beginnt mit einem fetten Kernsatz (splitLeadSentence).
function section(title: string, body: string): string {
  return (
    `<div style="margin:24px 0 0;"><p style="margin:0 0 10px;text-align:center;color:#16a34a;font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(title)}</p>` +
    body +
    `</div>`
  );
}

function leadParagraph(text: string): string {
  const { lead, rest } = splitLeadSentence(text);
  return (
    `<p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 12px;">` +
    `<strong style="color:#111827;">${escapeHtml(lead)}</strong>` +
    (rest ? ` ${escapeHtml(rest)}` : "") +
    `</p>`
  );
}

function formatPrice(value: number): string {
  return `${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })} USD`;
}

function scenarioHtml(s: SystemBriefingScenario, label: string, color: string): string {
  const parts: string[] = [];
  if (s.text?.trim()) parts.push(leadParagraph(s.text));
  else if (s.bedingungen.length > 0 || s.kursziel !== null) {
    parts.push(`<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:${color};">${escapeHtml(label)}</p>`);
  }
  if (s.bedingungen.length > 0) {
    parts.push(
      `<ul style="margin:0 0 8px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">` +
        s.bedingungen.map((b) => `<li>${escapeHtml(b)}</li>`).join("") +
        `</ul>`
    );
  }
  if (s.kursziel !== null) {
    parts.push(`<p style="margin:0 0 12px;font-size:14px;color:${color};">Kursziel: <strong>${escapeHtml(formatPrice(s.kursziel))}</strong></p>`);
  }
  return parts.join("");
}

export function buildBriefingEmailHtml(result: SystemBriefingResult): string {
  const style = BIAS_STYLE[result.fazit.bias] ?? BIAS_STYLE.neutral;
  const optional = (title: string, text: string | null | undefined) => (text ? section(title, leadParagraph(text)) : "");

  const fazit =
    `<div style="margin:0 0 4px;padding:14px 16px;background:#f9fafb;border-radius:8px;">` +
    `<div style="margin:0 0 8px;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;` +
    `background:${style.bg};color:${style.fg};font-weight:600;font-size:13px;">${escapeHtml(style.label)}</span>` +
    `<span style="margin-left:10px;color:#6b7280;font-size:13px;">Briefing-Überzeugungsgrad ${Math.round(result.fazit.confidence)}/100</span></div>` +
    `<p style="font-size:15px;line-height:1.5;color:#111827;margin:0;">${escapeHtml(result.fazit.kernaussage)}</p>` +
    (result.aenderungSeitLetztem
      ? `<p style="font-size:13px;line-height:1.5;color:#6b7280;margin:8px 0 0;font-style:italic;">Seit dem letzten Lauf: ${escapeHtml(result.aenderungSeitLetztem)}</p>`
      : "") +
    `</div>`;

  const regelwerk = result.regelwerkCheck
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      return idx === -1
        ? `<li>${escapeHtml(line)}</li>`
        : `<li><strong>${escapeHtml(line.slice(0, idx))}:</strong>${escapeHtml(line.slice(idx + 1))}</li>`;
    })
    .join("");

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">` +
    `<div style="padding:20px 24px;background:#111827;border-radius:12px 12px 0 0;">` +
    `<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">NEXUS Atlas · BTC-Marktbericht</p>` +
    `<h1 style="margin:6px 0 0;color:#fff;font-size:20px;line-height:1.3;">${escapeHtml(result.schlagzeile ?? "System-Briefing")}</h1></div>` +
    `<div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">` +
    fazit +
    optional("Marktupdate", result.marktupdate) +
    optional("Momentum (RSI)", result.momentum) +
    section(
      "Bitcoin Chart",
      leadParagraph(result.chartStruktur) +
        scenarioHtml(result.trigger.bullish, "Bullisches Szenario", "#16a34a") +
        scenarioHtml(result.trigger.bearish, "Bärisches Szenario", "#dc2626") +
        `<p style="margin:0;color:#6b7280;font-size:13px;">Ungültig wenn: ${escapeHtml(result.trigger.invalidierung)}</p>`
    ) +
    optional("Liquidationen", result.liquidationen) +
    optional("Bitcoin ETF-Flows", result.etfFlows) +
    optional("Wirtschaftskalender", result.wirtschaftskalender) +
    optional("Widerspruch", result.konfluenzCheck) +
    section("Dein Regelwerk", `<ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">${regelwerk}</ul>`) +
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;">Automatisch generiert von NEXUS Atlas · Entscheidungsunterstützung, keine Anlageberatung</p>` +
    `</div></div>`
  );
}

async function sameAsLastBriefingPush(body: string): Promise<boolean> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("push_messages")
      .select("body")
      .eq("kind", "briefing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.body === body;
  } catch {
    return false;
  }
}

export interface BriefingNotifySettings {
  email_enabled: boolean;
  push_enabled: boolean;
}

export async function notifyBriefing(
  result: SystemBriefingResult,
  settings: BriefingNotifySettings,
  // Kurs und Keylevels aus dem Briefing-Kontext -- daraus baut Nexus den Push-Text selbst.
  market: { kurs: number | null; levels: ZoneLevel[] } = { kurs: null, levels: [] }
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
        subject: result.schlagzeile
          ? withBtcPrefix(result.schlagzeile)
          : `NEXUS Atlas · System-Briefing (${BIAS_STYLE[result.fazit.bias]?.label ?? result.fazit.bias})`,
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
    const { title, body } = buildBriefingPush({
      kurs: market.kurs,
      levels: market.levels,
      bias: result.fazit.bias,
      schlagzeile: result.schlagzeile ?? null,
      kernaussage: result.fazit.kernaussage,
    });
    // Weniger Rauschen (Toby 29.10.2026): Push nur, wenn sich Zonen oder Plan
    // seit der letzten Briefing-Push geaendert haben (der Kurs im Titel zaehlt nicht).
    if (await sameAsLastBriefingPush(body)) {
      console.info("System-Briefing: Plan unveraendert, Push uebersprungen.");
      return { emailSent, pushSent };
    }
    const pushResult = await sendReportPush({ title, body, url: "/", kind: "briefing" });
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
