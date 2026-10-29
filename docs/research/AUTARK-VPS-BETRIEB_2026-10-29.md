# AutarkTrade auf dem VPS — Betrieb

Eingerichtet am 29.10.2026 mit Toby (Phase B aus
[AUTARK-NEXUS-PLAN_2026-10-28.md](AUTARK-NEXUS-PLAN_2026-10-28.md)).
Geheimnisse stehen hier bewusst nicht drin.

## Überblick

| Was | Wert |
|---|---|
| Server | Infomaniak VPS Lite, 1 CPU / 2 GB / 20 GB, Ubuntu 24.04, Satigny (GE), läuft bis 29.10.2027 |
| Name / öffentliche IP | `ov-ebda03` / 83.228.196.247 (nur SSH offen) |
| Tailscale-IP | 100.84.223.106 |
| **AutarkTrade öffnen** | **https://ov-ebda03.tail55bb6a.ts.net** (nur mit aktivem Tailscale) |
| Anmeldung am Server | `ssh vps` vom PC (Eintrag in `~/.ssh/config`, Benutzer `ubuntu`) |
| Tailscale-Geräte | Server `ov-ebda03`, PC `bernet`, Handy `fairphone-4-5g` |

Die alte Installation auf dem PC (`~/Schreibtisch/Crypto-Trading-Journal`)
ist gestoppt und wird nicht mehr gestartet, sonst entstehen zwei
Datenstände. Ordner und `.at-secret` dort bleiben als Reserve liegen —
`.at-secret` nicht löschen, ohne sie sind die Börsenschlüssel in einer
Sicherung nicht lesbar.

## Aufbau auf dem Server

```
~/autarktrade/
  docker-compose.yml           # unverändert aus dem AutarkTrade-Repo (master)
  docker-compose.override.yml  # Ports nur 127.0.0.1, Daten als Ordner ./data
  .env                         # DB_TYPE=sqlite, AT_SECRET, AT_ALLOWED_HOSTS (chmod 600)
  data/tradenote.db            # die Datenbank (alter Dateiname, AutarkTrade nimmt ihn)
~/backups/                     # tägliche Sicherungen, 14 Tage
~/bin/autark-backup.py         # Sicherungs-Skript
~/.local/share/autark-sync/    # Zonen-Sync (tools/autark-sync aus diesem Repo)
~/.config/autark-sync.env      # Sync-Konfiguration mit NEXUS_SYNC_SECRET (chmod 600)
~/.config/systemd/user/        # autark-sync.timer (5 min), autark-backup.timer (03:30 UTC)
```

- AutarkTrade lauscht nur auf `127.0.0.1:8080`. Nach aussen reicht es
  `tailscale serve` als HTTPS ins Tailnet weiter. Ports nie ohne
  `127.0.0.1:` veröffentlichen: Docker umgeht die Firewall (ufw).
- `AT_PORT` nicht in die `.env` schreiben: die App liest den Wert im
  Container selbst und startet dann nicht (`listen EACCES`).
- `AT_ALLOWED_HOSTS=ov-ebda03.tail55bb6a.ts.net`, sonst meldet AutarkTrade
  „Unbekannter Host“.
- Benutzer-Timer laufen auch ohne Anmeldung (`loginctl enable-linger ubuntu`).

## Verbindung zu Nexus

| Weg | Wie | Kontrolle |
|---|---|---|
| Zonen | `autark-sync.timer` alle 5 min → Edge Function `autark-sync` | Tabelle `autark_sync_status` (`last_sync_at`), `journalctl --user -u autark-sync -n 5` |
| Alarme | AutarkTrade › Einstellungen › Benachrichtigungen › Webhook → `webhook-autark?key=…` | Tagesplan „Alarme aus AutarkTrade“, Tabelle `autark_alarms` |

Erster Sync am 29.10. 15:56 UTC mit 8 Zonen, Webhook-Test 16:05 UTC angekommen.

## Häufige Befehle (auf dem Server, nach `ssh vps`)

```bash
cd ~/autarktrade
docker compose ps                         # läuft es?
docker compose logs --tail 50 journal     # Protokoll
docker compose pull && docker compose up -d   # Update auf neue Version
docker compose restart journal            # Neustart
journalctl --user -u autark-sync -n 5 --no-pager    # Zonen-Sync
ls -lh ~/backups                          # Sicherungen
sudo apt update && sudo apt upgrade -y    # Systemupdates (danach ggf. sudo reboot)
```

Neuer Einrichtungscode (nur nötig, wenn das Passwort neu gesetzt werden muss):
`docker compose logs journal | grep Einrichtungscode | tail -1`

## Sicherungen

- Server: jede Nacht 03:30 UTC eine konsistente Kopie
  (`sqlite3`-Backup, gepackt, ~57 MB), 14 Tage.
- PC: `autark-backup-holen.timer` holt täglich (09:00 und 10 min nach dem
  Start) alles nach `~/AutarkTrade-Backups` (rsync über `ssh vps`, braucht
  den entsperrten Schlüsselbund).

**Zurückspielen** (Server):

```bash
cd ~/autarktrade && docker compose stop journal
mv data/tradenote.db data/tradenote.db.alt; rm -f data/tradenote.db-wal data/tradenote.db-shm
gunzip -c ~/backups/tradenote-JJJJ-MM-TT.db.gz > data/tradenote.db
docker compose start journal
```

## Geheimnisse

| Name | Liegt in | Wechseln |
|---|---|---|
| `AT_SECRET` | Server `.env`, PC `.at-secret` | nie ohne Umschlüsseln (`node server/reencrypt-keys.mjs`) |
| `AUTARK_SYNC_SECRET` | Supabase Secrets + Server `~/.config/autark-sync.env` | `openssl rand -hex 24`, an beiden Stellen ersetzen |
| `AUTARK_WEBHOOK_SECRET` | Supabase Secrets + AutarkTrade Webhook-Adresse (`?key=`) | wie oben |

Die beiden Nexus-Geheimnisse wurden am 29.10. einmal erneuert, weil die
ersten Werte auf einem Screenshot sichtbar waren.

## Offen

1. AutarkTrade-Update v4.3.2: `docker compose pull && docker compose up -d`.
2. Nexus-Datenbank (Supabase Free, 0,5 GB) lag am 29.10. bei 0,445 GB und
   wächst etwa 2–3 MB pro Tag: alte Daten automatisch ausdünnen, sonst
   Mitte November an der Grenze.
3. Phase C (Doppeltes in Nexus aufräumen) mit der Aufräum-Session.
4. Optional: SSH nur noch über Tailscale (`sudo ufw delete allow OpenSSH`
   und `sudo ufw allow in on tailscale0 to any port 22`) — erst wenn
   `ssh vps` zuverlässig funktioniert, sonst sperrt man sich aus
   (Notzugang: Konsole im Infomaniak-Manager).
5. Claude Code mit Remote Control auf dem Server entfällt vorerst (Abo pausiert).
