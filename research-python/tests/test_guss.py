from __future__ import annotations

import numpy as np
import pandas as pd

from src.signals.guss import compute_guss_signal
from tests.lookahead_utils import assert_no_lookahead_on_truncation, make_datetime_index


def _ohlc(closes, highs, lows):
    idx = make_datetime_index(len(closes), freq="h")
    return pd.DataFrame({"open": closes, "high": highs, "low": lows, "close": closes}, index=idx)


class TestComputeGussSignalUptrend:
    def test_fires_once_at_first_coherent_touch(self):
        # Flat-Anlauf, dann klarer Aufwaertstrend zu einem Hoch bei 120
        # (Index 21), danach eine zusammenhaengende Gegenbewegung (keine
        # Kerze macht ein neues Hoch ueber 120 zurueck), deren Docht bei
        # Index 23 erstmals die EMA beruehrt -- verifiziert per Debug-Skript.
        flat = [100.0] * 12
        up = [102, 104, 106, 108, 110, 112, 114, 116, 118, 120]
        pull_close = [119, 117, 115, 113, 111.5, 110.5, 109.8]
        pull_low = [c - 3 for c in pull_close]
        closes = flat + up + pull_close
        highs = [c + 0.5 for c in closes[: len(flat) + len(up)]] + [c + 0.3 for c in pull_close]
        lows = [c - 0.5 for c in closes[: len(flat) + len(up)]] + pull_low
        sig = compute_guss_signal(_ohlc(closes, highs, lows), ema_period=10, swing_lookback=2)
        assert sig.sum() == 1
        assert bool(sig.iloc[23]) is True
        # Nach dem Feuern kein erneutes Signal fuer denselben Ursprung, obwohl
        # die EMA in den Folgebars weiterhin beruehrt wird.
        assert not sig.iloc[24:].any()

    def test_new_high_before_touch_breaks_coherence_no_fire(self):
        # Ursprungs-Hoch bei Index 8 (106, laengst bestaetigt), dann ein
        # Ausreisser bei Index 13 (110, > 106.3 Ursprungs-High) -- bricht die
        # "zusammenhaengende Gegenbewegung". Bei Index 14 waere die EMA
        # sonst beruehrt worden (per Debug-Skript verifiziert: close>ema
        # UND low<=ema), das Signal darf trotzdem nicht feuern.
        closes = [100.0] * 6 + [101, 103, 106] + [104.0, 103.5, 103.2, 103.0] + [110.0, 108.0]
        highs = [c + 0.3 for c in closes[:-1]] + [108.0 + 0.3]
        lows = [c - 0.3 for c in closes[:-2]] + [109.7, 107.0]
        sig = compute_guss_signal(_ohlc(closes, highs, lows), ema_period=3, swing_lookback=2)
        assert sig.sum() == 0


class TestComputeGussSignalDowntrend:
    def test_fires_once_at_first_coherent_touch(self):
        # Spiegelbild des Aufwaertstrend-Falls: Tief bei 80 (Index 21), dann
        # zusammenhaengende Gegenbewegung nach oben, Docht beruehrt die EMA
        # erstmals bei Index 23.
        flat = [100.0] * 12
        down = [98, 96, 94, 92, 90, 88, 86, 84, 82, 80]
        pull_close = [81, 83, 85, 87, 88.5, 89.5, 90.2]
        pull_high = [c + 3 for c in pull_close]
        closes = flat + down + pull_close
        lows = [c - 0.5 for c in closes[: len(flat) + len(down)]] + [c - 0.3 for c in pull_close]
        highs = [c + 0.5 for c in closes[: len(flat) + len(down)]] + pull_high
        sig = compute_guss_signal(_ohlc(closes, highs, lows), ema_period=10, swing_lookback=2)
        assert sig.sum() == 1
        assert bool(sig.iloc[23]) is True


class TestComputeGussSignalProperties:
    def test_output_is_boolean_and_never_nan(self):
        rng = np.random.default_rng(7)
        n = 200
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = _ohlc(walk, walk + 0.5, walk - 0.5)
        result = compute_guss_signal(ohlc, ema_period=5, swing_lookback=3)
        assert result.dtype == bool
        assert result.notna().all()

    def test_too_short_series_never_fires(self):
        n = 10
        ohlc = _ohlc([100.0] * n, [100.5] * n, [99.5] * n)
        result = compute_guss_signal(ohlc, ema_period=21, swing_lookback=20)
        assert not result.any()


class TestGussNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(13)
        n = 150
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = _ohlc(walk, walk + 0.5, walk - 0.5)

        def compute_fn(o):
            return compute_guss_signal(o, ema_period=5, swing_lookback=3)

        assert_no_lookahead_on_truncation(compute_fn, ohlc, cutoff_pos=100)
