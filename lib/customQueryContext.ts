// Kontext-Builder fuer die Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026:
// "kann ich eine Kachel haben, in der ich KI konkreter Auftrag geben
// kann?"). Bewusst KEIN eigener, neuer Marktdaten-Ausschnitt -- nutzt exakt
// denselben strukturierten FullMarketContext wie die grosse Report-Engine
// (lib/reportContext.ts), damit die freie Anfrage auf denselben validierten
// Daten basiert statt einer zweiten, abweichenden Definition.
//
// Server-only (nutzt buildMarketContext, das wiederum Supabase direkt
// nutzt) -- niemals aus einer "use client" Komponente importieren.

import { buildMarketContext } from "./reportContext";
import { DEFAULT_TIMEFRAME } from "./timeframes";

const MAX_PROMPT_LENGTH = 2000;

export interface CustomQueryContext {
  userTask: string;
  marketData: Awaited<ReturnType<typeof buildMarketContext>>;
}

/**
 * Baut den Kontext fuer eine freie Nutzeranfrage: der Marktkontext im
 * Default-Zeitraum (4H, dieselbe App-weite Voreinstellung) + die Aufgabe des
 * Nutzers als klar getrenntes Feld -- die KI soll nie verwechseln, was
 * validierte Nexus-Daten sind und was Nutzer-Freitext ist.
 */
export async function buildCustomQueryContext(prompt: string): Promise<CustomQueryContext> {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    throw new Error("customQueryContext: leere Anfrage.");
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `customQueryContext: Anfrage zu lang (${trimmed.length} Zeichen, Limit ${MAX_PROMPT_LENGTH}).`
    );
  }

  const marketData = await buildMarketContext(DEFAULT_TIMEFRAME);

  return { userTask: trimmed, marketData };
}
