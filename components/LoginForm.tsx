"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
