import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { usageCatalog } from "@/lib/tileUsage";

// Auswertung des Nutzungs-Zaehlers im Konto (Toby 27.10.2026). Zeigt nur an --
// geloescht oder ausgeblendet wird nichts automatisch.

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });

export default async function TileUsageSummary() {
  let rows: { item: string; created_at: string }[] = [];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("tile_usage")
      .select("item, created_at")
      .order("created_at", { ascending: true })
      .limit(20000);
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (err) {
    console.error("Nutzungs-Zaehler: Fehler beim Laden:", err instanceof Error ? err.message : err);
    return <p className="text-xs text-text-faint">Auswertung gerade nicht verfügbar.</p>;
  }

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.item, (counts.get(r.item) ?? 0) + 1);
  const list = usageCatalog()
    .map((c) => ({ ...c, count: counts.get(c.item) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.label.localeCompare(b.label, "de"));

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {rows.length === 0
          ? "Noch keine Nutzung erfasst. Gezählt werden Reiter-Wechsel, aufgeklappte Trade-Schritte und Klicks in eine Kachel."
          : `Seit ${fmtDate(rows[0].created_at)}, selten genutzt zuerst. Nichts wird automatisch gelöscht.`}
      </p>
      <ul className="divide-y divide-border/50 text-xs">
        {list.map((c) => (
          <li key={c.item} className="flex justify-between gap-3 py-1">
            <span className={c.count === 0 ? "text-text-faint" : "text-text"}>{c.label}</span>
            <span className="font-mono tabular text-text-muted">{c.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
