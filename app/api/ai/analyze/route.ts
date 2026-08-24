import { NextRequest, NextResponse } from "next/server";
import { runTileAnalysis } from "@/lib/ai/router";
import type { AIProviderId } from "@/lib/ai/types";

// POST /api/ai/analyze
// Body: { tileId: string, context: string, providerOverride?: AIProviderId }
//
// Server-seitiger Einstiegspunkt fuer den NEXUS AI Router. Wird aktuell von
// KEINER bestehenden Dashboard-Kachel aufgerufen – das bestehende Dashboard
// (Preis/OI/Funding/Boersenvergleich/regelbasierte Markteinschaetzung)
// funktioniert unveraendert weiter.
//
// Sobald ein Provider-API-Key gesetzt ist (siehe lib/ai/providers/*.ts fuer
// die jeweilige Env-Var), kann dieser Endpoint fuer eine echte AI-Kachel
// genutzt werden, ohne dass der Router selbst angepasst werden muss.
//
// API-Keys werden ausschliesslich hier server-seitig via process.env
// gelesen – niemals im Client-Bundle.
export async function POST(req: NextRequest) {
  let body: {
    tileId?: string;
    context?: string;
    providerOverride?: AIProviderId;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  const { tileId, context, providerOverride } = body;

  if (!tileId || typeof tileId !== "string") {
    return NextResponse.json({ error: "Feld 'tileId' fehlt oder ist ungueltig." }, { status: 400 });
  }
  if (!context || typeof context !== "string") {
    return NextResponse.json({ error: "Feld 'context' fehlt oder ist ungueltig." }, { status: 400 });
  }

  try {
    const result = await runTileAnalysis(tileId, { context, providerOverride });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
