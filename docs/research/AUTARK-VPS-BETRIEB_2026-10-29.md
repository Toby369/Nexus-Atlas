# AutarkTrade auf dem VPS — Betrieb

Eingerichtet am 29.10.2026 mit Toby (Phase B aus
[AUTARK-NEXUS-PLAN_2026-10-28.md](AUTARK-NEXUS-PLAN_2026-10-28.md)).
Geheimnisse stehen hier bewusst nicht drin.

## Überblick

| Was | Wert |
|---|---|
| Server | Infomaniak VPS Lite, 1 CPU / 2 GB / 20 GB, Ubuntu 24.04, Satigny (GE), läuft bis 29.10.2027 |
| Name / öffentliche IP | `ov-ebda03` / 83.228.196.247 (seit 29.10. kein Port öffentlich offen, SSH nur über Tailscale) |
| Tailscale-IP | 100.84.223.106 |
| **AutarkTrade öffnen** | **https://ov-ebda03.tail55bb6a.ts.net** (nur mit aktivem Tailscale) |
| Anmeldung am Server | `ssh vps` vom PC (Eintrag in `~/.ssh/config`, Benutzer `ubuntu`, Schlüssel `~/.ssh/id_vps` ohne Passwort, seit 10.11.2026) |
| Tailscale-Geräte | Server `ov-ebda03`, PC `bernet`, Handy `fairphone-4-5g` |

Die alte Installation auf dem PC (`~/Schreibtisch/Crypto-Trading-Journal`)
ist gestoppt und wird nicht mehr gestartet, sonst entstehen zwei
Datenstände. Ordner und `.at-secret` dort bleiben als Reserve liegen —
`.at-secret` nicht löschen, ohne sie sind die Börsenschlüssel in einer
Sicherung nicht lesbar.

## Selbst erledigen (ohne Claude)

Alles im Terminal am PC. Einfügen im Terminal mit **Ctrl+Shift+V**
(nicht Ctrl+V), kopieren mit Ctrl+Shift+C. `ssh vps` öffnet das
Serverfenster: die Zeile beginnt dann mit `ubuntu@ov-ebda03`, am PC mit
`tb@Bernet`. Hängt das Fenster, schliessen und neu `ssh vps`.

**AutarkTrade-Update**: ausführliche Anleitung in [AUTARKTRADE-UPDATE.md](../AUTARKTRADE-UPDATE.md). Kurzform (wenn unten links „Update vX.Y.Z“ steht):

```bash
ssh vps
cd ~/autarktrade && docker compose pull && docker compose up -d
docker compose logs --tail 20 journal | grep -i -E "version|ready|FAILED"
```

Erwartet: `AutarkTrade ready!` und die neue Version. Seite im Browser neu
laden. Daten, Passwort und Einstellungen bleiben erhalten. Nicht den
Update-Knopf in der App verwenden (funktioniert im Container nicht).
Vorsichtig sein, wenn das Update eine neue `docker-compose.yml` verlangt
(Hinweis in den Release Notes): dann zuerst fragen, die eigene
`docker-compose.override.yml` bleibt aber in jedem Fall gültig.

**Monatlich: Systemupdates des Servers**

```bash
ssh vps
sudo apt update && sudo apt upgrade -y
```

Steht danach „System restart required“ oder „kernel“: `sudo reboot`, eine
Minute warten, neu `ssh vps`. AutarkTrade, Tailscale, Sync und Sicherung
starten von selbst. Die Meldung „New release '26.04 LTS' available“ ignorieren: kein
`do-release-upgrade`, 24.04 bekommt noch jahrelang Sicherheitsupdates. Kontrolle: `docker compose -f ~/autarktrade/docker-compose.yml ps`
zeigt `Up`.

**Kontrolle, ob alles läuft** (kurz, z. B. wöchentlich)

```bash
ssh vps
docker ps --format '{{.Names}} {{.Status}}'          # autarktrade Up …
journalctl --user -u autark-sync -n 3 --no-pager      # „… Zonen an Nexus übertragen“
ls -lh ~/backups | tail -3                            # Sicherung von heute/gestern
df -h /                                               # Platz (Use% unter 80 %)
```

Am PC: `ls -lh ~/AutarkTrade-Backups | tail -3` zeigt die abgeholten Sicherungen.

**Wenn etwas nicht geht**

