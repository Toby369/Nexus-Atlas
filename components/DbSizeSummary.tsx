import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Datenbank-Speicher im Konto (Toby 29.10.2026): Supabase Free-Plan erlaubt
// 0,5 GB, danach wird die DB schreibgeschuetzt. Gelb ab 400 MB, rot ab 450 MB
// (siehe CLAUDE.md "Datenbank unter 500 MB halten"). pg_database_size liegt
// leicht unter dem Wert, den Supabase fuer das Kontingent zaehlt.

const LIMIT_MB = 500;
const WARN_MB = 400;
const CRITICAL_MB = 450;

export default async function DbSizeSummary() {
  let mb: number | null = null;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("get_db_size_bytes");
    if (error) throw new Error(error.message);
    mb = Number(data) / 1024 / 1024;
  } catch (err) {
    console.error("Datenbank-Groesse: Fehler beim Laden:", err instanceof Error ? err.message : err);
  }
  if (mb === null || !Number.isFinite(mb)) {
    return <p className="text-xs text-text-faint">Grösse gerade nicht verfügbar.</p>;
  }

  const pct = Math.min(100, (mb / LIMIT_MB) * 100);
  const tone = mb >= CRITICAL_MB ? "bg-down" : mb >= WARN_MB ? "bg-warn" : "bg-up";
  const text = mb >= CRITICAL_MB ? "text-down" : mb >= WARN_MB ? "text-warn" : "text-text-muted";

  return (
    <div className="space-y-1.5">
      <p className={`text-xs ${text}`}>
        <span className="font-mono tabular text-text">{Math.round(mb)} MB</span> von {LIMIT_MB} MB (Supabase Free-Plan)
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded bg-surface-raised">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {mb >= WARN_MB && (
        <p className={`text-xs ${text}`}>
          Wird knapp: Ab 500 MB nimmt die Datenbank nichts mehr auf. Bitte Claude bitten, aufzuräumen.
        </p>
      )}
    </div>
  );
}
