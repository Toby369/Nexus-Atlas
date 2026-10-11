// PostgREST (Supabase) kappt jede Antwort hart bei 1000 Zeilen, auch wenn
// .limit() mehr verlangt. Wer mehr Zeilen braucht, muss seitenweise per
// .range() laden -- sonst fehlen bei aufsteigender Sortierung still die
// juengsten Zeilen.
export const POSTGREST_MAX_ROWS = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

// Ruft fetchPage(from, to) (inklusive Grenzen, wie .range()) so oft auf, bis
// eine Seite weniger als pageSize Zeilen liefert oder maxRows erreicht ist.
// Bei einem Fehler wird abgebrochen und das bis dahin Geladene zurueckgegeben.
export async function fetchPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
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
