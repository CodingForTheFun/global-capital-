"""Cold-start the pinned upstream trainer without any production credentials.

Run with its locked Python 3.11 environment, from the upstream checkout.
Empty dictionaries are uninitialized runtime state, never fabricated observations,
learned weights, positive validation evidence, or permission to publish a model.
"""
from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlsplit
import requests

root = Path.cwd()
package = root / 'src' / 'sportstradamus'
creds = package / 'creds' / 'keys.json'
creds.parent.mkdir(parents=True, exist_ok=True)
if creds.exists() and any(json.loads(creds.read_text()).values()):
    raise RuntimeError('This credential-free bootstrap must not receive live keys.')
creds.write_text(json.dumps({'odds_api': '', 'scrapeops': '', 'scrapingfish': ''}) + '\n')
for name in ('book_weights.json', 'goalies.json'):
    p = package / 'data' / 'config' / name
    if not p.exists():
        p.write_text('{}\n')

# No new paid data retrieval or proxy/header-rotation fallback during training.
_original = requests.sessions.Session.request
_denied = ('the-odds-api.com', 'scrapeops.io', 'scrapingfish.com')
def guarded_request(self, method, url, *args, **kwargs):
    host = (urlsplit(str(url)).hostname or '').lower()
    if any(host == domain or host.endswith('.' + domain) for domain in _denied):
        raise RuntimeError('Unconfigured paid odds/proxy service requested; bootstrap stops here.')
    kwargs.setdefault('timeout', 45)
    return _original(self, method, url, *args, **kwargs)
requests.sessions.Session.request = guarded_request

from sportstradamus.cli import cli
# Use full upstream quality gates, not deterministic/debug or withholding-bypass flags.
cli(['meditate', '--league', 'NFL', '--market', 'attempts,completions,passing tds,receptions'])
