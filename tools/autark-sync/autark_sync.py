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

Seit 26.11.2026 zusaetzlich das Trade-Journal (read_trades), PRIVAT, in Nexus
nur serverseitig lesbar. Quelle (TradeNote-Schema, mit der AutarkTrade-Session
abgestimmt): trades (eine Zeile pro Tag und Boerse, Trades als JSON-Liste),
notes, tags, satisfactions, excursions (je tradeId = t{Tag}_0_{positionId}),
incoming_positions (nur OFFENE Positionen, werden beim Schliessen geloescht)
und aus settings NUR die Spalte tags (Tag-Namen). Nie gelesen: Screenshots,
aiReview, apis und alle anderen settings (Zugangsdaten). Bots (category bot)
fehlen absichtlich. Gesendet werden im Normalfall nur Trades, die in den
letzten 7 Tagen geaendert oder geschlossen wurden, plus alle offenen. Einmal
taeglich (und beim ersten Lauf, oder mit --full) alle Trades plus die
vollstaendige ID-Liste; Nexus markiert damit in AutarkTrade geloeschte Trades,
loescht aber nie.

Konfiguration ueber Umgebungsvariablen:
  AUTARK_DB          Pfad zu autarktrade.db (Pflicht)
  NEXUS_SYNC_URL     https://<projekt>.supabase.co/functions/v1/autark-sync
  NEXUS_SYNC_SECRET  geheimer Schluessel (gleich wie AUTARK_SYNC_SECRET in Supabase)
  AUTARK_SYMBOL      Standard BTCUSDT
  AUTARK_ALLOW_EMPTY 1 = auch eine leere Liste senden (loescht alle Zonen in Nexus)
  AUTARK_JOURNAL     0 = Journal nicht senden (Standard 1)
  AUTARK_STATE       Datei fuer den Zeitpunkt des letzten vollen Journal-Syncs

Aufruf:
  autark_sync.py --dry-run     zeigt die gefundenen Zonen, sendet nichts
  autark_sync.py --once        sendet einmal
  autark_sync.py --once --full sendet einmal mit allen Trades und der ID-Liste
  autark_sync.py --loop 300    laeuft dauerhaft, alle 300 Sekunden

Gesendet wird bei jedem Lauf, auch ohne Aenderung: Nexus fuehrt damit den
Zeitpunkt des letzten Syncs (autark_sync_status) und erkennt einen Ausfall.
Unveraenderte Zonen schreibt Nexus nicht neu.
"""

from __future__ import annotations

import argparse
import calendar
import json
import os
import re
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
# Journal
RECENT_DAYS = 7
FULL_EVERY_SECONDS = 24 * 3600
MAX_TRADES = 3000
NOTE_MAX = 4000


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


def _ts(v) -> int | None:
    """Unix-Sekunden aus 'YYYY-MM-DD HH:MM:SS' (UTC), ISO-Text, Sekunden oder ms."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        if v <= 0:
            return None
        return int(v / 1000) if v > 1e12 else int(v)
    if isinstance(v, str):
        txt = v.strip()
        if re.fullmatch(r"\d+(\.\d+)?", txt):
            return _ts(float(txt))
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", txt)
        if m:
            return calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))
    return None


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def _text(v, max_len: int = NOTE_MAX):
    """HTML (TradeNote-Editor) zu Text. Nexus zeigt es nie als HTML."""
    if not isinstance(v, str):
        return None
    t = re.sub(r"<\s*(br|/p|/div|/li)[^>]*>", "\n", v, flags=re.I)
    t = re.sub(r"<[^>]*>", "", t)
    for a, b in (("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"), ("&amp;", "&")):
        t = t.replace(a, b)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t).strip()
    return t[:max_len] if t else None


def _level(v):
    n = _num(v)
    return n if n is not None and n >= 0 else None


def _columns(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"pragma table_info({table})").fetchall()}


def _rows(con, table: str, wanted: tuple[str, ...]) -> list[dict]:
    """Nur die gewuenschten (vorhandenen) Spalten lesen; fehlende Tabelle = leer."""
    cols = _columns(con, table)
    use = [c for c in wanted if c in cols]
    if not use:
        return []
    sql = f"select {', '.join(chr(34) + c + chr(34) for c in use)} from {table}"
    return [dict(zip(use, r)) for r in con.execute(sql).fetchall()]


