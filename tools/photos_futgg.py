#!/usr/bin/env python3
"""Real player pictures from EA SPORTS FC 26/27 via FUT.GG (owner, Sep 30: non-commercial fan game, EA's content policy
allows fan use; base cards = EA's straight-on face render, promo cards = EA's dynamic celebration images; FC 26 or newer
only).

For every real person: search fut.gg by name, open his player page and take
  * base  = the plain item image  <year>-<eaId>.*.webp (EA face render, transparent)  -> 3d/assets/players/<person>.webp (240x300)
  * dyn   = a special item image  <year>-<bigId>.*.webp (celebration / action cutout) -> 3d/assets/players/dyn/<person>.webp (300x375)
Newest game first (2027, then 2026). Nothing found -> no file (drawn face). Polite: ~1 request / second.

  python3 tools/photos_futgg.py [--limit N] [--only slug,slug]
"""
import argparse, io, json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import fetch_player_photos as F  # noqa: E402  (paths, proxy-aware opener, manifest writers)

SITE = 'https://www.fut.gg'
DYN_DIR = os.path.join(F.PLAYER_DIR, 'dyn')
CACHE = os.path.join(F.ROOT, 'tools', '.futgg_cache')
UA = 'Mozilla/5.0 (X11; CrOS x86_64) PitchsideFanGame/1.0 (non-commercial school fan game)'
ITEM = re.compile(r'https://game-assets\.fut\.gg/(?:cdn-cgi/image/[^/]+/)?(20(?:26|27))/player-item/(\d\d)-(\d+)\.([0-9a-f]+)\.webp')
_last = [0.0]


