"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

// Mindestlaenge rein clientseitige Komfort-Pruefung -- die tatsaechliche
// Policy (Supabase Auth Projekteinstellungen) bleibt die massgebliche
// Instanz; ein serverseitiger Fehler (z.B. strengere Anforderung) wird
// unten unveraendert als error.message angezeigt statt verschluckt.
const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordForm() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabaseAuthBrowser.auth.updateUser({
      password: newPassword,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setNewPassword("");
    setConfirmPassword("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-xs">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Neues Passwort
        <input
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-border bg-surface-raised text-text"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Neues Passwort bestätigen
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-border bg-surface-raised text-text"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed mt-1"
      >
        {loading ? "Speichert…" : "Passwort ändern"}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
      {success && <span className="text-xs text-up">Passwort erfolgreich geändert.</span>}
    </form>
  );
}
