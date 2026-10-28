#!/usr/bin/env python3
"""Zonen aus AutarkTrade nach Nexus uebertragen.

Liest Tobys Zeichnungen aus der AutarkTrade-Datenbank (SQLite, nur lesend)
und schickt die Zonen an die Nexus Edge Function ``autark-sync``. Dort
ersetzen sie die eigenen Zonen (own_zones). An AutarkTrade wird nichts
geaendert. Plan: docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md.

Was als Zone gilt (Tabelle chart_zeichnungen, nicht versteckt):
  rechteck     -> Bereich vom tiefsten bis zum hoechsten Punkt
  horizontale  -> einzelnes Level (von = bis)
  strahlH      -> horizontaler Strahl, einzelnes Level
Der Name kommt aus dem Text der Zeichnung (stil.text).

Konfiguration ueber Umgebungsvariablen:
  AUTARK_DB          Pfad zu autarktrade.db (Pflicht)
  NEXUS_SYNC_URL     https://<projekt>.supabase.co/functions/v1/autark-sync
  NEXUS_SYNC_SECRET  geheimer Schluessel (gleich wie AUTARK_SYNC_SECRET in Supabase)
  AUTARK_SYMBOL      Standard BTCUSDT
  AUTARK_STATE       Datei fuer den letzten Stand (Standard ~/.autark_sync_state)

Aufruf:
  autark_sync.py --dry-run     zeigt die gefundenen Zonen, sendet nichts
  autark_sync.py --once        sendet einmal (nur bei Aenderung, sonst stuendlich)
  autark_sync.py --loop 300    laeuft dauerhaft, alle 300 Sekunden
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ZONE_TYPES = ("rechteck", "horizontale", "strahlH")
MAX_ZONES = 60
HEARTBEAT_SECONDS = 3600


def read_zones(db_path: str, symbol: str) -> list[dict]:
    """Zonen eines Symbols aus chart_zeichnungen, nur lesend geoeffnet."""
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        rows = con.execute(
            "select id, typ, punkte, stil from chart_zeichnungen "
            "where symbol = ? and coalesce(versteckt, 0) = 0 and typ in (?, ?, ?) order by id",
            (symbol, *ZONE_TYPES),
        ).fetchall()
    finally:
        con.close()

    zones = []
    for zid, typ, punkte_raw, stil_raw in rows:
        try:
            punkte = json.loads(punkte_raw or "[]")
            stil = json.loads(stil_raw or "{}")
        except json.JSONDecodeError:
            continue
        prices = [float(p["p"]) for p in punkte if isinstance(p, dict) and isinstance(p.get("p"), (int, float))]
        prices = [p for p in prices if p > 0]
        if not prices:
            continue
        if typ == "rechteck":
            lo, hi = min(prices), max(prices)
        else:
            lo = hi = prices[0]
        label = stil.get("text") if isinstance(stil, dict) and isinstance(stil.get("text"), str) else ""
        zones.append({"id": int(zid), "lo": round(lo, 2), "hi": round(hi, 2), "label": label.strip()[:120]})
    return zones[:MAX_ZONES]


def fingerprint(zones: list[dict]) -> str:
    return hashlib.sha256(json.dumps(zones, sort_keys=True).encode()).hexdigest()


def load_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path: Path, state: dict) -> None:
    try:
        path.write_text(json.dumps(state))
    except OSError as e:
        print(f"Stand nicht gespeichert: {e}", file=sys.stderr)


def send(url: str, secret: str, symbol: str, zones: list[dict]) -> dict:
    body = json.dumps({"symbol": symbol, "zones": zones}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"Nexus antwortet {e.code}: {detail}") from None


def run_once(cfg: dict, state_path: Path, force: bool = False) -> str:
    zones = read_zones(cfg["db"], cfg["symbol"])
    fp = fingerprint(zones)
    state = load_state(state_path)
    due = force or state.get("fingerprint") != fp or time.time() - state.get("sent_at", 0) > HEARTBEAT_SECONDS
    if not due:
        return f"unverändert ({len(zones)} Zonen), nichts gesendet"
    result = send(cfg["url"], cfg["secret"], cfg["symbol"], zones)
    if not result.get("success"):
        raise RuntimeError(f"Nexus meldet Fehler: {result}")
    save_state(state_path, {"fingerprint": fp, "sent_at": time.time()})
    return f"{result.get('zones', len(zones))} Zonen an Nexus übertragen"


def config_from_env() -> dict:
    return {
        "db": os.environ.get("AUTARK_DB", ""),
        "url": os.environ.get("NEXUS_SYNC_URL", ""),
        "secret": os.environ.get("NEXUS_SYNC_SECRET", ""),
        "symbol": os.environ.get("AUTARK_SYMBOL", "BTCUSDT"),
        "state": os.environ.get("AUTARK_STATE", str(Path.home() / ".autark_sync_state")),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Zonen aus AutarkTrade nach Nexus übertragen")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Zonen anzeigen, nichts senden")
    mode.add_argument("--once", action="store_true", help="einmal senden (bei Änderung oder stündlich)")
    mode.add_argument("--loop", type=int, metavar="SEKUNDEN", help="dauerhaft im Abstand senden")
    ap.add_argument("--force", action="store_true", help="auch ohne Änderung senden")
    args = ap.parse_args(argv)

    cfg = config_from_env()
    if not cfg["db"] or not Path(cfg["db"]).exists():
        print(f"AUTARK_DB fehlt oder Datei nicht gefunden: {cfg['db']!r}", file=sys.stderr)
        return 2

    if args.dry_run:
        zones = read_zones(cfg["db"], cfg["symbol"])
        print(f"{len(zones)} Zonen für {cfg['symbol']}:")
        for z in sorted(zones, key=lambda z: -z["hi"]):
            span = f"{z['lo']:,.0f}" if z["lo"] == z["hi"] else f"{z['lo']:,.0f}–{z['hi']:,.0f}"
            print(f"  {span:>20}  {z['label'] or '(ohne Namen)'}")
        return 0

    if not cfg["url"] or not cfg["secret"]:
        print("NEXUS_SYNC_URL und NEXUS_SYNC_SECRET müssen gesetzt sein.", file=sys.stderr)
        return 2

    state_path = Path(cfg["state"])
    if args.once:
        try:
            print(run_once(cfg, state_path, force=args.force))
            return 0
        except Exception as e:  # noqa: BLE001 - Fehler soll im Log landen, nicht abstuerzen
            print(f"Fehler: {e}", file=sys.stderr)
            return 1

    while True:
        try:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), run_once(cfg, state_path, force=args.force), flush=True)
        except Exception as e:  # noqa: BLE001
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"Fehler: {e}", file=sys.stderr, flush=True)
        args.force = False
        time.sleep(max(30, args.loop))


if __name__ == "__main__":
    sys.exit(main())
