import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { QuizCard, QuizProgressRow } from "@/lib/types";
import LernenDashboard from "@/components/LernenDashboard";
import LogoutButton from "@/components/LogoutButton";

export const revalidate = 0;

async function getCards(): Promise<QuizCard[]> {
  const { data, error } = await supabase.from("quiz_cards").select("*").order("id");
  if (error) {
    console.error("Fehler beim Laden der Lernkarten:", error.message);
    return [];
  }
  return data ?? [];
}

async function getProgress(): Promise<QuizProgressRow[]> {
  const { data, error } = await supabase.from("quiz_progress").select("*");
  if (error) {
    console.error("Fehler beim Laden des Lernfortschritts:", error.message);
    return [];
  }
  return data ?? [];
}

export default async function LernenPage() {
  const [cards, progress] = await Promise.all([getCards(), getProgress()]);

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-6 py-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
          <h1 className="text-lg font-semibold text-text mt-1">Lernplattform</h1>
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
        <LernenDashboard initialCards={cards} initialProgress={progress} />
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
