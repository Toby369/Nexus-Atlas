"use client";

import { useRef, useState } from "react";
import type { ChartVisionAnalysis } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";
import { resizeImageForUpload, blobToBase64 } from "@/lib/imageResize";

// Chart-Vision (Umsetzungsplan "Chart-Vision: LSOB & Trendlinien lesen",
// Phase 3) -- Toby laedt einen TradingView-Screenshot hoch (LSOB-Zonen +
// eigene Trendlinien, beides nur als Pixel vorhanden, weder aus
// geschlossenem Drittanbieter-Indikator noch aus Handzeichnungen
// strukturiert zugaenglich). Gemini liest qualitativ, was zu sehen ist --
// reine Entscheidungsunterstuetzung, kein Handelssignal.

const INFO_TEXT = [
  "Was das ist: du laedst einen Screenshot deines TradingView-Charts hoch (mit sichtbaren LSOB-Zonen und/oder deinen Trendlinien), eine kostenlose Vision-KI (Gemini) beschreibt qualitativ, was sie sieht -- Lage relativ zum aktuellen Kurs, Anzahl, Richtung.",
  "Bewusst qualitativ, keine erfundenen Preiswerte: die KI liest keine Pixel-Positionen als exakte Preise, ausser ein Preis-Label ist im Bild eindeutig beschriftet. Ist der Screenshot unscharf oder ein Element nicht erkennbar, wird das offen als 'partial'/'illegible' gekennzeichnet statt geraten.",
  "Screenshots werden gespeichert (privater Speicher, nur du siehst sie) -- Verlauf unten zeigt vergangene Analysen samt Vorschaubild.",
  "Kostenlos, nur per Klick auf 'Analysieren' -- kein Handelssignal, keine Anlageberatung.",
].join("\n\n");

function formatRelation(relation: string): string {
  switch (relation) {
    case "above":
      return "über dem Kurs";
    case "below":
      return "unter dem Kurs";
    case "at":
      return "am Kurs";
    case "mixed":
      return "gemischt";
    case "unclear":
      return "unklar";
    default:
      return relation;
  }
}

const READABILITY_LABEL: Record<string, string> = {
  clear: "klar erkennbar",
  partial: "teilweise erkennbar",
  illegible: "nicht erkennbar",
};

export default function ChartVisionCard({
  initialAnalyses,
}: {
  initialAnalyses: ChartVisionAnalysis[];
}) {
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { blob } = await resizeImageForUpload(file);
      setPendingBlob(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit() {
    if (!pendingBlob) return;
    setLoading(true);
    setError(null);
    try {
      const imageBase64 = await blobToBase64(pendingBlob);
      const res = await fetch("/api/chart-vision/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", note: note || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Fuer den gerade hochgeladenen Eintrag die lokale Blob-Vorschau
      // wiederverwenden -- kein Signed-URL-Roundtrip noetig, der Client hat
      // die Bytes bereits.
      const run = { ...json.run, signedUrl: previewUrl ?? undefined } as ChartVisionAnalysis;
      setAnalyses((prev) => [run, ...prev]);
      setPendingBlob(null);
      setPreviewUrl(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Chart-Vision: LSOB &amp; Trendlinien (KI)</p>
          <PanelInfo title="Chart-Vision: LSOB & Trendlinien" content={INFO_TEXT} />
        </span>
      </div>

      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => handleFileSelect(e.target.files?.[0])}
          className="w-full text-xs text-text-faint file:mr-2 file:px-2 file:py-1 file:text-xs file:rounded-md file:border file:border-border file:bg-surface-raised file:text-text-muted"
        />
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- lokale Blob-URL, kein next/image-Loader anwendbar
          <img src={previewUrl} alt="Vorschau des ausgewählten Screenshots" className="max-h-40 rounded-md border border-border" />
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optionale Notiz (z.B. 'nur die untere LSOB-Zone interessiert mich')…"
          className="w-full text-xs rounded-md border border-border bg-surface-raised text-text px-2 py-1.5 focus:outline-none focus:border-accent/40"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !pendingBlob}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Analysiert…" : "Analysieren"}
        </button>
      </div>

      {error && <p className="text-xs text-down">{error}</p>}

      {analyses.length === 0 && !error && (
        <p className="text-xs text-text-faint">Noch keine Screenshots hochgeladen.</p>
      )}

      <div className="space-y-2">
        {analyses.map((a) => (
          <div key={a.id} className="rounded-md border border-border/60 p-2.5 space-y-1.5 flex gap-2.5">
            {a.signedUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Signed URL aus privatem Storage-Bucket, kein next/image-Loader anwendbar
              <img src={a.signedUrl} alt="Chart-Screenshot" className="w-16 h-16 object-cover rounded-md border border-border shrink-0" />
            )}
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-text-faint flex-wrap">
                <FullDateTime iso={a.generated_at} />
                <StaleBadge iso={a.generated_at} />
              </div>
              {a.note && <p className="text-xs text-text-faint italic">„{a.note}“</p>}
              {a.status === "ok" && a.result && (
                <div className="space-y-1 text-xs">
                  <p className="text-text-faint">
                    Lesbarkeit:{" "}
                    <span className="text-text-muted">{READABILITY_LABEL[a.result.overallReadability]}</span>
                  </p>
                  <p className="text-text-faint">
                    LSOB:{" "}
                    {a.result.lsob.visible ? (
                      <span className="text-text-muted">
                        {a.result.lsob.description} ({formatRelation(a.result.lsob.relationToPrice)})
                      </span>
                    ) : (
                      <span className="text-text-muted">nicht sichtbar</span>
                    )}
                  </p>
                  <p className="text-text-faint">
                    Trendlinien:{" "}
                    {a.result.trendlines.visible ? (
                      <span className="text-text-muted">
                        {a.result.trendlines.description} ({formatRelation(a.result.trendlines.relationToPrice)})
                      </span>
                    ) : (
                      <span className="text-text-muted">nicht sichtbar</span>
                    )}
                  </p>
                  {a.result.visiblePriceLabel && (
                    <p className="text-text-faint">
                      Preis-Label im Bild: <span className="text-text-muted">{a.result.visiblePriceLabel}</span>
                    </p>
                  )}
                  <p className="text-text-faint">Summary: <span className="text-text-muted">{a.result.summary}</span></p>
                  {a.result.caveats.length > 0 && (
                    <p className="text-text-faint">Hinweise: {a.result.caveats.join("; ")}</p>
                  )}
                  <p className="text-text-faint">Confidence: {a.result.confidence}%</p>
                </div>
              )}
              {a.status === "error" && (
                <p className="text-xs text-down">{a.error ?? "Analyse fehlgeschlagen."}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-faint pt-1">
        Entscheidungsunterstützung, kein Handelssignal und keine Anlageberatung.
      </p>
    </div>
  );
}
