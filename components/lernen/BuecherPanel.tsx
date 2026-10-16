"use client";

import { useEffect, useState } from "react";
import { BUCH_GRUPPEN, BUECHER, type Buch } from "@/lib/buecherContent";
import {
  applyAnswer,
  bookProgress,
  isUnlocked,
  parseProgress,
  shuffledOrder,
  type AnswerOutcome,
  type BuecherProgress,
} from "@/lib/buecherProgress";
import { Pill, Segmented } from "@/components/lernen/grundlagen/ui";
import { ZUSAMMENFASSUNGEN, type Abschnitt } from "@/lib/buecherZusammenfassungen";

// Bücher-Lernpfad: pro Buch Lektionen mit Kernaussagen und einer Prüffrage.
// Richtige Antwort schaltet die nächste Lektion frei, falsche schickt zurück
// zur Lektion, zwei falsche in Folge eine Lektion zurück (lib/buecherProgress.ts).
// Fortschritt nur lokal (localStorage) -- wie DashboardTabNav, kein Nutzerkonto.

const STORAGE_KEY = "nexus.buecher.v1";

type Phase = "lesen" | "frage" | "feedback";
type Ansicht = "zusammenfassung" | "lektionen";

function Zusammenfassung({ abschnitte, onWeiter }: { abschnitte: Abschnitt[]; onWeiter: () => void }) {
  return (
    <article className="rounded-lg border border-border bg-surface-raised p-4 space-y-5">
      {abschnitte.map((a) => (
        <section key={a.titel} className="space-y-2">
          <h4 className="text-sm font-semibold text-text">{a.titel}</h4>
          {a.punkte && (
            <ul className="space-y-1.5">
              {a.punkte.map((pt) => (
                <li key={pt} className="flex gap-2 text-sm text-text-muted leading-relaxed">
                  <span className="text-accent">•</span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          )}
          {a.text?.map((t) => (
            <p key={t} className="text-sm text-text-muted leading-relaxed">
              {t}
            </p>
          ))}
        </section>
      ))}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onWeiter}
          className="px-4 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent"
        >
          Zu den Lektionen →
        </button>
      </div>
    </article>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden" aria-hidden>
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function BookList({ progress, onOpen }: { progress: BuecherProgress; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-5">
      {BUCH_GRUPPEN.map((gruppe) => (
        <div key={gruppe} className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{gruppe}</p>
          {BUECHER.filter((b) => b.gruppe === gruppe).map((b) => {
            const p = bookProgress(progress, b.id);
            const done = p.passed >= b.lektionen.length;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpen(b.id)}
                className="w-full text-left rounded-lg border border-border bg-surface-raised p-3 space-y-2 hover:border-accent/40"
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-text">{b.titel}</span>
                    <span className="block text-xs text-text-faint">
                      {b.autor} · {b.jahr}
                    </span>
                  </span>
                  {done ? <Pill tone="bullish">Abgeschlossen</Pill> : <Pill tone="neutral">{b.niveau}</Pill>}
                </div>
                <ProgressBar value={p.passed} total={b.lektionen.length} />
                <p className="text-[11px] text-text-faint">
                  {p.passed} von {b.lektionen.length} Lektionen bestanden
                </p>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const OUTCOME_TEXT: Record<AnswerOutcome, string> = {
  weiter: "Richtig – die nächste Lektion ist freigeschaltet.",
  wiederholen: "Nicht ganz. Lies die Lektion nochmal und versuch es erneut.",
  zurueckgefallen: "Zweimal daneben – du fällst eine Lektion zurück und wiederholst die vorherige.",
  schon_bestanden: "Wiederholung – dein Fortschritt bleibt unverändert.",
};

function BookView({
  buch,
  progress,
  onProgress,
  onClose,
}: {
  buch: Buch;
  progress: BuecherProgress;
  onProgress: (next: BuecherProgress) => void;
  onClose: () => void;
}) {
  const p = bookProgress(progress, buch.id);
  const total = buch.lektionen.length;
  const [idx, setIdx] = useState(Math.min(p.passed, total - 1));
  const [phase, setPhase] = useState<Phase>("lesen");
  const [chosen, setChosen] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const abschnitte = ZUSAMMENFASSUNGEN[buch.id] ?? [];
  // Neu begonnene Bücher öffnen mit der Zusammenfassung, angefangene mit den Lektionen.
  const [ansicht, setAnsicht] = useState<Ansicht>(
    p.passed === 0 && abschnitte.length > 0 ? "zusammenfassung" : "lektionen",
  );

  const lektion = buch.lektionen[idx];
  const order = shuffledOrder(lektion.frage.optionen.length, `${buch.id}-${idx}`);
  const correct = chosen === lektion.frage.richtig;

  function goTo(i: number) {
    setIdx(i);
    setPhase("lesen");
    setChosen(null);
    setOutcome(null);
  }

  function answer(option: number) {
    const result = applyAnswer(p, idx, option === lektion.frage.richtig, total);
    setChosen(option);
    setOutcome(result.outcome);
    setPhase("feedback");
    onProgress({ ...progress, [buch.id]: result.next });
  }

  function continueAfterFeedback() {
    if (outcome === "weiter") {
      if (idx + 1 < total) goTo(idx + 1);
      else setPhase("lesen");
    } else if (outcome === "zurueckgefallen") {
      goTo(Math.max(0, idx - 1));
    } else if (outcome === "schon_bestanden" && correct && idx + 1 < total) {
      goTo(idx + 1);
    } else {
      goTo(idx);
    }
  }

  function reset() {
    const next = { ...progress };
    delete next[buch.id];
    onProgress(next);
    goTo(0);
  }

  const bookDone = p.passed >= total;
  const continueLabel =
    outcome === "weiter"
      ? idx + 1 < total
        ? "Nächste Lektion →"
        : "Fertig"
      : outcome === "zurueckgefallen"
        ? `‹ Zurück zu Lektion ${Math.max(1, idx)}`
        : outcome === "schon_bestanden" && correct && idx + 1 < total
          ? "Nächste Lektion →"
          : "‹ Zurück zur Lektion";

  return (
    <div className="space-y-4">
      <button type="button" onClick={onClose} className="text-xs text-text-faint underline decoration-dotted">
        ‹ Alle Bücher
      </button>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-text">{buch.titel}</h3>
        <p className="text-xs text-text-faint">
          {buch.autor} · {buch.jahr} · {buch.niveau}
        </p>
        <p className="text-xs text-text-muted leading-relaxed">{buch.warum}</p>
      </div>

      {abschnitte.length > 0 && (
        <Segmented
          label="Ansicht"
          value={ansicht}
          options={[
            { value: "zusammenfassung", label: "Zusammenfassung" },
            { value: "lektionen", label: "Lektionen" },
          ]}
          onChange={setAnsicht}
        />
      )}

      {ansicht === "zusammenfassung" ? (
        <Zusammenfassung abschnitte={abschnitte} onWeiter={() => setAnsicht("lektionen")} />
      ) : (
        <>
          <div className="space-y-1.5">
            <ProgressBar value={p.passed} total={total} />
            <div className="flex flex-wrap gap-1.5" role="list" aria-label="Lektionen">
              {buch.lektionen.map((l, i) => {
                const unlocked = isUnlocked(p, i);
                const passed = i < p.passed;
                return (
                  <button
                    key={l.titel}
                    type="button"
                    role="listitem"
                    disabled={!unlocked}
                    onClick={() => goTo(i)}
                    title={unlocked ? l.titel : "Noch gesperrt"}
                    className={`h-7 min-w-7 px-2 rounded-md border text-xs font-mono ${
                      i === idx
                        ? "border-accent bg-accent/15 text-accent"
                        : passed
                          ? "border-up/40 text-up"
                          : unlocked
                            ? "border-border text-text-muted"
                            : "border-border/50 text-text-faint/50 cursor-not-allowed"
                    }`}
                  >
                    {passed ? "✓" : unlocked ? i + 1 : "🔒"}
                  </button>
                );
              })}
            </div>
          </div>

          {bookDone && phase === "lesen" && idx === total - 1 && (
            <div className="rounded-lg border border-up/40 bg-up/10 p-3 text-xs text-up">
              Buch abgeschlossen. Du kannst jede Lektion wiederholen – der Fortschritt bleibt erhalten.
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">
              Lektion {idx + 1} von {total}
            </p>
            <h4 className="text-sm font-semibold text-text">{lektion.titel}</h4>

            {phase === "lesen" && (
              <>
                <ul className="space-y-2">
                  {lektion.kern.map((k) => (
                    <li key={k} className="flex gap-2 text-xs text-text-muted leading-relaxed">
                      <span className="text-accent">•</span>
                      <span>{k}</span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text">
                  <span className="font-medium text-accent">Merksatz:</span> {lektion.merksatz}
                </div>
                {lektion.bezug && (
                  <p className="text-xs text-text-faint leading-relaxed">
                    <span className="font-medium text-text-muted">Für dein Trading:</span> {lektion.bezug}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => goTo(idx - 1)}
                    className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted disabled:opacity-40"
                  >
                    ‹ Zurück
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("frage")}
                    className="px-4 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent"
                  >
                    Zur Prüffrage →
                  </button>
                </div>
              </>
            )}

            {phase !== "lesen" && (
              <div className="space-y-3">
                <p className="text-sm text-text">{lektion.frage.text}</p>
                <div className="space-y-2">
                  {order.map((o) => {
                    const isChosen = chosen === o;
                    const isRight = o === lektion.frage.richtig;
                    const state =
                      phase === "feedback"
                        ? isRight
                          ? "border-up/50 bg-up/10 text-up"
                          : isChosen
                            ? "border-down/50 bg-down/10 text-down"
                            : "border-border text-text-faint"
                        : "border-border text-text-muted hover:border-accent/40 hover:text-text";
                    return (
                      <button
                        key={o}
                        type="button"
                        disabled={phase === "feedback"}
                        onClick={() => answer(o)}
                        className={`w-full text-left rounded-md border px-3 py-2 text-xs ${state}`}
                      >
                        {lektion.frage.optionen[o]}
                      </button>
                    );
                  })}
                </div>

                {phase === "feedback" && outcome && (
                  <div className="space-y-3">
                    <div
                      className={`rounded-md border px-3 py-2 text-xs space-y-1 ${
                        correct ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10"
                      }`}
                    >
                      <p className={`font-medium ${correct ? "text-up" : "text-down"}`}>
                        {outcome === "schon_bestanden" ? (correct ? "Richtig. " : "Falsch. ") : ""}
                        {OUTCOME_TEXT[outcome]}
                      </p>
                      <p className="text-text-muted leading-relaxed">{lektion.frage.erklaerung}</p>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={continueAfterFeedback}
                        className="px-4 py-2 text-sm rounded-md border border-accent/40 bg-accent/15 text-accent"
                      >
                        {continueLabel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <button type="button" onClick={reset} className="text-xs text-text-faint underline decoration-dotted">
        Fortschritt für dieses Buch zurücksetzen
      </button>
    </div>
  );
}

export default function BuecherPanel() {
  const [progress, setProgress] = useState<BuecherProgress>({});
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setProgress(parseProgress(window.localStorage.getItem(STORAGE_KEY)));
      } catch {
        // localStorage kann in privaten Modi fehlschlagen -- dann ohne gespeicherten Fortschritt.
      }
    });
  }, []);

  function updateProgress(next: BuecherProgress) {
    setProgress(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // s.o.
    }
  }

  const buch = BUECHER.find((b) => b.id === openId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-faint leading-relaxed">
        Kernideen von Büchern zu Marktmechanik, systematischem Trading und Psychologie – in eigenen Worten
        zusammengefasst, nicht aus den Büchern zitiert. Pro Lektion eine Prüffrage: richtig schaltet die nächste frei,
        falsch schickt zurück zur Lektion, zweimal falsch in Folge eine Lektion zurück. Details immer im Original
        prüfen.
      </p>
      {buch ? (
        <BookView
          key={buch.id}
          buch={buch}
          progress={progress}
          onProgress={updateProgress}
          onClose={() => setOpenId(null)}
        />
      ) : (
        <BookList progress={progress} onOpen={setOpenId} />
      )}
    </div>
  );
}
