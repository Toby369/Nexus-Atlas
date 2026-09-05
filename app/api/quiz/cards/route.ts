import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Lernplattform-Kachel (Leitner-Karteikasten) -- CRUD fuer Lernkarten.
// Lesen laeuft direkt ueber den Anon-Key (quiz_cards hat "Public read
// access" wie alle anderen Marktdaten-Tabellen); Schreiben ausschliesslich
// hier ueber den Service-Role-Client, gleiches Muster wie
// /api/reports/config und /api/push/subscribe.

interface CardBody {
  id?: number;
  question?: string;
  answer?: string;
  explanation?: string | null;
  category?: string | null;
  active?: boolean;
}

function getAdminOrError(): { admin: ReturnType<typeof getSupabaseAdmin> } | { error: NextResponse } {
  try {
    return { admin: getSupabaseAdmin() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: NextResponse.json({ success: false, error: message }, { status: 500 }) };
  }
}

// POST /api/quiz/cards -- neue Karte anlegen.
export async function POST(req: NextRequest) {
  let body: CardBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  if (!body.question?.trim() || !body.answer?.trim()) {
    return NextResponse.json({ success: false, error: "question und answer sind erforderlich." }, { status: 400 });
  }

  const adminResult = getAdminOrError();
  if ("error" in adminResult) return adminResult.error;

  const { data, error } = await adminResult.admin
    .from("quiz_cards")
    .insert({
      question: body.question.trim(),
      answer: body.answer.trim(),
      explanation: body.explanation?.trim() || null,
      category: body.category?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, card: data });
}

// PUT /api/quiz/cards -- bestehende Karte bearbeiten.
export async function PUT(req: NextRequest) {
  let body: CardBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ success: false, error: "id ist erforderlich." }, { status: 400 });
  }

  const adminResult = getAdminOrError();
  if ("error" in adminResult) return adminResult.error;

  const update: Record<string, unknown> = {};
  if (body.question !== undefined) update.question = body.question.trim();
  if (body.answer !== undefined) update.answer = body.answer.trim();
  if (body.explanation !== undefined) update.explanation = body.explanation?.trim() || null;
  if (body.category !== undefined) update.category = body.category?.trim() || null;
  if (body.active !== undefined) update.active = body.active;

  const { data, error } = await adminResult.admin
    .from("quiz_cards")
    .update(update)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, card: data });
}

// DELETE /api/quiz/cards?id=123 -- Karte samt Fortschritt loeschen (on delete cascade).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Query-Parameter 'id' ist erforderlich." }, { status: 400 });
  }

  const adminResult = getAdminOrError();
  if ("error" in adminResult) return adminResult.error;

  const { error } = await adminResult.admin.from("quiz_cards").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
