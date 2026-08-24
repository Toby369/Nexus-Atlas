// Zentrale Typen fuer den NEXUS AI Router.
//
// WICHTIG: Dateien unter lib/ai/** duerfen NIEMALS von einer "use client"
// Komponente importiert werden. Sie enthalten (potenziell) API-Key-Zugriffe
// ueber process.env und sind ausschliesslich fuer Server-Code (Route
// Handlers, Server Components) gedacht.

export type AIProviderId =
  | "openai"
  | "anthropic"
  | "xai"
  | "google"
  | "deepseek"
  | "perplexity";

export interface AIGenerateOptions {
  /** Ueberschreibt das Default-Modell des Providers fuer diesen Call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Zusaetzliche System-Instruktion, wird mit dem Prompt-Profile-Prompt kombiniert. */
  systemPrompt?: string;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AIStructuredResult<T = unknown> {
  provider: AIProviderId;
  model: string;
  /** Geparste, strukturierte Antwort. */
  data: T;
  /** Rohtext der Antwort, fuer Debugging/Logging. */
  raw: string;
  usage?: AIUsage;
}

export interface AIProvider {
  readonly id: AIProviderId;
  /**
   * Ob der Provider aktuell nutzbar ist (z.B. API-Key als Env-Var gesetzt).
   * Der Router prueft dies VOR jedem Call, damit ein fehlender Key nicht
   * erst mitten in einer Anfrage als Fehler auftaucht.
   */
  isConfigured(): boolean;
  /** Freitext-Generierung. */
  generate(prompt: string, options?: AIGenerateOptions): Promise<string>;
  /**
   * Generierung mit Erwartung eines JSON-Objekts als Antwort. Der Provider
   * instruiert das Modell, ausschliesslich JSON zurueckzugeben, und parsed
   * das Ergebnis. Wirft einen Fehler, wenn die Antwort kein valides JSON ist.
   */
  generateStructured<T = unknown>(
    prompt: string,
    options?: AIGenerateOptions
  ): Promise<AIStructuredResult<T>>;
}

/** Grobe Kategorie einer Analyseaufgabe, fuer die "Auto"-Providerwahl. */
export type PromptProfileCategory =
  | "market-mechanics" // Grok-Domaene: OI, Funding, Marktstruktur
  | "research" // Perplexity-Domaene: News, Makro, externe Quellen
  | "orchestration" // ChatGPT-Domaene: Gesamtanalyse, Entscheidungslogik
  | "signal-logic"; // Claude/DeepSeek-Domaene: Logik-/Signal-Review

export interface PromptProfile {
  id: string;
  category: PromptProfileCategory;
  /** Kurzbeschreibung, wofuer dieses Profile gedacht ist. */
  description: string;
  /** System-Prompt, der dem Modell die Aufgabe und das erwartete JSON-Schema erklaert. */
  systemPrompt: string;
  /**
   * Prueft, ob die geparste JSON-Antwort dem im systemPrompt beschriebenen
   * Schema entspricht (z.B. "bias" nur bullish|bearish|neutral, "confidence"
   * eine Zahl 0-100). Gibt eine Liste von Fehlermeldungen zurueck, leeres
   * Array = gueltig. Der Router behandelt eine nicht-leere Liste wie einen
   * Provider-Fehler und wechselt zum naechsten Fallback-Provider -- ein
   * Modell, das zwar valides JSON aber die falsche Form liefert, ist fuer
   * die Kachel genauso unbrauchbar wie ein HTTP-Fehler.
   */
  validate?: (data: unknown) => string[];
}

export interface TileAIConfig {
  tileId: string;
  /** "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden. */
  aiProvider: AIProviderId | "auto";
  /** Optional: Modell-Override, sonst Provider-Default. */
  aiModel?: string;
  promptProfile: string;
  /** Reihenfolge der Fallback-Provider, falls der primaere Provider fehlschlaegt. */
  fallbackProviders?: AIProviderId[];
}
