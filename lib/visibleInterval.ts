// Wie setInterval, aber nur solange der Tab sichtbar ist. Jeder Abruf ist
// ein Log-Eintrag bei Supabase (Log Ingestion des Free-Plans); ein im
// Hintergrund offener Tab hat vorher ununterbrochen weiter gepollt. Wird der
// Tab wieder sichtbar und ist seit dem letzten Lauf mindestens ein Intervall
// vergangen, laeuft fn sofort, damit nichts veraltet angezeigt wird.
//
// Gibt die Aufraeumfunktion zurueck (Ersatz fuer clearInterval).

export interface VisibilityTarget {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function setVisibleInterval(
  fn: () => unknown,
  ms: number,
  target: VisibilityTarget = document,
  now: () => number = Date.now,
): () => void {
  let lastRunMs = now();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    lastRunMs = now();
    fn();
  };
  const start = () => {
    if (timer === null) timer = setInterval(tick, ms);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onVisibilityChange = () => {
    if (target.visibilityState === "hidden") {
      stop();
      return;
    }
    if (now() - lastRunMs >= ms) tick();
    start();
  };

  if (target.visibilityState !== "hidden") start();
  target.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stop();
    target.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
