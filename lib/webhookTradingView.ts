// Phase 2 TradingView-Integration: reine, testbare Referenz-Implementierung
// der Parsing-/Secret-Validierungslogik der webhook-tradingview Edge
// Function. Edge Functions leben ausschliesslich im Supabase-Projekt
// (Deno-Runtime, per Supabase-MCP deployed), nicht in diesem Next.js-Repo
// -- dieses Modul ist deshalb die getestete Referenz fuer das, was die
// deployte Funktion tut; bei Aenderungen an einer Seite muss die andere
// manuell nachgezogen werden (dieselbe bewusste Duplizierung wie zwischen
// compute-market-state und research-python/src/features/legacy_factors.py
// -- dort unabhaengig reimplementiert und per Golden-Value-Test
// abgeglichen, hier stattdessen 1:1 dieselbe Logik).

export const REQUIRED_WEBHOOK_STRING_FIELDS = ["ticker", "signal_type"] as const;

// null als "expected" (Server nicht konfiguriert) ist NIE gueltig, auch
// nicht bei provided === null -- verhindert, dass ein unkonfigurierter
// Server (TRADINGVIEW_WEBHOOK_SECRET fehlt) versehentlich jede Anfrage
// akzeptiert, nur weil beide Seiten "leer" sind.
export function isValidWebhookSecret(
  provided: string | null,
  expected: string | null
): boolean {
  if (!expected) return false;
  if (!provided) return false;
  return provided === expected;
}

// TradingView-Alerts erlauben keine benutzerdefinierten Header (nur die
// Alert-Message ist konfigurierbar) -- das Secret kommt deshalb primaer im
// Body an; ein Header wird zusaetzlich unterstuetzt (z.B. fuer manuelle
// Tests), Header hat Vorrang, falls beide gesetzt sind.
export function resolveProvidedSecret(
  headerSecret: string | null,
  bodySecret: unknown
): string | null {
  if (headerSecret) return headerSecret;
  return typeof bodySecret === "string" ? bodySecret : null;
}

export interface WebhookFieldValidationResult {
  valid: boolean;
  missingField: string | null;
}

// Prueft die Pflichtfelder (ticker, signal_type) -- muessen nicht-leere
// Strings sein, kein erfundener Default bei Fehlen.
export function validateRequiredWebhookFields(
  body: Record<string, unknown>
): WebhookFieldValidationResult {
  for (const field of REQUIRED_WEBHOOK_STRING_FIELDS) {
    const value = body[field];
    if (typeof value !== "string" || value.length === 0) {
      return { valid: false, missingField: field };
    }
  }
  return { valid: true, missingField: null };
}

// Entfernt "secret" aus dem Body, bevor er als payload gespeichert wird --
// tradingview_signals ist oeffentlich lesbar (RLS "Public read access",
// wie alle anderen Marktdaten-Tabellen), ein mitgespeichertes Secret waere
// fuer jeden Dashboard-Nutzer einsehbar und wuerde die gesamte Pruefung
// aushebeln.
export function stripSecretFromWebhookPayload(
  body: Record<string, unknown>
): Record<string, unknown> {
  const rest = { ...body };
  delete rest.secret;
  return rest;
}
