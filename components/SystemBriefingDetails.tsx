import type { SystemBriefingResult, SystemBriefingScenario } from "@/lib/types";
import { splitLeadSentence } from "@/lib/briefingText";

// Details des System-Briefings im Lagebild (HeroHeader, Aufklapper unter der
// KI-Einordnung), aufgebaut wie ein BTC-Marktbericht: Marktupdate, Momentum,
// Bitcoin Chart mit beiden Szenarien, Liquidationen, ETF-Flows,
// Wirtschaftskalender und zuletzt Tobys Regelwerk-Check. Jeder Abschnitt
// beginnt mit einem fett gesetzten Kernsatz. Schlagzeile und Fazit zeigt
// HeroHeader direkt. Snapshots von vor dem Umbau haben die Rahmen-Abschnitte
// nicht -- dann erscheinen nur Chart, Szenarien und Regelwerk.
// Kontext/Prompts: lib/systemBriefingContext.ts, lib/ai/promptProfiles.ts.

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function LeadText({ text }: { text: string }) {
  const { lead, rest } = splitLeadSentence(text);
  return (
    <p className="text-sm text-text-muted leading-relaxed">
      <span className="text-text font-semibold">{lead}</span>
      {rest && ` ${rest}`}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2 border-t border-border/60 space-y-1.5 first:pt-0 first:border-t-0">
      <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{title}</p>
      {children}
    </div>
  );
}

function Scenario({
  scenario,
  tone,
  fallbackLabel,
}: {
  scenario: SystemBriefingScenario;
  tone: "up" | "down";
  fallbackLabel: string;
}) {
  const hasText = !!scenario.text?.trim();
  if (!hasText && scenario.bedingungen.length === 0 && scenario.kursziel === null) return null;
  const toneClass = tone === "up" ? "text-up" : "text-down";
  return (
    <div className="space-y-1">
      {hasText ? (
        <LeadText text={scenario.text!} />
      ) : (
        <p className={`text-xs font-medium ${toneClass}`}>{fallbackLabel}</p>
      )}
      {scenario.bedingungen.length > 0 && (
        <ul className="space-y-0.5 text-xs text-text-muted list-disc list-inside">
          {scenario.bedingungen.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {scenario.kursziel !== null && (
        <p className={`text-xs ${toneClass}`}>
          Kursziel: <span className="font-semibold">{formatPrice(scenario.kursziel)}</span>
        </p>
      )}
    </div>
  );
}

// regelwerkCheck kommt als max. 4 Zeilen ("Label: Befund", durch \n
// getrennt) -- hier je Zeile in Label/Rest gesplittet, damit das Label fett
// vom Befund abgesetzt werden kann.
function parseRegelwerkLines(text: string): { label: string; detail: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIdx = line.indexOf(":");
      if (separatorIdx === -1) return { label: "", detail: line };
      return { label: line.slice(0, separatorIdx).trim(), detail: line.slice(separatorIdx + 1).trim() };
    });
}

// Schutz gegen Snapshots in aelteren Formaten (z.B. { narrative: string }
// oder ohne chartStruktur/trigger.bullish/trigger.bearish) -- ohne diesen
// Guard wuerde der Render unten die ganze Seite mitreissen.
export function isValidSystemBriefingResult(result: unknown): result is SystemBriefingResult {
  if (!result || typeof result !== "object") return false;
  const r = result as Partial<SystemBriefingResult>;
  return (
    !!r.fazit &&
    typeof r.fazit.bias === "string" &&
    typeof r.fazit.kernaussage === "string" &&
    typeof r.regelwerkCheck === "string" &&
    typeof r.chartStruktur === "string" &&
    !!r.trigger &&
    !!r.trigger.bullish &&
    Array.isArray(r.trigger.bullish.bedingungen) &&
    !!r.trigger.bearish &&
    Array.isArray(r.trigger.bearish.bedingungen) &&
    typeof r.trigger.invalidierung === "string"
  );
}

export default function SystemBriefingDetails({ result }: { result: SystemBriefingResult }) {
  return (
    <div className="space-y-3">
      {result.marktupdate && (
        <Section title="Marktupdate">
          <LeadText text={result.marktupdate} />
        </Section>
      )}
      {result.momentum && (
        <Section title="Momentum (RSI)">
          <LeadText text={result.momentum} />
        </Section>
      )}

      <Section title="Bitcoin Chart">
        <LeadText text={result.chartStruktur} />
        <Scenario scenario={result.trigger.bullish} tone="up" fallbackLabel="Bullisches Szenario" />
        <Scenario scenario={result.trigger.bearish} tone="down" fallbackLabel="Bärisches Szenario" />
        <p className="text-xs text-text-faint">Ungültig wenn: {result.trigger.invalidierung}</p>
      </Section>

      {result.liquidationen && (
        <Section title="Liquidationen">
          <LeadText text={result.liquidationen} />
        </Section>
      )}
      {result.etfFlows && (
        <Section title="Bitcoin ETF-Flows">
          <LeadText text={result.etfFlows} />
        </Section>
      )}
      {result.wirtschaftskalender && (
        <Section title="Wirtschaftskalender">
          <LeadText text={result.wirtschaftskalender} />
        </Section>
      )}

      {result.konfluenzCheck && (
        <Section title="Widerspruch">
          <LeadText text={result.konfluenzCheck} />
        </Section>
      )}

      <Section title="Dein Regelwerk">
        <ul className="space-y-1">
          {parseRegelwerkLines(result.regelwerkCheck).map(({ label, detail }, i) => (
            <li key={i} className="text-sm text-text-muted leading-relaxed">
              {label && <span className="text-text font-medium">{label}: </span>}
              {detail}
            </li>
          ))}
        </ul>
      </Section>

      <p className="text-xs text-text-faint">
        Entscheidungsunterstützung anhand deines eigenen Regelwerks, keine automatisierte Anlageberatung.
      </p>
    </div>
  );
}
