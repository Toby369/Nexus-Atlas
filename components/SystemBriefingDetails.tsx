import type { SystemBriefingResult } from "@/lib/types";

// Details des System-Briefings im Lagebild (HeroHeader, Aufklapper unter der
// KI-Einordnung): Regelwerk-Check (max. 4 gelabelte Zeilen, siehe
// parseRegelwerkLines), Chart-Struktur, optionaler Konfluenz-Check (nur bei
// Widerspruch) und Trigger & Szenario mit beiden Richtungen inkl. konkretem
// Kursziel. Das Fazit selbst zeigt HeroHeader direkt. Kontext/Prompts siehe
// lib/systemBriefingContext.ts und lib/ai/promptProfiles.ts.

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function ScenarioBlock({
  label,
  scenario,
  tone,
}: {
  label: string;
  scenario: { bedingungen: string[]; kursziel: number | null };
  tone: "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-up" : "text-down";
  if (scenario.bedingungen.length === 0 && scenario.kursziel === null) {
    return (
      <div className="rounded-md border border-border/60 p-2.5 space-y-1">
        <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
        <p className="text-xs text-text-faint">Kein plausibles Szenario aus der aktuellen Lage ableitbar.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1">
      <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
      {scenario.bedingungen.length > 0 && (
        <ul className="space-y-1 text-xs text-text-muted list-disc list-inside">
          {scenario.bedingungen.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {scenario.kursziel !== null && (
        <p className="text-xs text-text">
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
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Regelwerk-Check</p>
        <ul className="space-y-1">
          {parseRegelwerkLines(result.regelwerkCheck).map(({ label, detail }, i) => (
            <li key={i} className="text-sm text-text-muted leading-relaxed">
              {label && <span className="text-text font-medium">{label}: </span>}
              {detail}
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Chart-Struktur</p>
        <p className="text-sm text-text-muted leading-relaxed">{result.chartStruktur}</p>
      </div>

      {result.konfluenzCheck && (
        <div className="pt-2 border-t border-border/60 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Konfluenz-Check</p>
          <p className="text-sm text-text-muted leading-relaxed">{result.konfluenzCheck}</p>
        </div>
      )}

      <div className="pt-2 border-t border-border/60 space-y-1.5">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Trigger &amp; Szenario</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
          <ScenarioBlock label="Bullisches Szenario" scenario={result.trigger.bullish} tone="up" />
          <ScenarioBlock label="Bärisches Szenario" scenario={result.trigger.bearish} tone="down" />
        </div>
        <p className="text-xs text-text-faint">Ungültig wenn: {result.trigger.invalidierung}</p>
      </div>

      <p className="text-xs text-text-faint">
        Entscheidungsunterstützung anhand deines eigenen Regelwerks, keine automatisierte Anlageberatung.
      </p>
    </div>
  );
}