def _tag_names(con) -> dict[str, str]:
    rows = _rows(con, "settings", ("tags",))  # NUR tags, nie apis o. ae.
    names: dict[str, str] = {}
    for r in rows[:1]:
        for group in _json(r.get("tags"), []) or []:
            if not isinstance(group, dict):
                continue
            for tag in group.get("tags") or []:
                if isinstance(tag, dict) and tag.get("id") is not None and isinstance(tag.get("name"), str):
                    names[str(tag["id"])] = tag["name"].strip()
    return names


def _resolve_tags(raw, names: dict[str, str]) -> list[str]:
    out = []
    for x in _json(raw, []) if isinstance(raw, str) else (raw or []):
        tid = x.get("id") if isinstance(x, dict) else x
        if tid is None:
            continue
        name = names.get(str(tid)) or (x.get("name") if isinstance(x, dict) else None) or str(tid)
        if isinstance(name, str) and name.strip() and name.strip() not in out:
            out.append(name.strip()[:80])
    return out[:40]


def _followed(v):
    n = _num(v)
    return None if n is None or n < 0 else n >= 1


def _by_trade(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        tid = r.get("tradeId")
        if isinstance(tid, str) and tid:
            prev = out.get(tid)
            if prev is None or (_ts(r.get("updatedAt")) or 0) >= (_ts(prev.get("updatedAt")) or 0):
                out[tid] = r
    return out


def _tpsl(raw) -> list:
    h = _json(raw, []) if isinstance(raw, str) else raw
    if not isinstance(h, list):
        return []
    keep = ("time", "type", "action", "oldVal", "newVal", "qty", "posQty", "rrr")
    return [{k: e[k] for k in keep if k in e} for e in h[-50:] if isinstance(e, dict)]


def _journal(fields: dict) -> dict:
    return {k: v for k, v in fields.items() if v is not None and v != [] and v != ""}


def read_trades(db_path: str, now: float | None = None, full: bool = False) -> tuple[list[dict], list[str] | None]:
    """Journal-Trades (ohne Bots). full=False: nur letzte 7 Tage geaendert/geschlossen plus offene.

    Rueckgabe: (Trades, alle IDs oder None). Die ID-Liste nur bei full=True.
    """
    now = time.time() if now is None else now
    since = now - RECENT_DAYS * 86400
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        names = _tag_names(con)
        notes = _by_trade(_rows(con, "notes", (
            "tradeId", "note", "entryNote", "closingNote", "playbook", "closingPlaybook", "timeframe",
            "closingTimeframe", "tradeType", "closingTradeType", "feelings", "closingFeelings",
            "entryStressLevel", "exitStressLevel", "closingStressLevel", "emotionLevel", "closingEmotionLevel",
            "strategyFollowed", "tradingMetadata", "updatedAt")))
        tags = _by_trade(_rows(con, "tags", ("tradeId", "tags", "closingTags", "updatedAt")))
        sats = _by_trade(_rows(con, "satisfactions", ("tradeId", "satisfaction", "updatedAt")))
        excs = _by_trade(_rows(con, "excursions", ("tradeId", "stopLoss", "maePrice", "mfePrice", "updatedAt")))
        days = _rows(con, "trades", ("trades", "broker", "updatedAt"))
        opens = _rows(con, "incoming_positions", (
            "positionId", "symbol", "side", "entryPrice", "leverage", "quantity", "status", "tags", "entryNote",
            "playbook", "entryTimeframe", "tradeType", "feelings", "stressLevel", "emotionLevel", "tpslHistory",
            "strategyFollowed", "broker", "createdAt", "updatedAt"))
    finally:
        con.close()

    trades: list[dict] = []
    all_ids: list[str] = []
    for day in days:
        day_updated = _ts(day.get("updatedAt"))
        for t in _json(day.get("trades"), []) or []:
            if not isinstance(t, dict) or t.get("category") == "bot" or not isinstance(t.get("id"), str):
                continue
            tid = t["id"]
            all_ids.append(tid)
            n, tg, sa, ex = notes.get(tid, {}), tags.get(tid, {}), sats.get(tid, {}), excs.get(tid, {})
            meta = _json(n.get("tradingMetadata"), {}) or {}
            meta = meta if isinstance(meta, dict) else {}
            exit_t = _ts(t.get("exitTime"))
            updated = max(
                [x for x in (day_updated, *(_ts(r.get("updatedAt")) for r in (n, tg, sa, ex))) if x] or [0]
            )
            if not full and updated < since and (exit_t or 0) < since:
                continue
            side = t.get("strategy") if t.get("strategy") in ("long", "short") else (
                "long" if t.get("side") == "B" else "short" if t.get("side") == "SS" else None)
            stop = _num(meta.get("sl")) or (_num(ex.get("stopLoss")) or None)
            trades.append({
                "trade_id": tid,
                "position_id": tid.split("_0_", 1)[1] if "_0_" in tid else None,
                "status": "closed",
                "broker": t.get("broker") or t.get("account") or day.get("broker"),
                "symbol": t.get("symbol"),
                "side": side,
                "entry_price": _num(t.get("entryPrice")),
                "exit_price": _num(t.get("exitPrice")),
                "entry_time": _ts(t.get("entryTime")),
                "exit_time": exit_t,
                "quantity": _num(t.get("buyQuantity") or t.get("sellQuantity")),
                "leverage": _num(meta.get("leverage")),
                "gross_pnl": _num(t.get("grossProceeds")),
                "net_pnl": _num(t.get("netProceeds")),
                "trading_fee": _num(t.get("tradingFee") if t.get("tradingFee") is not None else t.get("commission")),
                "funding_fee": _num(t.get("fundingFee")),
                "stop_loss": stop,
                "mae_price": _num(ex.get("maePrice")) or None,
                "mfe_price": _num(ex.get("mfePrice")) or None,
                "strategy_followed": _followed(n.get("strategyFollowed")),
                "satisfaction": None if _num(sa.get("satisfaction")) is None else _num(sa.get("satisfaction")) >= 1,
                "tags": _resolve_tags(tg.get("tags"), names),
                "closing_tags": _resolve_tags(tg.get("closingTags"), names),
                "autark_updated_at": updated or None,
                "journal": _journal({
                    "note": _text(n.get("note")),
                    "entry_note": _text(n.get("entryNote")),
                    "closing_note": _text(n.get("closingNote")),
                    "playbook": _text(n.get("playbook")),
                    "closing_playbook": _text(n.get("closingPlaybook")),
                    "timeframe": _text(n.get("timeframe"), 200),
                    "closing_timeframe": _text(n.get("closingTimeframe"), 200),
                    "trade_type": _text(n.get("tradeType"), 200),
                    "closing_trade_type": _text(n.get("closingTradeType"), 200),
                    "feelings": _text(n.get("feelings"), 200),
                    "closing_feelings": _text(n.get("closingFeelings"), 200),
                    "entry_stress": _level(n.get("entryStressLevel")),
                    "closing_stress": _level(n.get("closingStressLevel") if n.get("closingStressLevel") is not None else n.get("exitStressLevel")),
                    "emotion": _level(n.get("emotionLevel")),
                    "closing_emotion": _level(n.get("closingEmotionLevel")),
                    "take_profit": _num(meta.get("tp")) or None,
                    "planned_rrr": _num(meta.get("rrr")),
                    "margin": _num(meta.get("margin")),
                    "position_size": _num(meta.get("positionSize")),
                    "tpsl_history": _tpsl(meta.get("tpslHistory")),
                }),
            })

    for o in opens:
        if o.get("status") != "open" or o.get("positionId") in (None, ""):
            continue
        tid = f"open:{o['positionId']}"
        all_ids.append(tid)
        trades.append({
            "trade_id": tid,
            "position_id": str(o["positionId"]),
            "status": "open",
            "broker": o.get("broker"),
            "symbol": o.get("symbol"),
            "side": "long" if str(o.get("side", "")).lower() in ("long", "buy", "b") else
                    "short" if str(o.get("side", "")).lower() in ("short", "sell", "ss") else None,
            "entry_price": _num(o.get("entryPrice")),
            "entry_time": _ts(o.get("createdAt")),
            "quantity": _num(o.get("quantity")),
            "leverage": _num(o.get("leverage")),
            "strategy_followed": _followed(o.get("strategyFollowed")),
            "tags": _resolve_tags(o.get("tags"), names),
            "autark_updated_at": _ts(o.get("updatedAt")),
            "journal": _journal({
                "entry_note": _text(o.get("entryNote")),
                "playbook": _text(o.get("playbook")),
                "timeframe": _text(o.get("entryTimeframe"), 200),
                "trade_type": _text(o.get("tradeType"), 200),
                "feelings": _text(o.get("feelings"), 200),
                "entry_stress": _level(o.get("stressLevel")),
                "emotion": _level(o.get("emotionLevel")),
                "tpsl_history": _tpsl(o.get("tpslHistory")),
            }),
        })
    trades.sort(key=lambda x: x.get("exit_time") or x.get("entry_time") or 0, reverse=True)
    return trades[:MAX_TRADES], (all_ids if full else None)


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
    url: str,
    secret: str,
    symbol: str,
    zones: list[dict],
    allow_empty: bool = False,
    drawings: list[dict] | None = None,
    trades: list[dict] | None = None,
    all_trade_ids: list[str] | None = None,
) -> dict:
    payload = {"symbol": symbol, "zones": zones, "allow_empty": allow_empty}
    if trades is not None:
        payload["trades"] = trades
    # Eine leere ID-Liste nie senden (Nexus wuerde sie ohnehin ignorieren).
    if all_trade_ids:
        payload["all_trade_ids"] = all_trade_ids
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


