// PostgREST kappt auf diesem Projekt jede Antwort hart bei 1000 Zeilen,
// unabhaengig von .limit(). Wer mehr Zeilen braucht, muss seitenweise per
// .range() laden, sonst fehlen bei aufsteigender Sortierung still die
// juengsten Zeilen.

export const POSTGREST_MAX_ROWS = 1000;

export type PageFetcher<T> = (
  from: number,
  to: number
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Laedt Seite fuer Seite, bis eine Seite kuerzer als pageSize ist oder
 * maxRows erreicht sind. Bricht bei einem Fehler ab und gibt die bis dahin
 * geladenen Zeilen zusammen mit der Fehlermeldung zurueck.
 */
export async function fetchAllPages<T>(
  fetchPage: PageFetcher<T>,
  maxRows: number,
  pageSize = POSTGREST_MAX_ROWS
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const from = rows.length;
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return { rows, error: null };
}
