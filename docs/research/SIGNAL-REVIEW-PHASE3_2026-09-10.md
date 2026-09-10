# Periodischer KI-Rückblick — Phase 3: KI-Rückblick-Kachel (10.09.2026)

Letzte Phase des am 09.09.2026 freigegebenen Plans für die ersten beiden
Signal-Gruppen: eine Dashboard-Kachel, die `signal_stats_results` (Phase 2)
liest und eine verständliche deutsche Einordnung schreibt.

## 1. Prinzip: kein eigener Bias, keine eigene Statistik

Die KI bekommt in `lib/signalReviewContext.ts` ausschließlich bereits
fertig berechnete Zahlen (n, Trefferquote/Baseline bzw. Ø|Bewegung|/
Baseline, `raw_p_value`, `significant_after_bh`) — Prompt-Profil
`signal-review` (`lib/ai/promptProfiles.ts`) verbietet explizit, selbst
eine neue Statistik zu berechnen oder eine Marktrichtung abzuleiten. Das
ist keine Trading-Kachel, sondern eine Selbstüberprüfung der bestehenden
Signale.

**Eine bewusste Ausnahme**: `decay_flag` je Zelle ist regelbasiert (nicht
von der KI) berechnet — vergleicht denselben Edge zwischen 90d- und
Gesamtfenster, nur wenn beide Fenster die Mindeststichprobe (n≥10)
erreichen, sonst `null`. Das nimmt der KI die Berechnung ab (keine
Rechenfehler durch das Modell), nicht die Interpretation.

## 2. Architektur (folgt bewusst dem etablierten Kachel-Muster)

- `signal_review_snapshots` (Supabase): `id, generated_at, provider, model,
  result jsonb, status, error` — identisches Schema wie
  `signal_engine_snapshots`.
- `lib/signalReviewContext.ts`: `aggregateSignalReviewCells()` (reine,
  getestete Funktion, 10 Vitest-Fälle) + `buildSignalReviewContext()`
  (Supabase-Fetch-Wrapper) — dieselbe Trennung wie
  `lib/divergenceRadar.ts`/`lib/divergenceRadarContext.ts`.
- `lib/ai/promptProfiles.ts` "signal-review" + `lib/ai/tileConfig.ts`
  Eintrag (Provider-Kette wie "signal-engine": google → openrouter →
  deepseek → anthropic).
- `app/api/signal-review/generate/route.ts`: POST, ratelimitiert,
  `runTileAnalysis("signal-review", ...)`.
- `components/SignalReviewCard.tsx` + `lib/dashboardTiles.ts` +
  `app/page.tsx`-Wiring: gleiches Muster wie `SignalEngineCard.tsx`.

## 3. Automatischer wöchentlicher Trigger (Unterschied zu den meisten Kacheln)

Fast alle bisherigen KI-Kacheln laufen nur per Klick ("Neu generieren").
Diese hier läuft **primär automatisch woechentlich** (Plan: "wöchentlich,
nicht täglich"):

- Neue Supabase Edge Function `signal-review-scheduler` — identisches
  Muster wie `youtube-monitor-scheduler`: holt `CRON_SECRET` aus dem Vault
  (`get_secret`-RPC), ruft `POST /api/signal-review/generate` mit
  `Authorization: Bearer <secret>` auf.
- `/api/signal-review/generate` in `SERVICE_ROLE_BEARER_PATHS`
  (`lib/authGate.ts`) ergänzt, damit `proxy.ts` den Server-zu-Server-Aufruf
  ohne Nutzer-Session durchlässt (Test in `authGate.test.ts` ergänzt).
- Cron `signal-review-scheduler-weekly`: Montag 05:15 UTC — bewusst 15
  Minuten NACH dem `compute_signal_stats`-Cron (Montag 05:00 UTC, Phase 2),
  damit `signal_stats_results` garantiert frisch ist, bevor die KI sie
  liest. `CRON_SECRET` im Vault bereits vorhanden (von
  youtube-monitor-scheduler geteilt) — keine neue Konfiguration am
  Vercel-Ende nötig.
- Der "Neu generieren"-Button bleibt zusätzlich für ein manuelles Update.

## 4. Validierung

`npx vitest run`: 338/346 grün (die 8 Fehlschläge sind vorbestehende
Live-Integrationstests gegen die Produktions-DB, die in dieser Sandbox
keinen Netzwerkzugriff auf `*.supabase.co` haben — nicht durch diese Phase
verursacht). `eslint` und `next build` (inkl. `tsc`) sauber,
`/api/signal-review/generate` erscheint korrekt in der Build-Routen-Liste.

## 5. Damit ist der 09.09.2026 freigegebene Plan für die ersten beiden
Signal-Gruppen (TradingView-Alerts, Warn-Muster/Risk-Faktoren) vollständig
umgesetzt: Schema → Detection/Backfill (Phase 1) → Statistik-Pipeline
(Phase 2) → KI-Kachel (Phase 3).

## 6. Nicht Teil dieser Phase (laut Plan: Phase 4, später)

Kern-Engines (14-Faktoren/5-Säulen/Marktkontext-Bias), Divergenz-Radar und
die KI-Kacheln (Trade-Debate, Handelslage, YouTube-Konsens, Reports) als
weitere Signal-Gruppen in `signal_outcomes` — die KI-Kacheln brauchen dafür
zusätzlich eine strukturiert gespeicherte "vorhergesagte Richtung" pro
Lauf, die aktuell noch nicht existiert.

## Referenzen

- `SIGNAL-REVIEW-PHASE1_2026-09-10.md`, `SIGNAL-REVIEW-PHASE2_2026-09-10.md`.
- Migrationen: `create_signal_review_snapshots`,
  `schedule_signal_review_scheduler`.
- Edge Function: `signal-review-scheduler` (Supabase, nicht in diesem
  Next.js-Repo getrackt, siehe README-Konvention für die übrigen 30
  Funktionen).