def _full_due(state_path: str | None, now: float) -> bool:
    if not state_path:
        return False
    try:
        last = float(json.loads(Path(state_path).read_text()).get("last_full", 0))
    except (OSError, ValueError, json.JSONDecodeError, AttributeError):
        return True
    return now - last >= FULL_EVERY_SECONDS


def _mark_full(state_path: str | None, now: float) -> None:
    if not state_path:
        return
    try:
        Path(state_path).parent.mkdir(parents=True, exist_ok=True)
        Path(state_path).write_text(json.dumps({"last_full": now}))
    except OSError:
        pass


def run_once(cfg: dict) -> str:
    zones = read_zones(cfg["db"], cfg["symbol"])
    if not zones and not cfg.get("allow_empty"):
        # Lieber alte Zonen in Nexus behalten als sie wegen eines Lesefehlers
        # oder einer leeren Datenbank still zu loeschen.
        return "keine Zonen gefunden, nichts gesendet (AUTARK_ALLOW_EMPTY=1 zum Leeren)"
    drawings = read_drawings(cfg["db"], cfg["symbol"])
    trades = all_ids = None
    journal_note = ""
    now = time.time()
    full = False
    if cfg.get("journal", True):
        full = bool(cfg.get("full")) or _full_due(cfg.get("state"), now)
        try:
            trades, all_ids = read_trades(cfg["db"], now=now, full=full)
        except sqlite3.Error as e:
            # Journal-Fehler darf Zonen und Zeichnungen nicht blockieren.
            trades = all_ids = None
            journal_note = f" (Journal nicht lesbar: {e})"
    result = send(
        cfg["url"], cfg["secret"], cfg["symbol"], zones, bool(cfg.get("allow_empty")), drawings, trades, all_ids
    )
    if not result.get("success"):
        raise RuntimeError(f"Nexus meldet Fehler: {result}")
    if full and trades is not None:
        _mark_full(cfg.get("state"), now)
    msg = f"{result.get('zones', len(zones))} Zonen"
    if result.get("drawings") is not None:
        msg += f", {result['drawings']} Zeichnungen"
    tr = result.get("trades")
    if isinstance(tr, dict):
        msg += f", Journal {tr.get('total')} Trades ({tr.get('changed', 0)} neu/geändert"
        if tr.get("marked_deleted"):
            msg += f", {tr['marked_deleted']} als gelöscht markiert"
        msg += ", voll" if full else ""
        msg += ")"
    msg += journal_note
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
        "journal": os.environ.get("AUTARK_JOURNAL", "1") != "0",
        "state": os.environ.get("AUTARK_STATE") or str(Path(__file__).resolve().parent / "journal_state.json"),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Zonen aus AutarkTrade nach Nexus übertragen")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Zonen anzeigen, nichts senden")
    mode.add_argument("--once", action="store_true", help="einmal senden (bei Änderung oder stündlich)")
    mode.add_argument("--loop", type=int, metavar="SEKUNDEN", help="dauerhaft im Abstand senden")
    ap.add_argument("--full", action="store_true", help="Journal vollständig senden (sonst täglich automatisch)")
    args = ap.parse_args(argv)

    cfg = config_from_env()
    cfg["full"] = args.full
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
        if cfg["journal"]:
            try:
                trades, ids = read_trades(cfg["db"], full=True)
            except sqlite3.Error as e:
                print(f"Journal nicht lesbar: {e}")
                return 0
            closed = [t for t in trades if t["status"] == "closed"]
            print(f"Journal: {len(closed)} geschlossene, {len(trades) - len(closed)} offene Trades (ohne Bots). Neueste:")
            for t in trades[:5]:
                when = time.strftime("%d.%m. %H:%M", time.gmtime(t.get("exit_time") or t.get("entry_time") or 0))
                pnl = t.get("net_pnl")
                print(f"  {when} UTC  {t.get('side') or '?':>5}  {t.get('symbol') or ''}  "
                      f"{'' if pnl is None else f'{pnl:+.2f} USDT'}  Tags: {', '.join(t.get('tags') or []) or '-'}")
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
