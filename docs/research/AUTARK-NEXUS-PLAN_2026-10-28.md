# AutarkTrade und Nexus verbinden — Plan (28.10.2026)

Toby arbeitet ab jetzt in **AutarkTrade** (Mouses007/AutarkTrade, lokal auf
seinem Linux-Rechner, bald auf einem Infomaniak VPS Lite). TradingView fällt
später weg. Alles Relevante soll aus AutarkTrade nach Nexus fliessen.

## Rollen

| | AutarkTrade (Cockpit) | Nexus (Datenzentrale und Lernort) |
|---|---|---|
| Chart, Zeichnungen, Zonen, Fixed Range Volume | führt | übernimmt Zonen automatisch |
| Alarme (Preis, Linie, Zone, alle 5 s serverseitig) | führt | empfängt per Webhook |
| Trades, Tagebuch, Playbook, Session-Plan | führt | — |
| Positionierung 4 Börsen, Spot-Taker-Flow, Spot- gegen Perp-CVD | — | führt |
| ETF-Flows, CME-Basis, Coinbase-Prämie, Marktzustand, Backtests | — | führt |
| Lernen, Tagesplan, Trade-Entscheider | — | führt |

**An AutarkTrade wird kein Code geändert.** Updates von Mouses007 laufen
weiter normal. Toby trägt nur in den Einstellungen eine Webhook-Adresse ein.
Der Zonen-Sync liest die Datenbank nur lesend.

## Phase A — Verbindung (ab 28.10.)

1. **Alarm-Empfänger**: Edge Function `webhook-autark`, Geheimnis in der URL
   (AutarkTrades Webhook schickt keine eigenen Header). Tabelle
   `autark_alarms`. Anzeige der heutigen Alarme im Tagesplan.
   Payload von AutarkTrade (`server/hype-radar/zustellung.js`, `webhook()`):
   `{quelle, regel, schwere, symbol, chain, meldung, daten, ts}`; bei
   Chart-Alarmen `quelle: "chart"`, `regel: "chartAlarm"`,
   `daten: {alarmId, art, symbol, preis, niveau}`.
2. **Zonen-Sync**: Skript `tools/autark-sync/autark_sync.py` (nur
   Python-Standardbibliothek) liest `chart_zeichnungen` (Rechtecke,
   Horizontale, horizontale Strahlen, nicht versteckt) aus `autarktrade.db`
   im Nur-Lese-Modus und schickt sie alle 5 Min. an die Edge Function
   `autark-sync`. Die ersetzen `own_zones` (Toby: „Journal-Zonen sollen eigene
   Zonen ersetzen"). `own_zones` bekommt dafür Bereich, Name und Quelle.
3. **Abstimmung mit der Aufräum-Session** (Zonen-Kachel, Doppeltes).

## Phase B — VPS (ab 29.10. morgens, gemeinsam mit Toby)

1. VPS Lite bestellen (1 vCPU, 2 GB RAM, 20 GB). Vorher prüfen, wie gross
   `autarktrade.db` ist und wie schnell sie wächst.
2. Zugang nur per SSH-Schlüssel, Firewall zu bis auf SSH.
3. **Tailscale**: AutarkTrade nur von Tobys Geräten erreichbar, nicht
   öffentlich. Webhook und Sync gehen vom Server nach aussen, das
   funktioniert trotzdem.
4. Docker und AutarkTrade als fertiges Image
   (`ghcr.io/mouses007/autarktrade`), Datenbank vom PC übernehmen,
   `AT_SECRET` mit mindestens 32 Zeichen, Börsen-Schlüssel nur mit Leserechten.
5. Zonen-Sync als Dienst neben AutarkTrade, Webhook-Adresse eintragen.
6. Claude Code und Remote Control auf dem VPS, damit die Betreuung direkt
   dort laufen kann (Ordner muss ein Git-Repository sein, z. B. `~/autark-ops`
   mit docker-compose und Konfiguration).
7. Backups regelmässig weg vom Server.

## Phase C — Aufräumen in Nexus

Mit der Aufräum-Session festlegen, was wegfällt, weil AutarkTrade es führt:
eigene Zonen-Eingabe, doppelter Nachrichtenbericht und Kalender,
TradingView-Webhook (nach Wegfall des Kontos).

## Nicht geplant

Tagebuch nach Nexus kopieren: AutarkTrade hat Tagebuch und Session-Auswertung
schon. Später denkbar: Session-Plan und Ergebnis nach Nexus, um Disziplin und
Ergebnis mit der Marktlage zu vergleichen.
