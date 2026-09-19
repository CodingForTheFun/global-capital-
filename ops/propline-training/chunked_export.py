"""Resumable historical exports; does not alter provider quotas or model gates.

The existing exporter validates/sanitizes each CSV and privately persists it.
This adapter only divides oversized date windows and joins verified shards.
No successful shard is downloaded twice on a resumed pass.
"""
from __future__ import annotations

import collections
import datetime as dt
import gzip
import hashlib
import io
import json
import csv

MIB = 1024 * 1024
RAW_CHUNK_LIMIT = 32 * MIB
MERGED_COMPRESSED_LIMIT = 32 * MIB
FORMAT = 'oblige-export-chunks-v1'


class ChunkTooLarge(Exception):
    """Only the individual shard limit, never a quota/global budget failure."""


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def instant(value):
    result = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone_required')
    return result.astimezone(dt.timezone.utc)


def iso(value):
    return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def initial_windows(sport, since, until):
    start, end = instant(since), instant(until)
    if start >= end:
        raise ValueError('invalid_export_window')
    # MLB is the measured oversize case. Other sports keep the efficient
    # widest-range request and split only if their actual stream needs it.
    if sport != 'baseball_mlb':
        return [[since, until]]
    windows = []
    cursor = start
    while cursor <= end:
        following = (cursor.replace(day=28) + dt.timedelta(days=4)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0)
        last = min(end, following - dt.timedelta(microseconds=1))
        windows.append([iso(cursor), iso(last)])
        cursor = following
    return windows


def bisect_window(window):
    start, end = map(instant, window)
    # Do not spend repeated paid calls bisecting a malformed or huge day.
    if end - start < dt.timedelta(days=2):
        return None
    middle = start + (end - start) / 2
    return [[iso(start), iso(middle)],
            [iso(middle + dt.timedelta(microseconds=1)), iso(end)]]


class LimitedStream:
    def __init__(self, provider, limit=RAW_CHUNK_LIMIT):
        self.provider, self.limit = provider, limit

    def read(self, path, params=None):
        return self.provider.read(path, params)

    def lines(self, response):
        source = self.provider.lines(response)
        consumed = 0
        try:
            for line in source:
                consumed += len(line.encode('utf-8')) + 1
                if consumed > self.limit:
                    raise ChunkTooLarge('shard_byte_limit')
                yield line
        finally:
            close = getattr(source, 'close', None)
            if close:
                close()
            response.close()


def _verified(store, entry, store_error):
    payload = store.get(entry['path'])
    if payload is None or sha(payload) != entry['info']['dataSha256']:
        raise store_error('chunk_checkpoint_checksum')
    return payload


def _join(store, entries, reference_book, store_error, stopped):
    output = io.BytesIO()
    counts = collections.Counter()
    missing = collections.Counter()
    events, players = set(), set()
    earliest = latest = None
    fields = None
    canaries = 0
    with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as gz:
        with io.TextIOWrapper(gz, encoding='utf-8', newline='') as target:
            writer = None
            for entry in entries:
                payload = _verified(store, entry, store_error)
                canaries += entry['info'].get('excludedCanaries', 0)
                with gzip.open(io.BytesIO(payload), 'rt', encoding='utf-8', newline='') as file:
                    reader = csv.DictReader(file)
                    if fields is None:
                        fields = reader.fieldnames or []
                        writer = csv.DictWriter(target, fieldnames=fields)
                        writer.writeheader()
                    elif reader.fieldnames != fields:
                        raise stopped('export_columns_changed_between_chunks')
                    if 'customer_token' in fields:
                        raise store_error('unsanitized_chunk')
                    for row in reader:
                        writer.writerow(row)
                        counts[row.get('market', 'unknown')] += 1
                        events.add(row.get('event_id'))
                        players.add(row.get('player_id') or row.get('player_name'))
                        try:
                            when = instant(row.get('commence_time')).timestamp()
                            earliest = when if earliest is None else min(earliest, when)
                            latest = when if latest is None else max(latest, when)
                        except (ValueError, TypeError):
                            pass
                        for name in ('player_id', 'opening_at', 'opening_price', 'opening_point', 'actual_value'):
                            if row.get(name) in (None, ''):
                                missing[name] += 1
                        if output.tell() > MERGED_COMPRESSED_LIMIT:
                            raise stopped('merged_export_memory_budget')
    payload = output.getvalue()
    if len(payload) > MERGED_COMPRESSED_LIMIT:
        raise stopped('merged_export_memory_budget')
    return payload, {
        'rows': sum(counts.values()), 'events': len(events), 'players': len(players),
        'markets': dict(counts), 'earliestGame': earliest, 'latestGame': latest,
        'missing': dict(missing), 'excludedCanaries': canaries,
        'archiveHeaders': [entry['info'].get('archiveHeaders', {}) for entry in entries],
        'dataSha256': sha(payload), 'customerTokenRemoved': True,
        'referenceBook': reference_book,
        'bookScope': 'single-reference-book' if reference_book else 'all-returned-books',
        'chunks': len(entries), 'chunkDataSha256': [entry['info']['dataSha256'] for entry in entries],
    }


def make_exporter(legacy, reference_books, stopped, store_error, emit=lambda *a, **k: None):
    def export(provider, store, sport, since, until):
        reference_book = reference_books.get(sport)
        scope = [FORMAT, sport, since, until, reference_book]
        manifest_path = f'exports/{sport}/{sha(encode(scope))[:24]}.chunks.json'
        saved = store.get(manifest_path)
        manifest = json.loads(saved) if saved else {
            'schema': FORMAT, 'scope': scope,
            'pending': initial_windows(sport, since, until), 'completed': [],
        }
        if manifest.get('schema') != FORMAT or manifest.get('scope') != scope:
            raise store_error('chunk_manifest_scope_mismatch')
        cache_only = True

        def checkpoint():
            store.put(manifest_path, encode(manifest))

        checkpoint()
        # Iterative bounded subdivision. Provider remains responsible for the
        # existing 80-call, 512 MiB, one-hour and website-reserve constraints.
        while manifest['pending']:
            window = manifest['pending'][0]
            try:
                payload, info = legacy(LimitedStream(provider), store, sport, *window)
            except ChunkTooLarge:
                children = bisect_window(window)
                if children is None:
                    raise stopped('single_day_export_too_large')
                manifest['pending'][0:1] = children
                checkpoint()
                emit('EXPORT_WINDOW_SPLIT', sport=sport, since=window[0], until=window[1],
                     retainedChunks=len(manifest['completed']))
                continue
            cache_only = cache_only and info.get('cacheHit', False)
            # The legacy exporter already writes this deterministic private key.
            old_scope = [sport, *window] + ([reference_book] if reference_book else [])
            path = f'exports/{sport}/{sha(encode(old_scope))[:24]}.csv.gz'
            if sha(payload) != info['dataSha256']:
                raise store_error('export_result_checksum')
            entry = {'path': path, 'window': window, 'info': info}
            _verified(store, entry, store_error)
            manifest['completed'].append(entry)
            manifest['pending'].pop(0)
            checkpoint()
            emit('EXPORT_CHUNK_SAVED', sport=sport, since=window[0], until=window[1],
                 rows=info['rows'], completedChunks=len(manifest['completed']),
                 pendingChunks=len(manifest['pending']), cacheHit=info.get('cacheHit', False))
        payload, info = _join(store, manifest['completed'], reference_book, store_error, stopped)
        info['cacheHit'] = cache_only
        info['chunkManifest'] = manifest_path
        return payload, info
    return export
