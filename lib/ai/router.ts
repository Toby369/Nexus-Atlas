import type {
  AIProviderId,
  AIStructuredResult,
  PromptProfileCategory,
} from "./types";
import { getProvider } from "./providers";
import { getPromptProfile } from "./promptProfiles";
import { getTileConfig } from "./tileConfig";

// Der NEXUS AI Router ist der EINZIGE Ort, an dem eine Kachel mit einem AI
// Provider in Verbindung kommt:
//
//   Dashboard-Kachel -> runTileAnalysis(tileId, context) -> Router
//     -> Provider-Auswahl (Config oder "auto")
//     -> Prompt Profile laden
//     -> Kontext einsetzen
//     -> Provider aufrufen (mit Fallback-Kette bei Fehlern)
//     -> strukturierte Antwort zurueckgeben
//
// Eine Kachel importiert NIEMALS einen Provider direkt.

// Default-Zuordnung fuer aiProvider: "auto", nach Prompt-Profile-Kategorie.
// Entspricht der Rollen-Doku (Abschnitt 12), ist aber austauschbar, ohne
// dass tileConfig.ts oder die Kacheln selbst angepasst werden muessten.
const AUTO_CATEGORY_PROVIDER: Record<PromptProfileCategory, AIProviderId> = {
  "market-mechanics": "xai", // Grok: Krypto-/Marktmechanik
  research: "perplexity", // Web Research, News, externe Quellen
  orchestration: "openai", // Gesamtanalyse, Entscheidungslogik
  "signal-logic": "anthropic", // Logik-/Signal-Review
};

function resolveProviderId(
  configuredProvider: AIProviderId | "auto",
  category: PromptProfileCategory
): AIProviderId {
  if (configuredProvider !== "auto") return configuredProvider;
  return AUTO_CATEGORY_PROVIDER[category];
}

export interface RunTileAnalysisOptions {
  /** Zusaetzlicher, kachel-spezifischer Kontext (z.B. Marktdaten als Text/JSON). */
  context: string;
  /** Override der Provider-Kette, falls die Tile-Config-Defaults nicht greifen sollen. */
  providerOverride?: AIProviderId;
}

export interface RunTileAnalysisResult<T = unknown> extends AIStructuredResult<T> {
  tileId: string;
  promptProfile: string;
  /** Provider, die vor dem erfolgreichen Call fehlgeschlagen sind (leer = erster Versuch erfolgreich). */
  attemptedProviders: AIProviderId[];
}

/**
 * Fuehrt die AI-Analyse fuer eine Kachel aus: Config laden, Prompt Profile
 * laden, Provider (inkl. Fallback-Kette) aufrufen, strukturiertes Ergebnis
 * zurueckgeben.
 *
 * Wirft einen Fehler, wenn primaerer Provider UND alle Fallbacks fehlschlagen
 * oder nicht konfiguriert sind.
 */
export async function runTileAnalysis<T = unknown>(
  tileId: string,
  options: RunTileAnalysisOptions
): Promise<RunTileAnalysisResult<T>> {
  const tileConfig = getTileConfig(tileId);
  const profile = getPromptProfile(tileConfig.promptProfile);

  const primaryProviderId =
    options.providerOverride ??
    resolveProviderId(tileConfig.aiProvider, profile.category);

  const providerChain: AIProviderId[] = [
    primaryProviderId,
    ...(tileConfig.fallbackProviders ?? []).filter((p) => p !== primaryProviderId),
  ];

  const attempted: AIProviderId[] = [];
  let lastError: unknown;

  for (const providerId of providerChain) {
    const provider = getProvider(providerId);

    if (!provider.isConfigured()) {
      attempted.push(providerId);
      lastError = new Error(`${providerId}: nicht konfiguriert (kein API-Key gesetzt).`);
      continue;
    }

    try {
      const result = await provider.generateStructured<T>(options.context, {
        systemPrompt: profile.systemPrompt,
        // aiModel ist providerspezifisch (z.B. ein Grok-Modellstring) und
        // gilt daher nur fuer den primaeren Provider. Faellt die Kette auf
        // einen anderen Vendor zurueck, soll der dessen eigenen Default
        // nutzen statt mit einem fremden Modellnamen zu scheitern.
        model: providerId === primaryProviderId ? tileConfig.aiModel : undefined,
      });

      if (profile.validate) {
        const validationErrors = profile.validate(result.data);
        if (validationErrors.length > 0) {
          throw new Error(
            `${providerId}: Antwort entspricht nicht dem Schema von "${profile.id}": ${validationErrors.join(
              "; "
            )}`
          );
        }
      }

      return {
        ...result,
        tileId,
        promptProfile: profile.id,
        attemptedProviders: attempted,
      };
    } catch (err) {
      attempted.push(providerId);
      lastError = err;
      // Naechster Provider in der Kette wird versucht.
    }
  }

  const errorMessage =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `AI Router: alle Provider fuer Kachel "${tileId}" fehlgeschlagen (${attempted.join(
      " -> "
    )}). Letzter Fehler: ${errorMessage}`
  );
}
