import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { providerRegistry } from "@/lib/ai/providers";
import type { AIProviderId } from "@/lib/ai/types";
import type { ReportConfig, ReportRun } from "@/lib/types";
import ReportEngineDashboard, {
  type ProviderOption,
  type ReportSlotData,
} from "@/components/ReportEngineDashboard";
import LogoutButton from "@/components/LogoutButton";

export const revalidate = 0;

const PROVIDER_LABELS: Record<AIProviderId, string> = {
  google: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  xai: "xAI Grok",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};

// isConfigured() liest process.env und darf daher nur serverseitig laufen
// (siehe Kommentar in lib/ai/types.ts: lib/ai/** niemals aus "use client"
// importieren). Hier in der Server Component ausgewertet und nur als
// einfache, client-sichere Daten (Boolean) an die Dashboard-Komponente
// gereicht -- kein Key verlaesst je den Server (Vorgabe Teil V).
function getProviderOptions(): ProviderOption[] {
  return (Object.keys(providerRegistry) as AIProviderId[])
    .map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      configured: providerRegistry[id].isConfigured(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getReportConfigs(): Promise<ReportConfig[]> {
  const { data, error } = await supabase.from("report_configs").select("*").order("slot");
  if (error) {
    console.error("Fehler beim Laden der Report-Konfiguration:", error.message);
    return [];
  }
  return data ?? [];
}

async function getLatestRun(configId: number): Promise<ReportRun | null> {
  const { data, error } = await supabase
    .from("report_runs")
    .select("*")
    .eq("report_config_id", configId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`Fehler beim Laden des letzten Laufs (config ${configId}):`, error.message);
    return null;
  }
  return data;
}

export default async function ReportsPage() {
  const configs = await getReportConfigs();
  const lastRuns = await Promise.all(configs.map((c) => getLatestRun(c.id)));

  const slots: ReportSlotData[] = configs.map((config, i) => ({
    config,
    lastRun: lastRuns[i],
  }));

  const providerOptions = getProviderOptions();
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-6 py-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
          <h1 className="text-lg font-semibold text-text mt-1">AI Report Engine</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            ← Dashboard
          </Link>
          <Link
            href="/account"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            Konto
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="flex-1 px-4 sm:px-6 py-8 max-w-3xl w-full mx-auto">
        {slots.length === 0 ? (
          <p className="text-sm text-text-faint">
            Keine Report-Konfiguration gefunden. Die report_configs-Tabelle sollte 4 Zeilen
            (Slot 1-4) enthalten.
          </p>
        ) : (
          <ReportEngineDashboard
            initialSlots={slots}
            providerOptions={providerOptions}
            serviceRoleConfigured={serviceRoleConfigured}
          />
        )}
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
