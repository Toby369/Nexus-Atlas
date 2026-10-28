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


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.db = make_db([("BTCUSDT", "horizontale", [{"t": 1, "p": 80000}], {}, 0)])
        fd, self.state = tempfile.mkstemp()
        os.close(fd)
        os.unlink(self.state)
        self.cfg = {"db": self.db, "url": "https://example/autark-sync", "secret": "s", "symbol": "BTCUSDT"}

    def tearDown(self):
        os.unlink(self.db)
        if os.path.exists(self.state):
            os.unlink(self.state)

    def test_sendet_beim_ersten_mal_und_dann_erst_bei_aenderung(self):
        with mock.patch.object(autark_sync, "send", return_value={"success": True, "zones": 1}) as send:
            self.assertIn("1 Zonen", autark_sync.run_once(self.cfg, Path(self.state)))
            self.assertIn("unverändert", autark_sync.run_once(self.cfg, Path(self.state)))
            self.assertEqual(send.call_count, 1)
            con = sqlite3.connect(self.db)
            con.execute("insert into chart_zeichnungen (symbol, typ, punkte) values ('BTCUSDT', 'horizontale', '[{\"t\":1,\"p\":82000}]')")
            con.commit()
            con.close()
            autark_sync.run_once(self.cfg, Path(self.state))
            self.assertEqual(send.call_count, 2)
            self.assertEqual(len(send.call_args.args[3]), 2)

    def test_fehler_von_nexus_wird_gemeldet_und_stand_nicht_gespeichert(self):
        with mock.patch.object(autark_sync, "send", return_value={"success": False, "error": "x"}):
            with self.assertRaises(RuntimeError):
                autark_sync.run_once(self.cfg, Path(self.state))
        self.assertFalse(os.path.exists(self.state))


if __name__ == "__main__":
    unittest.main()
