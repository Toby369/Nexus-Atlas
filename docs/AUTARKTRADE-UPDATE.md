# AutarkTrade updaten (VPS) — Anleitung zum Kopieren

Alles im Terminal am PC. **Einfügen mit Ctrl+Shift+V** (nicht Ctrl+V).
Dauer: etwa 5 Minuten. Mit Kopier-Knöpfen: [autarktrade-update.html](autarktrade-update.html) (herunterladen, im Browser öffnen). Hintergrund und Notfälle:
[AUTARK-VPS-BETRIEB_2026-10-29.md](research/AUTARK-VPS-BETRIEB_2026-10-29.md).

**Wann?** Wenn in AutarkTrade unten links „Update vX.Y.Z“ steht.
**Nicht** den Update-Knopf in der App verwenden (geht im Container nicht).

---

## 0. Einmalig (am 10.11.2026 erledigt, nur bei einem neuen Server nötig)

Auf dem Server das Sicherungswerkzeug installieren:

```bash
ssh vps
```
```bash
sudo apt update && sudo apt install -y sqlite3
```
```bash
exit
```

---

## 1. Anmelden

Tailscale am PC muss an sein.

```bash
ssh vps
```

✅ Die Zeile beginnt mit `ubuntu@ov-ebda03`.
❌ Fehler? → Abschnitt „Probleme“ unten.

## 2. Aktuelle Version anzeigen

```bash
cd ~/autarktrade && docker compose ps && docker compose logs journal | grep -i "version" | tail -1
```

✅ `Up …` und eine Version, z. B. `v4.3.6`. Nur anschauen, nichts notieren:
in Schritt 5 muss dort eine höhere Nummer stehen (im Terminal hochscrollen).

## 3. Sicherung machen

```bash
sqlite3 data/tradenote.db ".backup '/home/ubuntu/backups/vor-update-$(date +%F).db'" && ls -lh ~/backups | tail -2
```

✅ Eine Datei `vor-update-JJJJ-MM-TT.db`, Grösse ungefähr 100 MB oder mehr.
❌ `sqlite3: command not found` → Schritt 0 machen.

Altes Programm-Image merken (für den Fall, dass zurück muss):

```bash
docker image tag ghcr.io/mouses007/autarktrade:latest autarktrade:vorher && echo OK
```

✅ `OK`

## 4. Update

```bash
docker compose pull && docker compose up -d
```

✅ `Pulled` und `Started`.

## 5. Prüfen

20 Sekunden warten, dann:

```bash
docker compose logs --tail 40 journal | grep -i -E "version|ready|FAILED|error"
```

✅ `AutarkTrade ready!` und die **neue** Version.

Im Browser AutarkTrade neu laden: https://ov-ebda03.tail55bb6a.ts.net
✅ Unten links steht die neue Version, Daten sind da.

5 Minuten später den Zonen-Sync zu Nexus prüfen:

```bash
journalctl --user -u autark-sync -n 3 --no-pager
```

✅ Letzte Zeile mit heutiger Uhrzeit und „… Zonen an Nexus übertragen“.

## 6. Abmelden

```bash
exit
```

**Fertig.** 🎉

---

## Monatlich: Systemupdates des Servers

```bash
ssh vps
```
```bash
sudo apt update && sudo apt upgrade -y
```

Steht danach „System restart required“:

```bash
sudo reboot
```

1 Minute warten, dann kontrollieren:

```bash
ssh vps
```
```bash
docker ps --format '{{.Names}} {{.Status}}'
```

✅ `autarktrade Up …`

Die Meldung „New release '26.04 LTS' available“ **ignorieren**, kein `do-release-upgrade`.

---

## Zurück zur alten Version (nur wenn das Update kaputt ist)

Zum Beispiel: kein `ready!`, die Seite lädt nicht, oder Fehler in Schritt 5.

```bash
ssh vps
```
```bash
cd ~/autarktrade && docker image tag autarktrade:vorher ghcr.io/mouses007/autarktrade:latest && docker compose up -d --force-recreate
```

20 Sekunden warten, dann Schritt 5 wiederholen. Startet die alte Version
nicht (die Datenbank wurde vom Update schon umgebaut), die Sicherung aus
Schritt 3 zurückspielen. `JJJJ-MM-TT` durch das Datum der Sicherung ersetzen:

```bash
cd ~/autarktrade && docker compose stop journal
```
```bash
mv data/tradenote.db data/tradenote.db.kaputt; rm -f data/tradenote.db-wal data/tradenote.db-shm
```
```bash
cp ~/backups/vor-update-JJJJ-MM-TT.db data/tradenote.db && docker compose start journal
```

Danach **nicht** erneut updaten, bis der Fehler geklärt ist (Claude fragen).

---

## Probleme

| Meldung | Was tun |
|---|---|
| `ssh: connect to host … timed out` | Tailscale am PC ist aus. Einschalten, dann nochmals `ssh vps`. |
| `Permission denied (publickey)` | `cat ~/.ssh/config` muss `IdentityFile ~/.ssh/id_vps` enthalten. Sonst Abschnitt „Notzugang“ in der Betriebsdoku. |
| `Enter passphrase for key …id_ed25519` | Falscher Schlüssel. Mit Ctrl+C abbrechen, `~/.ssh/config` prüfen (wie oben). |
| Seite lädt nicht | Tailscale am Gerät an? Dann `ssh vps` und `cd ~/autarktrade && docker compose up -d` |
| „Unbekannter Host“ | Adresse genau so: `https://ov-ebda03.tail55bb6a.ts.net` |
| Release Notes verlangen eine neue `docker-compose.yml` | Nicht selbst ändern, zuerst Claude fragen. |
| Sync-Zeile zeigt `401` | Sync-Geheimnis passt nicht mehr, Claude fragen. |

**Nie** im Infomaniak-Manager „Server zurücksetzen“ wählen, das löscht alles.
