// Reine Helfer fuer die Mitteilungs-Seite (ohne I/O, testbar).
// Daten: lib/pushMessages.ts.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPushMessageId(id: string): boolean {
  return UUID_RE.test(id);
}

// Nur interne Pfade als Link zulassen (kein offener Redirect ueber gespeicherte URLs).
export function safeInternalLink(url: string | null): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}

// Titel ohne den Praefix "Nexus Atlas — ", der in der Benachrichtigung steht.
export function shortTitle(title: string): string {
  return title.replace(/^Nexus Atlas\s*[—-]\s*/, "");
}
