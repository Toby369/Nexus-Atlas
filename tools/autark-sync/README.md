# AutarkTrade → Nexus

Zwei Verbindungen, ohne dass an AutarkTrade Code geändert wird.
Plan: [docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md](../../docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).

| Was | Weg | Wohin in Nexus |
|---|---|---|
| Alarme | AutarkTrade-Webhook → Edge Function `webhook-autark` | Tabelle `autark_alarms`, Tagesplan „Alarme aus AutarkTrade“ |
| Zonen | dieses Skript → Edge Function `autark-sync` | ersetzt `own_zones` (Zonen-Kachel, Plan-Satz, Tagesplan) |

## Geheimnisse (einmalig)

Zwei zufällige Werte erzeugen, z. B. im Terminal:

```bash
openssl rand -hex 24   # für AUTARK_WEBHOOK_SECRET
openssl rand -hex 24   # für AUTARK_SYNC_SECRET
```

Beide in Supabase als Edge-Function-Geheimnisse eintragen (Dashboard ›
Edge Functions › Secrets) mit den Namen `AUTARK_WEBHOOK_SECRET` und
`AUTARK_SYNC_SECRET`.

## Alarme

In AutarkTrade unter Einstellungen › Benachrichtigungen den Webhook-Kanal
einschalten und als Adresse eintragen:

```
https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/webhook-autark?key=<AUTARK_WEBHOOK_SECRET>
```

Mit dem Test-Knopf prüfen: Die Testmeldung erscheint im Tagesplan unter
„Alarme aus AutarkTrade“. Mindest-Schwere des Kanals so wählen, dass die
Chart-Alarme durchkommen.

## Zonen (Linux, systemd)

```bash
mkdir -p ~/.local/share/autark-sync ~/.config/systemd/user
cp autark_sync.py ~/.local/share/autark-sync/
cp autark-sync.env.example ~/.config/autark-sync.env && chmod 600 ~/.config/autark-sync.env
# ~/.config/autark-sync.env ausfüllen (Pfad zur Datenbank, Geheimnis)

# Erst nur anzeigen, was gefunden wird:
set -a; . ~/.config/autark-sync.env; set +a
python3 ~/.local/share/autark-sync/autark_sync.py --dry-run

# Einmal senden:
python3 ~/.local/share/autark-sync/autark_sync.py --once

# Alle 5 Minuten automatisch:
cp autark-sync.service autark-sync.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autark-sync.timer
journalctl --user -u autark-sync -n 20   # Protokoll
```

Gesendet wird bei jedem Lauf (alle 5 Minuten). Nexus schreibt die Zonen nur
bei einer Änderung neu und führt in `autark_sync_status` den Zeitpunkt des
letzten Syncs, damit ein Ausfall auffällt. Eine leere Liste wird nicht
gesendet (sonst wären alle Zonen weg); zum bewussten Leeren
`AUTARK_ALLOW_EMPTY=1` setzen. Die Datenbank wird nur lesend geöffnet.

Als Zone gilt (nicht ausgeblendet, Symbol BTCUSDT): **Rechteck** (von–bis),
**Horizontale** und **horizontaler Strahl** (einzelnes Level). Der Name kommt
aus dem Text der Zeichnung.

## Tests

```bash
python3 -m unittest tools/autark-sync/test_autark_sync.py
```
