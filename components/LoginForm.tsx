"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Einladungs-/Passwort-Reset-Mails von Supabase haengen das Session-
  // Token als URL-FRAGMENT an (#access_token=...&type=invite), niemals als
  // Query-Param -- Fragmente werden vom Browser nie an den Server gesendet,
  // weshalb proxy.ts (serverseitiges Auth-Gate) sie prinzipiell nicht sehen
  // kann und jede Route ausser /login blockiert, bevor ueberhaupt Client-
  // JS laeuft. supabaseAuthBrowser verarbeitet ein vorhandenes Fragment
  // aber automatisch selbst (detectSessionInUrl, supabase-js-Standard) und
  // etabliert daraus im Erfolgsfall eine Session -- ohne diesen Listener
  // wuerde ein neu eingeladener Nutzer trotzdem auf dem leeren Login-
  // Formular haengen bleiben, weil nichts die neue Session bemerkt und
  // weiterleitet (siehe Bug-Report 01.09.2026: Freund landete nach Klick
  // auf "Accept invitation" unveraendert auf /login).
  //
  // type=invite/recovery bekommt bewusst ein anderes Ziel als ein
  // normaler Login: der Nutzer hat noch KEIN Passwort gesetzt (Invite)
  // bzw. will es gerade zuruecksetzen (Recovery) -- direkt aufs Dashboard
  // zu leiten wuerde ihn ohne je gesetztes Passwort zurücklassen, das
  // naechste Mal koennte er sich gar nicht mehr einloggen. /account zeigt
  // dafuer bereits ChangePasswordForm, das nur eine aktive Session
  // braucht, kein altes Passwort.
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const type = hashParams.get("type");
    const destination = type === "invite" || type === "recovery" ? "/account" : next;

    const {
      data: { subscription },
    } = supabaseAuthBrowser.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.push(destination);
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [next, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabaseAuthBrowser.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError("Login fehlgeschlagen. E-Mail oder Passwort falsch.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-xs">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        E-Mail
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-border bg-surface-raised text-text"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Passwort
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-border bg-surface-raised text-text"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed mt-1"
      >
        {loading ? "Einloggen…" : "Einloggen"}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </form>
  );
}
