import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { usageCatalog } from "@/lib/tileUsage";
import { DASHBOARD_TABS } from "@/lib/dashboardTabs";

// Auswertung des Nutzungs-Zaehlers im Konto (Toby 27.10.2026). Zeigt nur an --
// geloescht oder ausgeblendet wird nichts automatisch.

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export default async function TileUsageSummary() {
  let rows: { item: string; created_at: string; seconds: number | null }[] = [];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("tile_usage")
      .select("item, created_at, seconds")
      .order("created_at", { ascending: true })
      .limit(20000);
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (err) {
    console.error("Nutzungs-Zaehler: Fehler beim Laden:", err instanceof Error ? err.message : err);
    return <p className="text-xs text-text-faint">Auswertung gerade nicht verfügbar.</p>;
  }

  const counts = new Map<string, number>();
  const dwell = new Map<string, number>();
  for (const r of rows) {
    if (r.item.startsWith("dwell:")) {
      const tab = r.item.slice("dwell:".length);
      dwell.set(tab, (dwell.get(tab) ?? 0) + (r.seconds ?? 0));
    } else {
      counts.set(r.item, (counts.get(r.item) ?? 0) + 1);
    }
  }
  const dwellList = DASHBOARD_TABS.map((t) => ({ label: t.label, seconds: dwell.get(t.id) ?? 0 })).sort(
    (a, b) => b.seconds - a.seconds
  );
  const dwellTotal = dwellList.reduce((s, d) => s + d.seconds, 0);
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
      {dwellTotal > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Verweildauer je Reiter (seit 15.11.)</p>
          <ul className="divide-y divide-border/50 text-xs">
            {dwellList.map((d) => (
              <li key={d.label} className="flex justify-between gap-3 py-1">
                <span className={d.seconds === 0 ? "text-text-faint" : "text-text"}>{d.label}</span>
                <span className="font-mono tabular text-text-muted">{fmtDuration(d.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Klicks</p>
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
