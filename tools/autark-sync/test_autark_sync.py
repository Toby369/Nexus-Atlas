"""Tests fuer autark_sync.py gegen eine nachgebaute AutarkTrade-Datenbank.

Schema wie in AutarkTrade server/database.js (chart_zeichnungen).
Aufruf: python3 -m unittest tools/autark-sync/test_autark_sync.py
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import autark_sync  # noqa: E402

SCHEMA = """
create table chart_zeichnungen (
  id integer primary key autoincrement,
  symbol varchar(255) not null,
  typ varchar(255) not null,
  punkte text default '[]',
  stil text default '{}',
  sichtbarAuf text,
  gesperrt integer default 0,
  versteckt integer default 0,
  erstelltAm bigint default 0,
  geaendertAm bigint default 0
)
"""


def make_db(rows):
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    con = sqlite3.connect(path)
    con.execute(SCHEMA)
    for symbol, typ, punkte, stil, versteckt in rows:
        con.execute(
            "insert into chart_zeichnungen (symbol, typ, punkte, stil, versteckt) values (?, ?, ?, ?, ?)",
            (symbol, typ, json.dumps(punkte), json.dumps(stil), versteckt),
        )
    con.commit()
    con.close()
    return path


class ReadZonesTest(unittest.TestCase):
    def setUp(self):
        self.db = make_db(
            [
                ("BTCUSDT", "rechteck", [{"t": 1, "p": 81300}, {"t": 2, "p": 81000}], {"text": "Range-Oberkante"}, 0),
                ("BTCUSDT", "horizontale", [{"t": 1, "p": 80000}], {}, 0),
                ("BTCUSDT", "strahlH", [{"t": 1, "p": 79400.5}], {"text": " Daily Käufer "}, 0),
                ("BTCUSDT", "trendlinie", [{"t": 1, "p": 70000}, {"t": 2, "p": 90000}], {}, 0),
                ("BTCUSDT", "rechteck", [{"t": 1, "p": 85000}, {"t": 2, "p": 86000}], {"text": "versteckt"}, 1),
                ("ETHUSDT", "horizontale", [{"t": 1, "p": 3000}], {}, 0),
                ("BTCUSDT", "horizontale", "kaputt", {}, 0),
            ]
        )

    def tearDown(self):
        os.unlink(self.db)

    def test_nur_zonen_des_symbols_ohne_versteckte_und_trendlinien(self):
        zones = autark_sync.read_zones(self.db, "BTCUSDT")
        self.assertEqual(
            zones,
            [
                {"id": 1, "lo": 81000.0, "hi": 81300.0, "label": "Range-Oberkante"},
                {"id": 2, "lo": 80000.0, "hi": 80000.0, "label": ""},
                {"id": 3, "lo": 79400.5, "hi": 79400.5, "label": "Daily Käufer"},
            ],
        )

    def test_datenbank_bleibt_unveraendert_lesend_geoeffnet(self):
        before = Path(self.db).read_bytes()
        autark_sync.read_zones(self.db, "BTCUSDT")
        self.assertEqual(before, Path(self.db).read_bytes())


class ReadDrawingsTest(unittest.TestCase):
    def setUp(self):
        self.db = make_db(
            [
                ("BTCUSDT", "avwap", [{"t": 1795219200000, "p": 0}], {"text": " AVWAP 59273.4 ", "baender": 1, "farbe": "#f80"}, 0),
                ("BTCUSDT", "rechteck", [{"t": 1, "p": 59050}, {"t": 2, "p": 59372.8}], {"text": "1h, retestzone"}, 0),
                ("BTCUSDT", "pinsel", [{"t": i, "p": 1} for i in range(200)], {}, 0),
                ("BTCUSDT", "emoji", [{"t": 1, "p": 60000}], {}, 0),
                ("BTCUSDT", "trendlinie", [{"t": 1, "p": 58000}, {"t": 2, "p": 61000}], {}, 1),
                ("BTCUSDT", "position", [{"t": 1, "p": 59100}, {"t": 1, "p": 61000}, {"t": 1, "p": 58600}], {}, 0),
                ("BTCUSDT", "fib", "kaputt", {}, 0),
                ("ETHUSDT", "avwap", [{"t": 1, "p": 0}], {}, 0),
            ]
        )
        con = sqlite3.connect(self.db)
        con.execute("update chart_zeichnungen set sichtbarAuf = ?, geaendertAm = 1795250000000 where id = 1", (json.dumps(["15m", "1h"]),))
        con.commit()
        con.close()

    def tearDown(self):
        os.unlink(self.db)

    def test_alle_sichtbaren_ohne_pinsel_emoji(self):
        drawings = autark_sync.read_drawings(self.db, "BTCUSDT")
        self.assertEqual([d["kind"] for d in drawings], ["avwap", "rechteck", "position"])
        avwap = drawings[0]
        self.assertEqual(avwap["label"], "AVWAP 59273.4")
        self.assertEqual(avwap["style"], {"text": " AVWAP 59273.4 ", "baender": 1})
        self.assertEqual(avwap["visible_on"], ["15m", "1h"])
        self.assertEqual(avwap["updated_at"], 1795250000000)
        self.assertEqual(avwap["points"], [{"t": 1795219200000, "p": 0}])
        self.assertIsNone(drawings[1]["visible_on"])
        self.assertIsNone(drawings[1]["updated_at"])
        self.assertEqual(len(drawings[2]["points"]), 3)

    def test_leere_zeichnungsliste_nur_mit_flag_im_body(self):
        captured = {}

        class FakeRes:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"success": true}'

        def fake_urlopen(req, timeout):
            captured["body"] = json.loads(req.data)
            return FakeRes()

        with mock.patch.object(autark_sync.urllib.request, "urlopen", fake_urlopen):
            autark_sync.send("https://example/autark-sync", "s", "BTCUSDT", [], False, [])
            self.assertNotIn("drawings", captured["body"])
            autark_sync.send("https://example/autark-sync", "s", "BTCUSDT", [], True, [])
            self.assertEqual(captured["body"]["drawings"], [])
            autark_sync.send("https://example/autark-sync", "s", "BTCUSDT", [], False, [{"id": 1}])
            self.assertEqual(captured["body"]["drawings"], [{"id": 1}])


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.db = make_db([("BTCUSDT", "horizontale", [{"t": 1, "p": 80000}], {}, 0)])
        self.cfg = {"db": self.db, "url": "https://example/autark-sync", "secret": "s", "symbol": "BTCUSDT"}

    def tearDown(self):
        os.unlink(self.db)

    def test_sendet_bei_jedem_lauf(self):
        with mock.patch.object(autark_sync, "send", return_value={"success": True, "zones": 1, "drawings": 1}) as send:
            self.assertIn("1 Zonen, 1 Zeichnungen", autark_sync.run_once(self.cfg))
            self.assertEqual(send.call_args.args[5][0]["kind"], "horizontale")
            autark_sync.run_once(self.cfg)
            self.assertEqual(send.call_count, 2)
            self.assertFalse(send.call_args.args[4])

    def test_leere_liste_wird_ohne_flag_nicht_gesendet(self):
        empty = make_db([])
        try:
            cfg = {**self.cfg, "db": empty}
            with mock.patch.object(autark_sync, "send") as send:
                self.assertIn("nichts gesendet", autark_sync.run_once(cfg))
                send.assert_not_called()
            with mock.patch.object(autark_sync, "send", return_value={"success": True, "zones": 0}) as send:
                autark_sync.run_once({**cfg, "allow_empty": True})
                self.assertTrue(send.call_args.args[4])
        finally:
            os.unlink(empty)

    def test_fehler_von_nexus_wird_gemeldet(self):
        with mock.patch.object(autark_sync, "send", return_value={"success": False, "error": "x"}):
            with self.assertRaises(RuntimeError):
                autark_sync.run_once(self.cfg)


JOURNAL_SCHEMA = """
create table trades (id integer primary key, dateUnix bigint not null, date text, executions text default '[]',
  trades text default '[]', blotter text, pAndL text, createdAt timestamp, updatedAt timestamp, broker text default 'bitunix');
