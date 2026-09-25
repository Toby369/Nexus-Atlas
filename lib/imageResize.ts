// Client-seitige Bildverkleinerung vor dem Chart-Vision-Upload (Umsetzungsplan
// "Chart-Vision: Trendlinien lesen", Phase 3). Nur aus "use client"-
// Code importiert (nutzt Image/Canvas/FileReader), daher KEIN "server-only"
// noetig -- ein versehentlicher Server-Import wuerde ohnehin sofort laut
// zur Laufzeit scheitern (die Browser-APIs existieren dort nicht), kein
// Secret-Leck-Risiko wie bei supabaseAdmin.ts.
//
// Zweck: TradingView-Screenshots (typischerweise PNG vom OS-Screenshot-Tool,
// oft 1900-3840px breit) auf eine handhabbare Groesse bringen, bevor sie als
// Base64 im JSON-Body an die API-Route gehen -- Vercel-Funktionen haben ein
// ~4.5MB-Request-Body-Limit. Gemini berechnet Bild-Tokens unabhaengig von
// der Aufloesung (bereits recherchiert) -- das Downscaling dient also
// ausschliesslich der Payload-Groesse, nicht den Kosten. maxDimension=1600px
// haelt Preis-Labels/duenne Trendlinien lesbar (dies ist ein UI-Screenshot
// mit scharfen Textkanten, kein Foto -- zu aggressives Downscaling wuerde
// genau die Details verwischen, die die Analyse lesen soll); Qualitaet 0.85
// vermeidet sichtbare JPEG-Artefakte an duennen Linien. Kommen Analysen
// haeufig als "partial"/"illegible" zurueck, eher maxDimension/quality
// anheben statt das Modell als Ursache zu vermuten.
export async function resizeImageForUpload(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<{ blob: Blob; mimeType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("imageResize: Canvas-2D-Kontext nicht verfuegbar.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Immer nach JPEG re-enkodieren, auch wenn die Quelle bereits klein/JPEG
  // war -- PNG->JPEG allein ist bei einem chart-artigen Screenshot ein
  // deutlicher Groessengewinn, unabhaengig vom Dimensions-Cap.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) {
    throw new Error("imageResize: Bild konnte nicht als JPEG kodiert werden.");
  }

  return { blob, mimeType: "image/jpeg" };
}

// Liest einen Blob als reinen Base64-String (ohne "data:image/...;base64,"-
// Prefix) -- genau das Format, das Gemini's inline_data.data erwartet.
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("imageResize: FileReader-Fehler."));
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
