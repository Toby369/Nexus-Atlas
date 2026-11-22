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

Seit 22.11.2026 zusaetzlich ALLE Zeichnungen (read_drawings): jeder Typ ausser
pinsel und emoji, nie versteckte. Gesendet im selben Request als "drawings"
(Nexus-Tabelle autark_drawings). Beim AVWAP speichert AutarkTrade nur den
Anker (punkte[0].t); den Wert rechnet Nexus selbst aus den Kerzen.

Konfiguration ueber Umgebungsvariablen:
  AUTARK_DB          Pfad zu autarktrade.db (Pflicht)
  NEXUS_SYNC_URL     https://<projekt>.supabase.co/functions/v1/autark-sync
  NEXUS_SYNC_SECRET  geheimer Schluessel (gleich wie AUTARK_SYNC_SECRET in Supabase)
  AUTARK_SYMBOL      Standard BTCUSDT
  AUTARK_ALLOW_EMPTY 1 = auch eine leere Liste senden (loescht alle Zonen in Nexus)

Aufruf:
  autark_sync.py --dry-run     zeigt die gefundenen Zonen, sendet nichts
  autark_sync.py --once        sendet einmal
  autark_sync.py --loop 300    laeuft dauerhaft, alle 300 Sekunden

Gesendet wird bei jedem Lauf, auch ohne Aenderung: Nexus fuehrt damit den
Zeitpunkt des letzten Syncs (autark_sync_status) und erkennt einen Ausfall.
Unveraenderte Zonen schreibt Nexus nicht neu.
"""

from __future__ import annotations

import argparse
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
# Ohne Handelsbedeutung (Pinsel bis 250 Punkte) bzw. reine Deko.
SKIP_DRAWING_TYPES = ("pinsel", "emoji")
MAX_DRAWINGS = 300
MAX_POINTS = 30
STYLE_KEYS = ("text", "rechts", "links", "baender", "stufen")


def _json(raw, default):
    try:
        val = json.loads(raw) if raw else default
    except (json.JSONDecodeError, TypeError):
        return default
    return val


def read_drawings(db_path: str, symbol: str) -> list[dict]:
    """Alle sichtbaren Zeichnungen eines Symbols ausser pinsel/emoji, nur lesend."""
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        rows = con.execute(
            "select id, typ, punkte, stil, sichtbarAuf, geaendertAm from chart_zeichnungen "
            "where symbol = ? and coalesce(versteckt, 0) = 0 and typ not in (?, ?) order by id",
            (symbol, *SKIP_DRAWING_TYPES),
        ).fetchall()
    finally:
        con.close()

    drawings = []
    for did, typ, punkte_raw, stil_raw, sichtbar_raw, geaendert in rows:
        punkte = _json(punkte_raw, None)
        if not isinstance(punkte, list) or not punkte:
            continue
        points = [
            {"t": p["t"], "p": p["p"]}
            for p in punkte[:MAX_POINTS]
            if isinstance(p, dict) and isinstance(p.get("t"), (int, float)) and isinstance(p.get("p"), (int, float))
        ]
        if not points:
            continue
        stil = _json(stil_raw, {})
        stil = stil if isinstance(stil, dict) else {}
        style = {k: stil[k] for k in STYLE_KEYS if k in stil}
        label = stil.get("text") if isinstance(stil.get("text"), str) else ""
        sichtbar = _json(sichtbar_raw, None)
        drawings.append(
            {
                "id": int(did),
                "kind": typ,
                "label": label.strip()[:120],
                "points": points,
                "style": style,
                "visible_on": sichtbar if isinstance(sichtbar, list) else None,
                "updated_at": int(geaendert) if isinstance(geaendert, (int, float)) and geaendert > 0 else None,
            }
        )
    return drawings[:MAX_DRAWINGS]


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


def send(
    url: str, secret: str, symbol: str, zones: list[dict], allow_empty: bool = False, drawings: list[dict] | None = None
) -> dict:
    payload = {"symbol": symbol, "zones": zones, "allow_empty": allow_empty}
    # Leere Zeichnungsliste nur mitsenden, wenn ausdruecklich erlaubt: sonst
    # wuerde ein Lesefehler alle Zeichnungen in Nexus loeschen.
    if drawings or (drawings is not None and allow_empty):
        payload["drawings"] = drawings
    body = json.dumps(payload).encode()
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


def run_once(cfg: dict) -> str:
    zones = read_zones(cfg["db"], cfg["symbol"])
    if not zones and not cfg.get("allow_empty"):
        # Lieber alte Zonen in Nexus behalten als sie wegen eines Lesefehlers
        # oder einer leeren Datenbank still zu loeschen.
        return "keine Zonen gefunden, nichts gesendet (AUTARK_ALLOW_EMPTY=1 zum Leeren)"
    drawings = read_drawings(cfg["db"], cfg["symbol"])
    result = send(cfg["url"], cfg["secret"], cfg["symbol"], zones, bool(cfg.get("allow_empty")), drawings)
    if not result.get("success"):
        raise RuntimeError(f"Nexus meldet Fehler: {result}")
    msg = f"{result.get('zones', len(zones))} Zonen"
    if result.get("drawings") is not None:
        msg += f", {result['drawings']} Zeichnungen"
    if result.get("skipped"):
        msg += f" (übersprungen: {'; '.join(result['skipped'])})"
    return msg + " an Nexus übertragen"


def config_from_env() -> dict:
    return {
        "db": os.environ.get("AUTARK_DB", ""),
        "url": os.environ.get("NEXUS_SYNC_URL", ""),
        "secret": os.environ.get("NEXUS_SYNC_SECRET", ""),
        "symbol": os.environ.get("AUTARK_SYMBOL", "BTCUSDT"),
        "allow_empty": os.environ.get("AUTARK_ALLOW_EMPTY") == "1",
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Zonen aus AutarkTrade nach Nexus übertragen")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Zonen anzeigen, nichts senden")
    mode.add_argument("--once", action="store_true", help="einmal senden (bei Änderung oder stündlich)")
    mode.add_argument("--loop", type=int, metavar="SEKUNDEN", help="dauerhaft im Abstand senden")
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
        drawings = read_drawings(cfg["db"], cfg["symbol"])
        print(f"{len(drawings)} Zeichnungen für {cfg['symbol']}:")
        for d in drawings:
            print(f"  {d['kind']:>12}  {len(d['points'])} Punkte  {d['label'] or '(ohne Namen)'}")
        return 0

    if not cfg["url"] or not cfg["secret"]:
        print("NEXUS_SYNC_URL und NEXUS_SYNC_SECRET müssen gesetzt sein.", file=sys.stderr)
        return 2

    if args.once:
        try:
            print(run_once(cfg))
            return 0
        except Exception as e:  # noqa: BLE001 - Fehler soll im Log landen, nicht abstuerzen
            print(f"Fehler: {e}", file=sys.stderr)
            return 1

    while True:
        try:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), run_once(cfg), flush=True)
        except Exception as e:  # noqa: BLE001
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"Fehler: {e}", file=sys.stderr, flush=True)
        time.sleep(max(30, args.loop))


if __name__ == "__main__":
    sys.exit(main())