create table notes (id integer primary key, dateUnix bigint, tradeId text, note text, entryNote text, feelings text,
  playbook text, timeframe text, entryStressLevel integer, emotionLevel integer, closingNote text, closingStressLevel integer,
  strategyFollowed integer default -1, tradingMetadata text, screenshotId text, aiReview text, updatedAt timestamp);
create table tags (id integer primary key, tradeId text, tags text default '[]', closingTags text default '[]', updatedAt timestamp);
create table satisfactions (id integer primary key, dateUnix bigint, tradeId text, satisfaction integer, updatedAt timestamp);
create table excursions (id integer primary key, tradeId text, stopLoss real default 0, maePrice real default 0,
  mfePrice real default 0, updatedAt timestamp);
create table incoming_positions (id integer primary key, positionId text unique, symbol text, side text, entryPrice real,
  leverage real, quantity real, status text default 'open', tags text default '[]', entryNote text, stressLevel integer,
  tpslHistory text default '[]', bitunixData text, createdAt timestamp, updatedAt timestamp);
create table settings (id integer primary key, tags text default '[]', apis text default '[]');
"""

NOW = 1795132800  # 2026-11-20 00:00 UTC


def make_journal_db():
    path = make_db([])
    con = sqlite3.connect(path)
    con.executescript(JOURNAL_SCHEMA)
    day = [
        {"id": "t1795046400_0_P1", "broker": "bitunix", "category": "futures", "symbol": "BTCUSDT", "side": "B",
         "strategy": "long", "entryPrice": 59150, "exitPrice": 58000, "entryTime": NOW - 30000, "exitTime": NOW - 26000,
         "buyQuantity": 0.002, "sellQuantity": 0.002, "grossProceeds": -2.3, "netProceeds": -2.5, "tradingFee": 0.2,
         "fundingFee": 0},
        {"id": "t1795046400_0_BOT", "category": "bot", "symbol": "BTCUSDT"},
    ]
    old = [{"id": "t1790000000_0_P0", "category": "futures", "symbol": "BTCUSDT", "side": "SS", "entryTime": 1789990000,
            "exitTime": 1790000000, "netProceeds": 1.0}]
    con.execute("insert into trades (dateUnix, trades, updatedAt) values (?, ?, ?)", (1795046400, json.dumps(day), "2026-11-19 09:00:00"))
    con.execute("insert into trades (dateUnix, trades, updatedAt) values (?, ?, ?)", (1790000000, json.dumps(old), "2026-09-22 10:00:00"))
    con.execute(
        "insert into notes (tradeId, entryNote, feelings, playbook, entryStressLevel, strategyFollowed, tradingMetadata, screenshotId, aiReview, updatedAt) "
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("t1795046400_0_P1", "<p>Plan A: Retest <b>AVWAP</b></p>", "ungeduldig", "<ul><li>EMA</li></ul>", 3, 0,
         json.dumps({"sl": 58800, "tp": 61000, "rrr": 2.6, "leverage": 15, "tpslHistory": [{"time": 1, "type": "sl", "newVal": 58800}]}),
         "BASE64...", "lange KI-Bewertung", "2026-11-19 09:05:00"),
    )
    con.execute("insert into tags (tradeId, tags, closingTags) values (?, ?, ?)", ("t1795046400_0_P1", '["tag_1", {"id": "tag_2"}]', '["tag_x"]'))
    con.execute("insert into satisfactions (tradeId, satisfaction) values (?, ?)", ("t1795046400_0_P1", 0))
    con.execute("insert into excursions (tradeId, stopLoss, maePrice) values (?, ?, ?)", ("t1795046400_0_P1", 0, 57900))
    con.execute(
        "insert into incoming_positions (positionId, symbol, side, entryPrice, leverage, quantity, status, tags, stressLevel, createdAt) "
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("P9", "BTCUSDT", "LONG", 60100, 12, 0.003, "open", '["tag_1"]', 2, "2026-11-19 22:00:00"),
    )
    con.execute(
        "insert into settings (id, tags, apis) values (1, ?, ?)",
        (json.dumps([{"id": "group_0", "name": "Strategie", "tags": [{"id": "tag_1", "name": "Retest"}, {"id": "tag_2", "name": "AVWAP"}]}]),
         json.dumps([{"key": "GEHEIM"}])),
    )
    con.commit()
    con.close()
    return path


class ReadTradesTest(unittest.TestCase):
    def setUp(self):
        self.db = make_journal_db()

    def tearDown(self):
        os.unlink(self.db)

    def test_letzte_7_tage_plus_offene_ohne_bots(self):
        trades, ids = autark_sync.read_trades(self.db, now=NOW)
        self.assertIsNone(ids)
        by = {t["trade_id"]: t for t in trades}
        self.assertEqual(sorted(by), ["open:P9", "t1795046400_0_P1"])
        t = by["t1795046400_0_P1"]
        self.assertEqual(t["side"], "long")
        self.assertEqual(t["position_id"], "P1")
        self.assertEqual(t["net_pnl"], -2.5)
        self.assertEqual(t["quantity"], 0.002)
        self.assertEqual(t["leverage"], 15)
        self.assertEqual(t["stop_loss"], 58800)
        self.assertEqual(t["mae_price"], 57900)
        self.assertIs(t["strategy_followed"], False)
        self.assertIs(t["satisfaction"], False)
        self.assertEqual(t["tags"], ["Retest", "AVWAP"])
        self.assertEqual(t["closing_tags"], ["tag_x"])
        j = t["journal"]
        self.assertEqual(j["entry_note"], "Plan A: Retest AVWAP")
        self.assertEqual(j["playbook"], "EMA")
        self.assertEqual(j["feelings"], "ungeduldig")
        self.assertEqual(j["entry_stress"], 3)
        self.assertEqual(j["take_profit"], 61000)
        self.assertEqual(j["tpsl_history"][0]["newVal"], 58800)
        self.assertEqual(t["autark_updated_at"], 1795078800 + 300)
        o = by["open:P9"]
        self.assertEqual((o["status"], o["side"], o["leverage"], o["tags"]), ("open", "long", 12, ["Retest"]))
        self.assertEqual(o["journal"]["entry_stress"], 2)

    def test_nie_screenshots_ki_oder_zugangsdaten(self):
        trades, _ = autark_sync.read_trades(self.db, now=NOW, full=True)
        dump = json.dumps(trades)
        for secret in ("BASE64", "KI-Bewertung", "GEHEIM"):
            self.assertNotIn(secret, dump)

    def test_voll_mit_id_liste(self):
        trades, ids = autark_sync.read_trades(self.db, now=NOW, full=True)
        self.assertEqual(len(trades), 3)
        self.assertEqual(sorted(ids), ["open:P9", "t1790000000_0_P0", "t1795046400_0_P1"])

    def test_zeitformate(self):
        self.assertEqual(autark_sync._ts("2026-11-19 09:00:00"), 1795078800)
        self.assertEqual(autark_sync._ts(1795078800000), 1795078800)
        self.assertEqual(autark_sync._ts("1795078800"), 1795078800)
        self.assertIsNone(autark_sync._ts(""))
        self.assertIsNone(autark_sync._ts(0))

    def test_run_once_voll_beim_ersten_lauf_dann_taeglich(self):
        fd, state = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(state)
        cfg = {"db": self.db, "url": "u", "secret": "s", "symbol": "BTCUSDT", "state": state, "allow_empty": True}
        ok = {"success": True, "zones": 0, "drawings": 0, "trades": {"total": 3, "changed": 3}}
        try:
            with mock.patch.object(autark_sync, "send", return_value=ok) as send:
                self.assertIn("Journal 3 Trades (3 neu/geändert, voll)", autark_sync.run_once(cfg))
                self.assertEqual(len(send.call_args.args[7]), 3)
                autark_sync.run_once(cfg)
                self.assertIsNone(send.call_args.args[7])
                autark_sync.run_once({**cfg, "full": True})
                self.assertEqual(len(send.call_args.args[7]), 3)
                autark_sync.run_once({**cfg, "journal": False})
                self.assertIsNone(send.call_args.args[6])
        finally:
            if os.path.exists(state):
                os.unlink(state)

    def test_send_ohne_leere_id_liste(self):
        captured = {}

        class FakeRes:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"success": true}'

        def fake_urlopen(req, timeout):
            captured["body"] = json.loads(req.data)
            return FakeRes()

        with mock.patch.object(autark_sync.urllib.request, "urlopen", fake_urlopen):
            autark_sync.send("https://example/autark-sync", "s", "BTCUSDT", [], False, None, [], [])
            self.assertEqual(captured["body"]["trades"], [])
            self.assertNotIn("all_trade_ids", captured["body"])


if __name__ == "__main__":
    unittest.main()