| Anzeichen | Was tun |
|---|---|
| Seite lädt nicht | Tailscale am Gerät an? Dann `ssh vps` → `cd ~/autarktrade && docker compose up -d` |
| „Unbekannter Host“ | Adresse genau so: `https://ov-ebda03.tail55bb6a.ts.net` |
| Nexus-Zonen-Kachel „Zonen veraltet“ | `journalctl --user -u autark-sync -n 10 --no-pager` lesen; „401“ = Sync-Geheimnis passt nicht mehr (Abschnitt Geheimnisse) |
| Keine Alarme in Nexus | AutarkTrade › Einstellungen › Benachrichtigungen › Webhook › Test-Knopf |
| `ssh vps` geht nicht | Tailscale am PC an (`tailscale status`)? Über die öffentliche IP geht es nicht mehr. „Permission denied (publickey)“ oder „agent refused operation“: Schlüssel prüfen (Abschnitt Notzugang) |
| Passwort vergessen | siehe unten |

**Passwort vergessen** (Notfall-Reset von AutarkTrade, `AT_RESET_AUTH`):

```bash
ssh vps
cd ~/autarktrade
echo 'AT_RESET_AUTH=1' >> .env && docker compose up -d --force-recreate && sleep 20
sed -i '/^AT_RESET_AUTH=/d' .env && docker compose up -d --force-recreate
docker compose logs journal | grep Einrichtungscode | tail -1
```

Danach im Browser mit dem Code ein neues Passwort festlegen. Die zweite
Zeile muss mitlaufen, sonst wäre der Schutz bei jedem Neustart wieder aus.

**Jährlich:** Der VPS läuft bis 29.10.2027, Verlängerung im
Infomaniak-Manager (Buchhaltung › Verlängerung).

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
- Firewall (ufw): einzige Regel `22/tcp on tailscale0`. Docker-Ports nur auf `127.0.0.1`.
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

## Notzugang (Schlüssel verloren)

Am 10.11.2026 nötig gewesen: Das Passwort des ersten Schlüssels
`~/.ssh/id_ed25519` („autarktrade-vps“) war nicht mehr bekannt, und der
gespeicherte Wert in Schlüsselbund und Proton Pass passte nicht. Deshalb
gilt jetzt `~/.ssh/id_vps` („tb@Bernet“, ohne Passwort). Der alte Schlüssel
steht noch in `authorized_keys`, ist aber ohne Passwort nutzlos.

`~/.ssh/config` am PC:

```
Host vps
    HostName 100.84.223.106
    User ubuntu
    IdentityFile ~/.ssh/id_vps
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 4
```

Die VNC-Konsole hilft nicht (der Benutzer `ubuntu` hat kein Passwort), und
„Öffentliche Schlüssel verwalten“ im Infomaniak-Manager gilt nur für neue
Server. Weg über den abgesicherten Modus:

1. Infomaniak-Manager › VPS › autarktrade › „Server neu starten
   (abgesicherter Modus)“. AutarkTrade ist dann offline. Benutzer
   `infomaniak`, temporäres Passwort wird angezeigt (läuft nach kurzer
   Zeit ab, dann neu starten). Keine VNC-Konsole in diesem Modus.
2. Am PC (öffentliche IP, im Rettungssystem läuft kein Tailscale):
   ```bash
   ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null infomaniak@83.228.196.247
   ```
3. Dort `sudo -i`, `lsblk` (Serverplatte ist `sdb1`, 19 GB), dann:
   ```bash
   mount /dev/sdb1 /mnt
   echo '<Inhalt von ~/.ssh/NEUER_SCHLUESSEL.pub>' >> /mnt/home/ubuntu/.ssh/authorized_keys
   sync && umount /mnt
   ```
   Besitzer erscheint dort als `infomaniak netdev`, das ist dieselbe
   Benutzernummer wie `ubuntu` und richtig so.
4. Abgesicherten Modus im Manager beenden, `ssh vps` testen.

**Nie „Server zurücksetzen“ wählen**, das setzt den Server neu auf.

## Offen

1. ~~AutarkTrade-Update~~ erledigt am 10.11.2026: v4.3.6 läuft, Sync danach geprüft (11 Zonen).
   Für die Sicherung vor einem Update fehlt `sqlite3` auf dem Server
   (`sudo apt install sqlite3`), bis dahin genügt die nächtliche Sicherung.
2. Nexus-Datenbank (Supabase Free, 0,5 GB): am 29.10. abends 289 MB
   (`pg_database_size`). Ausdünnung läuft schon per Cron
   (`downsample_old_snapshots`: nach 35 Tagen stündlich,
   `purge_old_snapshots`: nach 90 Tagen weg, 1m-Kerzen nach 14 Tagen).
   Ohne eigene Aufbewahrungsregel wachsen noch `market_states`,
   `market_features`, `candles` (zusammen etwa 0,3 MB/Tag).
3. Phase C (Doppeltes in Nexus aufräumen): Liste am 29.10. an die
   Aufräum-Session, Vorschlag kommt dort, Toby entscheidet pro Punkt.
4. Claude Code mit Remote Control auf dem Server entfällt vorerst (Abo pausiert).
