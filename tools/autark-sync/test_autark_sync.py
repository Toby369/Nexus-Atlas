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


if __name__ == "__main__":
    unittest.main()
