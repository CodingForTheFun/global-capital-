"""Bounded public preflight for both verified ObligeProps board generations."""
from __future__ import annotations
import hashlib
import json
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import requests

ORIGIN = 'https://www.obligeprops.com'
MIB = 1024 * 1024

class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            src = dict(attrs).get('src')
            if src and src not in self.sources:
                self.sources.append(src)

def board_signature(source):
    if 'canonical-workspace-v1' in source:
        return 'canonical-workspace-v1'
    # Verified in deployed frontend bcdedb5224ca5d83dcfdb7c5be52859196573580.
    markers = ('Loading prop board', 'data-player-card', 'No props match these filters.')
    if all(marker in source for marker in markers):
        return 'premium-player-board'
    return None

def verify_website(*, get=None, stopped=RuntimeError):
    get = get or requests.get
    total = 0
    def read(url, limit):
        nonlocal total
        response = get(url, timeout=(8, 20), allow_redirects=False, stream=True)
        try:
            content = bytearray()
            for chunk in response.iter_content(chunk_size=65536):
                total += len(chunk)
                if len(content) + len(chunk) > limit or total > 12 * MIB:
                    raise stopped('website_smoke_byte_budget')
                content.extend(chunk)
            return response.status_code, response.headers.get('content-type', '').lower(), bytes(content)
        finally:
            response.close()
    try:
        status, media, body = read(ORIGIN + '/api/oblige-workspace?action=catalog', 64 * 1024)
        try:
            account = json.loads(body)
        except (ValueError, UnicodeError):
            raise stopped('website_auth_verification_failed') from None
        if status != 401 or not isinstance(account, dict) or account.get('code') != 'AUTH_REQUIRED':
            raise stopped('website_auth_verification_failed')
        status, media, page = read(ORIGIN + '/board', MIB)
        if status != 200 or 'text/html' not in media:
            raise stopped('website_board_unavailable')
        parser = Scripts()
        parser.feed(page.decode('utf-8', errors='replace'))
        checked = 0
        for src in parser.sources[:32]:
            target = urljoin(ORIGIN, src)
            parsed = urlparse(target)
            if (parsed.scheme != 'https' or parsed.netloc != urlparse(ORIGIN).netloc
                    or not parsed.path.startswith('/_next/') or not parsed.path.endswith('.js')):
                continue
            checked += 1
            status, media, asset = read(target, 5 * MIB)
            if status != 200 or not ('javascript' in media or 'ecmascript' in media):
                continue
            signature = board_signature(asset.decode('utf-8', errors='replace'))
            if signature:
                return {'accountGate': 401, 'boardHTTP': 200,
                        'canonicalWorkspaceAssetSha256': hashlib.sha256(asset).hexdigest(),
                        'boardHtmlSha256': hashlib.sha256(page).hexdigest(),
                        'frontendSignature': signature, 'checkedScripts': checked}
        raise stopped('website_new_workspace_not_served')
    except requests.RequestException:
        raise stopped('website_smoke_network') from None
