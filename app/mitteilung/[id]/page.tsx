import Link from "next/link";
import { notFound } from "next/navigation";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import { getPushMessage, getRecentPushMessages } from "@/lib/pushMessages";
import { safeInternalLink, shortTitle } from "@/lib/pushMessageFormat";

// Erklaerung zu einer Push-Nachricht (Toby 15.10.2026: "wenn ich auf die
// Nachricht tippe, moechte ich eine kurze Erklaerung sehen! bei jeder push
// Nachricht"). Daten: lib/pushMessages.ts.

export const revalidate = 0;

const RECENT_LIMIT = 10;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MitteilungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [message, recent] = await Promise.all([getPushMessage(id), getRecentPushMessages(RECENT_LIMIT + 1)]);
  if (!message) notFound();

  const link = safeInternalLink(message.link_url);
  const others = recent.filter((m) => m.id !== message.id).slice(0, RECENT_LIMIT);

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader title="Mitteilung" current="dashboard" />

      <section className="flex-1 px-4 sm:px-6 py-8 max-w-2xl w-full mx-auto space-y-6">
        <article className="rounded-lg border border-border bg-surface p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-text-faint">{formatTime(message.created_at)}</p>
            <h2 className="text-base font-semibold text-text">{shortTitle(message.title)}</h2>
            <p className="text-sm text-text-muted">{message.body}</p>
          </div>

          <div className="space-y-1.5 pt-4 border-t border-border">
            <p className="text-xs font-medium text-text">Was heisst das?</p>
            <p className="text-sm text-text leading-relaxed">{message.explanation}</p>
          </div>

          {message.details.length > 0 && (
            <div className="space-y-1.5 pt-4 border-t border-border">
              <p className="text-xs font-medium text-text">Werte zum Zeitpunkt der Meldung</p>
              <ul className="space-y-1 text-sm text-text-muted">
                {message.details.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-text-faint">·</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-2 text-sm">
            {link && (
              <Link href={link} className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent">
                Details öffnen
              </Link>
            )}
            <Link href="/" className="rounded border border-border px-3 py-1.5 text-text-muted hover:text-text">
              Zum Dashboard
            </Link>
          </div>
        </article>

        {others.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-faint uppercase tracking-wide">Frühere Mitteilungen</p>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {others.map((m) => (
                <li key={m.id}>
                  <Link href={`/mitteilung/${m.id}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-surface-raised">
                    <span className="text-sm text-text truncate">{shortTitle(m.title)}</span>
                    <span className="text-xs text-text-faint whitespace-nowrap">{formatTime(m.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <AppFooter />
    </main>
  );
}
