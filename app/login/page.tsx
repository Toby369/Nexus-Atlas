import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Nur relative Pfade zulassen (Open-Redirect-Schutz) -- middleware.ts
  // setzt "next" selbst auf den urspruenglich angefragten Pfad, ein
  // fremdgesteuerter Wert waere trotzdem nur ueber die URL manipulierbar.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/reports";

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 text-center">
        <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
        <h1 className="text-lg font-semibold text-text mt-1">Login</h1>
        <p className="text-xs text-text-faint mt-2 max-w-xs">
          Nur für den Report-Bereich erforderlich — das übrige Dashboard bleibt frei zugänglich.
        </p>
      </div>
      <LoginForm next={safeNext} />
    </main>
  );
}
