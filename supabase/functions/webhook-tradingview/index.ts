import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 2 TradingView-Integration (Feasibility-Review vom 29.08.2026):
// nimmt externe Pine-Script-Alerts von TradingView Pro per Webhook entgegen
// und speichert sie in tradingview_signals (Migration
// add_tradingview_signals_table). Bewusst eine eigenstaendige Edge Function
// (verify_jwt=false bei Deploy) statt einer Next.js-API-Route -- ein
// internetseitig offener Webhook haette sonst in lib/authGate.ts's
// PUBLIC_EXACT_PATHS aufgenommen werden und damit proxy.ts's Auth-Gate an
// einer neuen Stelle aufgeweicht werden muessen (siehe
// docs/research/INSTITUTIONAL_COMPARE.md-Feasibility-Review). Eigene
// Sicherheit ueber ein geteiltes Secret statt eines JWT.
//
// WICHTIG: Dieses Signal fliesst NICHT in compute-market-state (14-
// Faktoren-Engine) ein und veraendert weder Score noch Confidence noch
// Regime -- die Backtest-Ground-Truth (PHASE-0-RECONCILIATION.md
// Abschnitt 17) bleibt unberuehrt. Ausschliesslich ein eigenstaendiges,
// informatives Kontext-Badge im Dashboard (siehe RegimeMatrixCard.tsx).
//
// Die folgenden Hilfsfunktionen sind bewusst 1:1 identisch zu
// lib/webhookTradingView.ts im Next.js-Repo (dort unit-getestet) --
// Edge Functions leben ausschliesslich in Supabase, koennen das Next.js-
// Repo also nicht importieren. Bei Aenderungen an einer Seite muss die
// andere manuell nachgezogen werden.

const REQUIRED_WEBHOOK_STRING_FIELDS = ["ticker", "signal_type"] as const;

function isValidWebhookSecret(provided: string | null, expected: string | null): boolean {
  if (!expected) return false;
  if (!provided) return false;
  return provided === expected;
}

function resolveProvidedSecret(headerSecret: string | null, bodySecret: unknown): string | null {
  if (headerSecret) return headerSecret;
  return typeof bodySecret === "string" ? bodySecret : null;
}

interface WebhookFieldValidationResult {
  valid: boolean;
  missingField: string | null;
}

function validateRequiredWebhookFields(body: Record<string, unknown>): WebhookFieldValidationResult {
  for (const field of REQUIRED_WEBHOOK_STRING_FIELDS) {
    const value = body[field];
    if (typeof value !== "string" || value.length === 0) {
      return { valid: false, missingField: field };
    }
  }
  return { valid: true, missingField: null };
}

function stripSecretFromWebhookPayload(body: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...body };
  delete rest.secret;
  return rest;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Nur POST erlaubt." }, 405);
  }

  // Fehlende Server-Konfiguration ist ein Betriebsfehler (500), keine
  // Authentifizierungs-Ablehnung (401) -- dieselbe Unterscheidung wie in
  // proxy.ts bei fehlenden Supabase-Auth-Env-Vars.
  const expectedSecret = Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET") ?? null;
  if (!expectedSecret) {
    return jsonResponse(
      { success: false, error: "Webhook serverseitig nicht konfiguriert." },
      500
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Ungültiges JSON." }, 400);
  }

  const providedSecret = resolveProvidedSecret(req.headers.get("X-Webhook-Secret"), body.secret);
  if (!isValidWebhookSecret(providedSecret, expectedSecret)) {
    return jsonResponse({ success: false, error: "Nicht authentifiziert." }, 401);
  }

  const fieldCheck = validateRequiredWebhookFields(body);
  if (!fieldCheck.valid) {
    return jsonResponse(
      { success: false, error: `Feld "${fieldCheck.missingField}" fehlt oder ist kein nicht-leerer String.` },
      400
    );
  }

  const timeframe = typeof body.timeframe === "string" ? body.timeframe : null;

  // Das Secret wird NIE mitgespeichert -- tradingview_signals ist oeffentlich
  // lesbar (RLS "Public read access", wie alle anderen Marktdaten-Tabellen),
  // ein im Payload gespeichertes Secret waere sonst fuer jeden Dashboard-
  // Nutzer einsehbar und wuerde die gesamte Secret-Pruefung aushebeln.
  const payloadWithoutSecret = stripSecretFromWebhookPayload(body);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase.from("tradingview_signals").insert({
    ticker: body.ticker,
    signal_type: body.signal_type,
    timeframe,
    payload: payloadWithoutSecret,
  });

  if (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  return jsonResponse({ success: true }, 200);
});
