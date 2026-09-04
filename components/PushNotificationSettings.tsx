"use client";

import { useEffect, useState } from "react";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/webPush";

// Push-Benachrichtigungen aktivieren/deaktivieren (Nutzer-Wunsch: "kann
// nexus auch push Nachricht senden? ja bauen"). Sendet bei einem Zustands-
// wechsel der 14-Faktoren-Engine (siehe Supabase Edge Function
// send-state-change-push, Cron alle 15 Min, 3 Min nach compute-market-
// state versetzt). Rein browserseitige Web-Push-API -- kein natives App-
// Push, funktioniert nur, wenn der Browser Service Worker + Push
// unterstuetzt (alle aktuellen Desktop-/Android-Browser; iOS erst ab
// "Zum Home-Bildschirm hinzufuegen").
type Status = "checking" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

export default function PushNotificationSettings() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    async function checkStatus() {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setStatus(existing ? "subscribed" : "unsubscribed");
    }
    checkStatus().catch(() => setStatus("unsupported"));
  }, []);

  async function handleSubscribe() {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS-Lib-Eigenheit (Uint8Array<ArrayBufferLike> vs. der von
        // pushManager.subscribe() erwarteten BufferSource mit striktem
        // ArrayBuffer) -- zur Laufzeit ist es exakt das erwartete
        // Uint8Array, siehe lib/webPush.ts.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Unbekannter Fehler beim Speichern der Subscription.");

      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("unsubscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setError(null);
    setTestResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Unbekannter Fehler.");
      setTestResult(
        data.sent > 0
          ? `Test gesendet (${data.sent} Gerät${data.sent === 1 ? "" : "e"}).`
          : "Keine aktive Subscription gefunden."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full max-w-xs">
      {status === "checking" && <p className="text-xs text-text-faint">Status wird geprüft…</p>}

      {status === "unsupported" && (
        <p className="text-xs text-text-faint">
          Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.
        </p>
      )}

      {status === "denied" && (
        <p className="text-xs text-down">
          Benachrichtigungen wurden in den Browser-Einstellungen blockiert — erlaube sie dort, um Push zu
          aktivieren.
        </p>
      )}

      {status === "unsubscribed" && (
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={busy}
          className="px-3 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Aktiviert…" : "Push-Benachrichtigungen aktivieren"}
        </button>
      )}

      {status === "subscribed" && (
        <>
          <p className="text-xs text-up">Push-Benachrichtigungen sind aktiv auf diesem Gerät.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={busy}
              className="px-3 py-2 text-sm rounded-md border border-border bg-surface-raised text-text disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Test senden
            </button>
            <button
              type="button"
              onClick={handleUnsubscribe}
              disabled={busy}
              className="px-3 py-2 text-sm rounded-md border border-down/40 text-down disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Deaktivieren
            </button>
          </div>
        </>
      )}

      {testResult && <span className="text-xs text-up">{testResult}</span>}
      {error && <span className="text-xs text-down">{error}</span>}

      <p className="text-xs text-text-faint pt-1">
        Benachrichtigt bei Zustandswechsel der Gesamteinschätzung (z.B. Mixed → Bullisch) — kein
        Handelssignal, keine Anlageberatung.
      </p>
    </div>
  );
}
