"""Shared helpers for the fut.gg tools (tools/fetch_futgg_players.py, tests): polite cached JSON client.

fut.gg is a public site; the owner allows using its card data for this non-commercial fan game (Sep 30). Rules we keep:
  * at most ~2 requests per second (MIN_GAP), a real descriptive User-Agent,
  * every response is cached on disk (tools/.futgg_players_cache/, git-ignored) so a re-run costs nothing.
"""
import gzip, hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE_DIR = os.path.join(ROOT, 'tools', '.futgg_players_cache')
API = 'https://www.fut.gg/api/fut'
UA = 'Mozilla/5.0 (X11; CrOS x86_64) PitchsideFanGame/1.0 (non-commercial school fan game)'
MIN_GAP = 0.55  # seconds between two network requests (< 2 requests / second)


class Client:
    def __init__(self, cache_dir=CACHE_DIR, refresh=False, min_gap=MIN_GAP, opener=None):
        self.cache_dir = cache_dir
        self.refresh = refresh
        self.min_gap = min_gap
        self.opener = opener or self._default_opener()
        self._last = 0.0
        self.requests = 0
        self.hits = 0

    @staticmethod
    def _default_opener():
        # honour the sandbox proxy / CA bundle when configured (same env vars the other tools use)
        return urllib.request.build_opener()

    def _path(self, url):
        return os.path.join(self.cache_dir, hashlib.sha1(url.encode()).hexdigest()[:2], hashlib.sha1(url.encode()).hexdigest() + '.json.gz')

    def get_json(self, url):
        """GET url -> parsed JSON (cached). None on 404."""
        p = self._path(url)
        if not self.refresh and os.path.exists(p):
            with gzip.open(p, 'rt', encoding='utf-8') as f:
                self.hits += 1
                return json.load(f)
        for attempt in range(6):
            wait = self.min_gap - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            try:
                with self.opener.open(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=60) as r:
                    raw = r.read()
                self.requests += 1
                data = json.loads(raw.decode('utf-8'))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with gzip.open(p, 'wt', encoding='utf-8') as f:
                    json.dump(data, f, separators=(',', ':'))
                return data
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                print(f'  [{e.code}] {url[:100]} retry {attempt + 1}', file=sys.stderr)
                time.sleep(8 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
                print(f'  [net {e}] retry {attempt + 1}', file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        raise RuntimeError(f'giving up on {url}')

    def search(self, game, **params):
        """One page of /players/v2/<game>/ (30..100 cards)."""
        q = urllib.parse.urlencode(params, safe=',')
        return self.get_json(f'{API}/players/v2/{game}/?{q}')

    def definitions(self, game, eaids):
        """Full card definitions for item eaIds (bulk, ~25 per request) -> list of dicts."""
        slugs = ','.join(f'{game}-{i}' for i in eaids)
        d = self.get_json(f'{API}/players/v2/definition-data/?slugs={slugs}')
        return (d or {}).get('data', [])