def get(url, binary=False):
    key = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9._-]', '_', url)[-180:])
    if os.path.exists(key):
        return open(key, 'rb').read() if binary else open(key, encoding='utf-8', errors='replace').read()
    for attempt in range(5):
        wait = 1.0 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            with F._opener.open(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                data = r.read()
            os.makedirs(CACHE, exist_ok=True)
            open(key, 'wb').write(data)
            return data if binary else data.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            print(f'  [{e.code}] {url[:80]} retry', file=sys.stderr)
            time.sleep(10 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            print(f'  [net {e}] retry', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None


def fold(s):
    return re.sub(r'[^a-z0-9 ]', ' ', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).split()


_EA = None
# players missing from EA's current ratings list (injured / between clubs) -> their EA id
MANUAL_EA_IDS = {'neymar jr': '190871', 'neymar': '190871'}


def ea_lookup(name):
    """EA player id from EA's own ratings list (tools/ea_player_ids.json, built from drop-api.ea.com) when the
    fut.gg name search misses (it only searches the newest game: Neymar, Alisson, Benzema... were not found)."""
    global _EA
    if _EA is None:
        _EA = {}
        path = os.path.join(F.ROOT, 'tools', 'ea_player_ids.json')
        for pid, r in (json.load(open(path)) if os.path.exists(path) else {}).items():
            first, last, common = (fold(r.get('first') or ''), fold(r.get('last') or ''), fold(r.get('common') or ''))
            for key in {' '.join(common), ' '.join(first + last), ' '.join(first[:1] + last[-1:])}:
                if key:
                    _EA.setdefault(key, pid)
            if len(common) == 1:  # one-word card names (Carvajal, Casemiro): usable when unique
                _EA['1:' + common[0]] = pid if '1:' + common[0] not in _EA else None
        _EA.update(MANUAL_EA_IDS)
    w = fold(name)
    for key in (' '.join(w), ' '.join(w[:1] + w[-1:]), ' '.join(w[:-1]) if len(w) > 1 and w[-1] in ('jr', 'junior') else '',
                '1:' + w[-1] if w else ''):
        if key and key in _EA:
            return _EA[key]
    return None


def find_player(name):
    """-> fut.gg player path (/players/<id>-<slug>/) or None: the first search hit whose slug holds the surname."""
    words = fold(name)
    for q in (name, words[-1] if words else name):
        html = get(SITE + '/players/?name=' + urllib.parse.quote(q))
        if not html:
            continue
        hits = list(dict.fromkeys(re.findall(r'/players/(\d+)-([a-z0-9-]+)/', html)))
        for pid, slug in hits:
            sw = slug.split('-')
            if words and words[-1] in sw and (len(words) == 1 or any(w in sw for w in words[:-1]) or len(sw) == 1):
                return f'/players/{pid}-{slug}/', pid
        for pid, slug in hits:
            if words and slug == '-'.join(words):
                return f'/players/{pid}-{slug}/', pid
    pid = ea_lookup(name)
    if pid:
        return f"/players/{pid}-{'-'.join(words) or 'player'}/", pid
    return None


def pictures(path, pid):
    """(base url | None, dyn url | None), newest game first."""
    html = get(SITE + path) or ''
    items = {}
    for m in ITEM.finditer(html):
        items.setdefault((m.group(1), m.group(3)), 'https://game-assets.fut.gg/%s/player-item/%s-%s.%s.webp' % (m.group(1), m.group(2), m.group(3), m.group(4)))
    base = dyn = None
    for year in ('2027', '2026'):
        if not base and (year, pid) in items:
            base = items[(year, pid)]
        if not dyn:
            # his own special items only: EA item ids are <base id> + n * 2^24 (the page also shows other players)
            special = [u for (y, i), u in items.items() if y == year and i != pid and (int(i) - int(pid)) % 16777216 == 0]
            if special:
                dyn = special[0]
    return base, dyn


def fit(data, out_w, out_h, top=True):
    """Crop the picture to out_w:out_h (keep the top: heads stay in) and resize, keeping alpha."""
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    bb = im.getbbox() or (0, 0, im.width, im.height)
    pad = int((bb[3] - bb[1]) * 0.03)
    im = im.crop((bb[0], max(0, bb[1] - pad), bb[2], bb[3]))  # drop the empty space around the player
    ratio = out_w / out_h
    if im.width / im.height < ratio:  # narrow: pad the sides so the crop below keeps the whole height
        w = int(im.height * ratio); c = Image.new('RGBA', (w, im.height)); c.paste(im, ((w - im.width) // 2, 0)); im = c
    ratio = out_w / out_h
    if im.width / im.height > ratio:  # too wide: centre crop the width
        w = int(im.height * ratio); x = (im.width - w) // 2
        im = im.crop((x, 0, x + w, im.height))
    else:  # too tall: keep the top
        h = int(im.width / ratio)
        im = im.crop((0, 0, im.width, h))
    return im.resize((out_w, out_h), Image.LANCZOS)


def webp(im, cap):
    for q in (82, 74, 66, 58, 50):
        buf = io.BytesIO(); im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= cap:
            break
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    people = json.loads(subprocess.run(['node', os.path.join(F.ROOT, 'tools', 'list_real_people.mjs')], check=True,
                                       capture_output=True, text=True, cwd=F.ROOT).stdout)
    if a.only:
        keep = set(a.only.split(',')); people = [p for p in people if p['person'] in keep]
    if a.limit:
        people = people[:a.limit]
    os.makedirs(DYN_DIR, exist_ok=True)
    credits, why = {}, {}
    for i, p in enumerate(people):
        k = p['person']
        name = F.ALIASES.get(k) or F.ALIASES.get(p['name']) or p['name']
        try:
            hit = find_player(name)
            if not hit:
                why[k] = 'not found on fut.gg'; continue
            base, dyn = pictures(*hit)
            if not base:
                why[k] = 'no FC 26/27 picture'; continue
            data = get(base, binary=True)
            if not data:
                why[k] = 'download failed'; continue
            open(os.path.join(F.PLAYER_DIR, k + '.webp'), 'wb').write(webp(fit(data, 240, 300), 30 * 1024))
            credits[k] = {'name': p['name'], 'file': k + '.webp', 'author': 'EA SPORTS FC (via FUT.GG)',
                          'license': 'EA fan content (non-commercial)', 'url': SITE + hit[0], 'article': ''}
            dpath = os.path.join(DYN_DIR, k + '.webp')
            ddata = dyn and get(dyn, binary=True)
            if ddata:
                open(dpath, 'wb').write(webp(fit(ddata, 300, 375), 40 * 1024))
            elif os.path.exists(dpath):
                os.remove(dpath)
        except Exception as e:  # noqa: BLE001
            why[k] = f'error {e}'
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(people)}: {len(credits)} pictures', file=sys.stderr, flush=True)
    if not a.only and not a.limit:
        for d in (F.PLAYER_DIR, DYN_DIR):
            for fn in os.listdir(d):
                if fn.endswith('.webp') and fn[:-5] not in credits:
                    os.remove(os.path.join(d, fn))
        F.save_json(os.path.join(F.PLAYER_DIR, 'credits.json'), credits)
        F.write_photos_js(credits)
        F.save_json(F.MISSES, {'players': why})
    from collections import Counter
    print(f'done: {len(credits)} pictures, {sum(os.path.exists(os.path.join(DYN_DIR, k + ".webp")) for k in credits)} dynamic; '
          f'{Counter(v.split(" (")[0] for v in why.values())}', file=sys.stderr)


if __name__ == '__main__':
    main()
