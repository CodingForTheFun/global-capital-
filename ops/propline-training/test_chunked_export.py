"""Offline regression fixtures, never training/production observations."""
import csv
import datetime as dt
import gzip
import io
import json
import unittest
from collections import Counter

from chunked_export import (ChunkTooLarge, LimitedStream, bisect_window, encode,
                            initial_windows, instant, make_exporter, sha)


class Stop(Exception): pass
class StoreError(Exception): pass


class Store:
    def __init__(self): self.data = {}
    def get(self, path): return self.data.get(path)
    def put(self, path, data): self.data[path] = bytes(data)


class Provider:
    def __init__(self): self.calls = []; self.allow = 100; self.fail = None


FIELDS = ['event_id', 'sport_key', 'commence_time', 'market', 'player_id',
          'player_name', 'opening_at', 'opening_price', 'opening_point', 'actual_value']


def csv_blob(rows):
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=FIELDS)
    writer.writeheader(); writer.writerows(rows)
    return gzip.compress(buffer.getvalue().encode(), mtime=0)


def legacy(provider, store, sport, since, until):
    # Emulates the existing exporter's validated private cache interface.
    p = provider.provider
    book = 'draftkings' if sport == 'baseball_mlb' else None
    scope = [sport, since, until] + ([book] if book else [])
    path = f'exports/{sport}/{sha(encode(scope))[:24]}.csv.gz'
    meta = path.replace('.csv.gz', '.json')
    if store.get(meta):
        return store.get(path), {**json.loads(store.get(meta)), 'cacheHit': True}
    if len(p.calls) >= p.allow: raise Stop('request_budget')
    p.calls.append((sport, since, until))
    if p.fail: raise p.fail
    row = dict.fromkeys(FIELDS, '')
    row.update(event_id='same-event', sport_key=sport, commence_time=since,
               market='test_only_market', player_id='verified-fixture-id',
               player_name='Fixture Player', opening_price='-110',
               opening_point='2.5', actual_value='3.0')
    data = csv_blob([row])
    info = {'rows': 1, 'events': 1, 'players': 1, 'dataSha256': sha(data),
            'cacheHit': False, 'excludedCanaries': 0, 'archiveHeaders': {}}
    store.put(path, data); store.put(meta, encode(info))
    return data, info


class Exports(unittest.TestCase):
    def setUp(self):
        self.store, self.provider = Store(), Provider()
        self.export = make_exporter(legacy, {'baseball_mlb':'draftkings'}, Stop, StoreError)
        self.args = ('baseball_mlb', '2026-04-01T00:00:00Z', '2026-06-30T23:59:59Z')

    def test_monthly_boundaries_are_complete_and_nonoverlapping(self):
        windows = initial_windows(*self.args)
        self.assertEqual(len(windows), 3)
        self.assertEqual(instant(windows[0][0]), instant(self.args[1]))
        self.assertEqual(instant(windows[-1][1]), instant(self.args[2]))
        for a, b in zip(windows, windows[1:]):
            self.assertEqual(instant(a[1]) + dt.timedelta(microseconds=1), instant(b[0]))

    def test_other_sports_preserve_wide_single_request(self):
        self.assertEqual(initial_windows('soccer_epl', *self.args[1:]), [list(self.args[1:])])

    def test_resume_does_not_redownload_completed_chunks(self):
        self.provider.allow = 2
        with self.assertRaisesRegex(Stop, 'request_budget'):
            self.export(self.provider, self.store, *self.args)
        self.assertEqual(len(self.provider.calls), 2)
        self.provider.allow = 100
        blob, info = self.export(self.provider, self.store, *self.args)
        self.assertEqual(len(self.provider.calls), 3)
        self.assertEqual(info['chunks'], 3)
        self.assertEqual(info['rows'], 3)
        self.assertEqual(info['events'], 1)  # true union, not sum of chunk counts
        self.assertEqual(info['players'], 1)
        self.assertEqual(info['bookScope'], 'single-reference-book')
        self.assertEqual(info['referenceBook'], 'draftkings')
        self.assertEqual(info['dataSha256'], sha(blob))
        self.assertEqual(len(list(csv.DictReader(io.StringIO(gzip.decompress(blob).decode())))), 3)
        second_blob, second = self.export(self.provider, self.store, *self.args)
        self.assertEqual(len(self.provider.calls), 3)
        self.assertTrue(second['cacheHit'])
        self.assertEqual(second_blob, blob)

    def test_quota_failures_do_not_trigger_paid_subdivision(self):
        self.provider.fail = Stop('website_quota_reserve')
        with self.assertRaisesRegex(Stop, 'website_quota_reserve'):
            self.export(self.provider, self.store, *self.args)
        manifest = next(json.loads(v) for k,v in self.store.data.items() if k.endswith('.chunks.json'))
        self.assertEqual(len(manifest['pending']), 3)
        self.assertEqual(len(self.provider.calls), 1)

    def test_only_oversized_windows_are_subdivided(self):
        seen = []
        def capped(provider, store, sport, since, until):
            seen.append((since, until))
            if instant(until) - instant(since) > dt.timedelta(days=16):
                raise ChunkTooLarge()
            return legacy(provider, store, sport, since, until)
        export = make_exporter(capped, {}, Stop, StoreError)
        blob, info = export(self.provider, self.store, 'tennis_atp', *self.args[1:])
        self.assertGreater(info['chunks'], 1)
        self.assertEqual(info['rows'], len(self.provider.calls))
        previous = len(seen)
        export(self.provider, self.store, 'tennis_atp', *self.args[1:])
        self.assertEqual(len(seen), previous)

    def test_corrupt_cached_chunk_fails_closed(self):
        self.export(self.provider, self.store, *self.args)
        path = next(k for k in self.store.data if k.endswith('.csv.gz'))
        self.store.data[path] = b'corrupt'
        with self.assertRaisesRegex(StoreError, 'chunk_checkpoint_checksum'):
            self.export(self.provider, self.store, *self.args)
        self.assertEqual(len(self.provider.calls), 3)

    def test_changed_manifest_scope_fails_closed(self):
        self.export(self.provider, self.store, *self.args)
        key = next(k for k in self.store.data if k.endswith('.chunks.json'))
        manifest = json.loads(self.store.data[key]); manifest['scope'][1] = 'other_sport'
        self.store.data[key] = encode(manifest)
        with self.assertRaisesRegex(StoreError, 'chunk_manifest_scope_mismatch'):
            self.export(self.provider, self.store, *self.args)

    def test_no_subdivision_below_one_day(self):
        self.assertIsNone(bisect_window(['2026-04-01T00:00:00Z', '2026-04-01T23:59:59Z']))

    def test_timezone_is_required(self):
        with self.assertRaises(ValueError): instant('2026-04-01T00:00:00')

    def test_stream_closes_when_shard_limit_reached(self):
        class Response:
            closed = False
            def close(self): self.closed = True
        class Stream:
            closed = False
            def lines(self, response):
                try: yield 'A'*16; yield 'B'*16
                finally: self.closed = True
        response, source = Response(), Stream()
        with self.assertRaises(ChunkTooLarge): list(LimitedStream(source, 20).lines(response))
        self.assertTrue(response.closed)
        self.assertTrue(source.closed)

    def test_stream_does_not_swallow_global_budget(self):
        class Response:
            def close(self): pass
        class Stream:
            def lines(self, response):
                yield 'ok'
                raise Stop('export_byte_budget')
        with self.assertRaisesRegex(Stop, 'export_byte_budget'):
            list(LimitedStream(Stream()).lines(Response()))


if __name__ == '__main__': unittest.main()
