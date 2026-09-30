#!/usr/bin/env python3
"""Fetch freely licensed portrait photos of the real players (and managers) from Wikidata / Wikimedia Commons.

Only Wikidata property P18 (image) -> Commons file, and only licences CC0 / Public domain / CC BY / CC BY-SA
(any version) are accepted. Every photo's author, licence and Commons page are written to a credits.json.

  python3 tools/fetch_player_photos.py                # players + managers
  python3 tools/fetch_player_photos.py --players      # players only
  python3 tools/fetch_player_photos.py --managers     # managers only
  python3 tools/fetch_player_photos.py --retry-misses # try the ones that had no usable photo again

Idempotent and resumable: a person that already has its .webp AND a credits entry is skipped, and every API
response is cached in tools/.photo_cache/ (git-ignored), so re-running costs almost nothing.
Outputs:
  3d/assets/players/<person>.webp, 3d/assets/players/credits.json, 3d/js/meta/core/playerphotos.js (generated)
  3d/assets/managers/<slug>.webp,  3d/assets/managers/credits.json
  tools/photo_misses.json (people with no usable free photo; they keep the drawn avatar)
"""
import argparse, hashlib, html, io, json, os, re, ssl, subprocess, sys, time, unicodedata
import urllib.error, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
UA = 'PitchsideSchoolGame/1.0 (school project; contact via GitHub skibidigyattrizz7/Claude-Mode)'
CACHE = os.path.join(ROOT, 'tools', '.photo_cache')
PLAYER_DIR = os.path.join(ROOT, '3d', 'assets', 'players')
MANAGER_DIR = os.path.join(ROOT, '3d', 'assets', 'managers')
MISSES = os.path.join(ROOT, 'tools', 'photo_misses.json')
PHOTOS_JS = os.path.join(ROOT, '3d', 'js', 'meta', 'core', 'playerphotos.js')
W, H = 240, 300
MAX_BYTES = 25 * 1024

MANAGERS = {
    'guardiola': 'Pep Guardiola', 'ancelotti': 'Carlo Ancelotti', 'klopp': 'Jürgen Klopp', 'mourinho': 'José Mourinho',
    'zidane': 'Zinedine Zidane', 'simeone': 'Diego Simeone', 'arteta': 'Mikel Arteta', 'xabi_alonso': 'Xabi Alonso',
    'flick': 'Hansi Flick', 'luis_enrique': 'Luis Enrique', 'slot': 'Arne Slot', 'scaloni': 'Lionel Scaloni',
    'deschamps': 'Didier Deschamps', 'southgate': 'Gareth Southgate', 'ferguson': 'Alex Ferguson', 'wenger': 'Arsène Wenger',
    'low': 'Joachim Löw', 'tuchel': 'Thomas Tuchel', 'conte': 'Antonio Conte', 'nagelsmann': 'Julian Nagelsmann',
    'pochettino': 'Mauricio Pochettino', 'amorim': 'Rúben Amorim', 'inzaghi': 'Simone Inzaghi', 'kompany': 'Vincent Kompany',
}
# Search-name overrides where the card's full name is not how Wikipedia / Wikidata names the person.
ALIASES = {}
_alias_file = os.path.join(ROOT, 'tools', 'photo_aliases.json')
if os.path.exists(_alias_file):
    ALIASES = json.load(open(_alias_file, encoding='utf-8'))

Q_FOOTBALLER, Q_MANAGER = 'Q937857', 'Q628099'
UK = ['Q145', 'Q174193']
NAT = {
    'ENG': ['Q179876'] + UK, 'SCO': ['Q22'] + UK, 'WAL': ['Q25'] + UK, 'NIR': ['Q26'] + UK, 'FRA': ['Q142'], 'BRA': ['Q155'],
    'ESP': ['Q29'], 'ITA': ['Q38'], 'GER': ['Q183', 'Q713750', 'Q16957'], 'ARG': ['Q414'], 'EGY': ['Q79'],
    'NED': ['Q55', 'Q29999'], 'POR': ['Q45'], 'BEL': ['Q31'], 'CRO': ['Q224', 'Q36704'], 'URU': ['Q77'],
    'SRB': ['Q403', 'Q37024', 'Q36704', 'Q838261'], 'DEN': ['Q35'], 'CIV': ['Q1008'], 'USA': ['Q30'], 'SUI': ['Q39'],
    'NGA': ['Q1033'], 'SWE': ['Q34'], 'IRL': ['Q27'], 'SEN': ['Q1041'], 'TUR': ['Q43'], 'JPN': ['Q17'], 'CMR': ['Q1009'],
    'KOR': ['Q884'], 'POL': ['Q36'], 'GHA': ['Q117'], 'COL': ['Q739'], 'CZE': ['Q213', 'Q33946'], 'SVN': ['Q215'],
    'ECU': ['Q736'], 'NOR': ['Q20'], 'ROU': ['Q218'], 'GEO': ['Q230'], 'CAN': ['Q16'], 'HUN': ['Q28'], 'UKR': ['Q212'],
    'CHI': ['Q298'], 'MEX': ['Q96'], 'GRE': ['Q41'], 'RUS': ['Q159', 'Q15180'], 'AUS': ['Q408'], 'BUL': ['Q219'],
    'AUT': ['Q40'], 'MAR': ['Q1028'], 'PER': ['Q419'], 'IRN': ['Q794'], 'KEN': ['Q114'], 'ISR': ['Q801'], 'FIN': ['Q33'],
    'ALG': ['Q262'], 'TUN': ['Q948'], 'MLI': ['Q912'], 'BFA': ['Q965'], 'GUI': ['Q1006'], 'COD': ['Q974'], 'GAB': ['Q1000'],
    'ISL': ['Q189'], 'SVK': ['Q214'], 'BIH': ['Q225'], 'ALB': ['Q222'], 'MKD': ['Q221'], 'MNE': ['Q236'], 'KVX': ['Q1246'],
    'ARM': ['Q399'], 'AZE': ['Q227'], 'KAZ': ['Q232'], 'CRC': ['Q800'], 'PAR': ['Q733'], 'VEN': ['Q717'], 'BOL': ['Q750'],
    'JAM': ['Q766'], 'PAN': ['Q804'], 'HON': ['Q783'], 'SUR': ['Q730'], 'CUW': ['Q25279'], 'NZL': ['Q664'], 'CHN': ['Q148'],
    'SAU': ['Q851'], 'QAT': ['Q846'], 'UZB': ['Q265'], 'MOZ': ['Q1029'], 'ANG': ['Q916'], 'CPV': ['Q1011'], 'ZAM': ['Q953'],
}

_ctx = ssl.create_default_context()
_bundle = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE') or '/root/.ccr/ca-bundle.crt'
if os.path.exists(_bundle):
    _ctx = ssl.create_default_context(cafile=_bundle)  # never disable verification, just trust the proxy CA
_opener = urllib.request.build_opener(urllib.request.ProxyHandler(), urllib.request.HTTPSHandler(context=_ctx))
_last = [0.0]
_gap = [0.25]  # seconds between requests (<= 4 req/s); grows on 429s


def _fetch(url, binary=False, tries=8):
    for attempt in range(tries):
        wait = _gap[0] - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
        try:
            with _opener.open(req, timeout=60) as r:
                data = r.read()
            _gap[0] = max(0.25, _gap[0] * 0.95)
            return data if binary else data.decode('utf-8')
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 502, 504):
                ra = e.headers.get('Retry-After')
                delay = min(120, float(ra) + 1 if ra and ra.replace('.', '').isdigit() else 5 * (attempt + 1))
                _gap[0] = min(3.0, _gap[0] * 1.5)
                print(f'  [{e.code}] backing off {delay:.0f}s', file=sys.stderr)
                time.sleep(delay)
                continue
            if e.code == 404:
                return None
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            print(f'  [net error {e}] retry', file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('too many retries: ' + url)


def api(base, **params):
    """GET a MediaWiki API call (JSON), cached on disk by URL."""
    params.setdefault('format', 'json')
    params.setdefault('formatversion', '2')
    url = base + '?' + urllib.parse.urlencode(params)
    key = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + '.json')
    if os.path.exists(key):
        return json.load(open(key, encoding='utf-8'))
    text = _fetch(url)
    data = json.loads(text) if text else {}
    if 'error' not in data:
        os.makedirs(CACHE, exist_ok=True)
        json.dump(data, open(key, 'w', encoding='utf-8'))
    return data


WD = 'https://www.wikidata.org/w/api.php'
COMMONS = 'https://commons.wikimedia.org/w/api.php'


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fold(s):
    return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).strip()


def claim_ids(ent, prop):
    out = []
    for c in (ent.get('claims') or {}).get(prop, []):
        v = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value')
        if isinstance(v, dict) and 'id' in v:
            out.append(v['id'])
    return out


def image_files(ent):
    """P18 file names, preferred-rank first."""
    claims = (ent.get('claims') or {}).get('P18', [])
    claims = sorted(claims, key=lambda c: {'preferred': 0, 'normal': 1}.get(c.get('rank'), 2))
    return [c['mainsnak']['datavalue']['value'] for c in claims if c.get('rank') != 'deprecated' and (c.get('mainsnak') or {}).get('datavalue')]


def score(ent, name, nat, want_manager):
    """Higher is better; -1 = not a football person."""
    occ = set(claim_ids(ent, 'P106'))
    if not occ & {Q_FOOTBALLER, Q_MANAGER}:
        return -1
    s = 1
    if want_manager and Q_MANAGER in occ:
        s += 2
    if not want_manager and Q_FOOTBALLER in occ:
        s += 1
    cits = set(claim_ids(ent, 'P27'))
    if nat and NAT.get(nat) and cits & set(NAT[nat]):
        s += 4
    label = (ent.get('labels') or {}).get('en', {}).get('value', '')
    if fold(label) == fold(name):
        s += 2
    if image_files(ent):
        s += 1
    return s


def find_entities(targets):
    """targets: {key: (name, nat, want_manager)} -> {key: entity} (best football match per key)."""
    ents = {}
    keys = list(targets)
    # Pass A: English Wikipedia article titles (batched, redirects followed) -> Wikidata item ids -> batched entity fetch.
    # The plain name first, then the usual disambiguation suffixes, until the item is a football person of the right country.
    for suffix in ('', ' (footballer)', ' (soccer)', ' (association footballer)', ' (football manager)', ' (soccer player)'):
        todo = [k for k in keys if k not in ents]
        if not todo:
            break
        qid_of = {}
        for group in chunks(todo, 40):
            titles = {}
            for k in group:
                titles.setdefault((ALIASES.get(k, targets[k][0]) + suffix), []).append(k)
            d = api('https://en.wikipedia.org/w/api.php', action='query', titles='|'.join(titles), prop='pageprops',
                    ppprop='wikibase_item|disambiguation', redirects='1')
            q = d.get('query', {})
            back = {}  # requested title -> final title (normalised / redirected)
            for key in ('normalized', 'redirects'):
                for r in q.get(key, []) or []:
                    back[r['from']] = r['to']
            final = {}
            for t in titles:
                x = t
                for _ in range(3):
                    x = back.get(x, x)
                final[x] = t
            for pg in q.get('pages', []):
                pp = pg.get('pageprops') or {}
                if 'disambiguation' in pp or 'wikibase_item' not in pp:
                    continue
                for k in titles.get(final.get(pg['title']), []):
                    qid_of[k] = pp['wikibase_item']
        ids = sorted(set(qid_of.values()))
        got = {}
        for group in chunks(ids, 40):
            d = api(WD, action='wbgetentities', ids='|'.join(group), props='claims|labels', languages='en')
            for eid, ent in (d.get('entities') or {}).items():
                if isinstance(ent, dict) and 'missing' not in ent:
                    got[eid] = ent
        for k, qid in qid_of.items():
            ent = got.get(qid)
            name, nat, wm = targets[k]
            if ent and score(ent, name, nat, wm) >= (5 if nat else 1):
                ents[k] = ent
    # Pass B: wbsearchentities for the rest
    for k in keys:
        if k in ents:
            continue
        name, nat, wm = targets[k]
        q = ALIASES.get(k, name)
        cand_ids = []
        for term in dict.fromkeys([q, fold(q)]):
            d = api(WD, action='wbsearchentities', search=term, language='en', uselang='en', type='item', limit='10')
            cand_ids += [r['id'] for r in d.get('search', []) if r['id'] not in cand_ids]
            if cand_ids:
                break
        best, best_s = None, 0
        if cand_ids:
            d = api(WD, action='wbgetentities', ids='|'.join(cand_ids[:10]), props='claims|labels', languages='en')
            for ent in (d.get('entities') or {}).values():
                if not isinstance(ent, dict) or 'missing' in ent:
                    continue
                s = score(ent, name, nat, wm)
                # a football person whose nationality we could not confirm is only accepted on an exact name match
                if nat and s < 5 and fold((ent.get('labels') or {}).get('en', {}).get('value', '')) != fold(name):
                    continue
                if s > best_s:
                    best, best_s = ent, s
        if best:
            ents[k] = best
    return ents


ALLOWED = re.compile(r'^(cc0|public domain|pd\b|cc[- ]by(-sa)?[- ]\d|cc[- ]by(-sa)?$)', re.I)
DENIED = re.compile(r'(\b(nc|nd)\b|non-?commercial|no ?deriv|fair use|gfdl(?!.*cc)|all rights reserved|copyrighted)', re.I)


def licence_ok(short):
    s = (short or '').strip()
    return bool(s) and bool(ALLOWED.match(s)) and not DENIED.search(s)


def clean(t):
    t = re.sub(r'<[^>]+>', ' ', t or '')
    t = html.unescape(t)
    return re.sub(r'\s+', ' ', t).strip()[:200]


def commons_info(filenames):
    """{filename: info} for every file Commons knows; info has thumb url, author, licence, page url."""
    out = {}
    names = list(dict.fromkeys(filenames))
    for group in chunks(names, 40):
        d = api(COMMONS, action='query', titles='|'.join('File:' + n for n in group), prop='imageinfo',
                iiprop='url|extmetadata|size', iiurlwidth='500')
        norm = {n['to']: n['from'] for n in (d.get('query', {}).get('normalized') or [])}
        for pg in d.get('query', {}).get('pages', []):
            ii = (pg.get('imageinfo') or [None])[0]
            if not ii:
                continue
            title = pg['title']
            orig = norm.get(title, title)
            fn = orig[5:] if orig.lower().startswith('file:') else orig
            md = ii.get('extmetadata') or {}
            g = lambda k: (md.get(k) or {}).get('value', '')
            out[fn] = {
                'thumb': ii.get('thumburl') or ii.get('url'), 'w': ii.get('thumbwidth') or ii.get('width'),
                'author': clean(g('Artist')) or clean(g('Credit')) or 'Unknown',
                'license': clean(g('LicenseShortName')) or clean(g('License')),
                'nonfree': g('NonFree').lower() == 'true', 'restr': g('Restrictions'),
                'url': ii.get('descriptionurl') or ('https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(fn.replace(' ', '_'))),
            }
    return out


def portrait(data):
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (200, 200, 200))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im = im.convert('RGB')
    w, h = im.size
    if h >= w:
        # portrait / square: keep the top ~62% of the height (head and shoulders), 4:5, centred horizontally
        ch = int(h * 0.62)
        cw = int(ch * 0.8)
        if cw > w:
            cw = w
            ch = int(cw * 1.25)
        top = 0
    else:
        # landscape: a 4:5 box from the full height, centred horizontally, taken from the upper part
        ch = h
        cw = int(ch * 0.8)
        if cw > w:
            cw = w
            ch = int(cw * 1.25)
        top = 0
    left = max(0, (w - cw) // 2)
    im = im.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS)
    for q in (72, 66, 60, 54, 48):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            break
    return buf.getvalue()


def load_json(path, default):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')


def run(label, targets, out_dir, retry_misses):
    """targets: {key: (name, nat, want_manager)}; returns nothing, writes files + credits.json + misses."""
    credits_path = os.path.join(out_dir, 'credits.json')
    credits = load_json(credits_path, {})
    misses = load_json(MISSES, {})
    os.makedirs(out_dir, exist_ok=True)
    todo = {}
    for k, v in targets.items():
        if k in credits and os.path.exists(os.path.join(out_dir, credits[k]['file'])):
            continue
        if not retry_misses and (label + ':' + k) in misses:
            continue
        todo[k] = v
    print(f'[{label}] {len(targets)} people, {len(credits)} done, {len(todo)} to fetch', file=sys.stderr)
    if not todo:
        return credits
    ents = find_entities(todo)
    files_for = {k: image_files(e) for k, e in ents.items()}
    info = commons_info([f for fs in files_for.values() for f in fs])
    n_ok = 0
    for i, (k, (name, nat, wm)) in enumerate(todo.items(), 1):
        reason = None
        if k not in ents:
            reason = 'no Wikidata football person found'
        elif not files_for[k]:
            reason = 'no P18 image on ' + ents[k].get('id', '?')
        else:
            reason = 'no file with an allowed licence'
            for fn in files_for[k]:
                inf = info.get(fn)
                if not inf:
                    continue
                if inf['nonfree'] or not licence_ok(inf['license']):
                    reason = f'licence not allowed ({inf["license"] or "unknown"})'
                    continue
                try:
                    raw = _fetch(inf['thumb'], binary=True)
                    webp = portrait(raw) if raw else None
                except Exception as e:  # unreadable image etc.
                    reason = f'image error {e}'
                    continue
                if not webp:
                    reason = 'download failed'
                    continue
                fname = k + '.webp'
                with open(os.path.join(out_dir, fname), 'wb') as f:
                    f.write(webp)
                credits[k] = {'name': name, 'file': fname, 'author': inf['author'], 'license': inf['license'], 'url': inf['url']}
                misses.pop(label + ':' + k, None)
                reason = None
                n_ok += 1
                break
        if reason:
            misses[label + ':' + k] = {'name': name, 'nat': nat, 'reason': reason, 'qid': (ents.get(k) or {}).get('id')}
            print(f'  miss {k} ({name}): {reason}', file=sys.stderr)
        if i % 20 == 0:
            save_json(credits_path, credits)
            save_json(MISSES, misses)
            print(f'  {i}/{len(todo)}', file=sys.stderr)
    save_json(credits_path, credits)
    save_json(MISSES, misses)
    print(f'[{label}] fetched {n_ok}, missed {len(todo) - n_ok}', file=sys.stderr)
    return credits


def write_photos_js(credits):
    ids = sorted(k for k, v in credits.items() if os.path.exists(os.path.join(PLAYER_DIR, v['file'])))
    lines = ['// GENERATED by tools/fetch_player_photos.py: the real persons that have a photo in assets/players/<person>.webp.',
             '// Photos are freely licensed (CC0 / Public domain / CC BY / CC BY-SA) from Wikimedia Commons; see assets/players/credits.json',
             '// and credits.html. Do not edit by hand.',
             'export const PLAYER_PHOTOS = new Set([']
    for chunk in chunks(ids, 6):
        lines.append('  ' + ' '.join(json.dumps(x) + ',' for x in chunk))
    lines.append(']);')
    # the bigger "dynamic" cutouts promo cards use (assets/players/dyn/<person>.webp, tools/photos_v2.py)
    dyn_dir = os.path.join(PLAYER_DIR, 'dyn')
    dyn = sorted(k for k in ids if os.path.exists(os.path.join(dyn_dir, k + '.webp')))
    lines.append('export const PLAYER_DYN = new Set([')
    for chunk in chunks(dyn, 6):
        lines.append('  ' + ' '.join(json.dumps(x) + ',' for x in chunk))
    lines.append(']);')
    lines.append('')
    with open(PHOTOS_JS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--players', action='store_true')
    ap.add_argument('--managers', action='store_true')
    ap.add_argument('--retry-misses', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='only the first N players (testing)')
    a = ap.parse_args()
    both = not (a.players or a.managers)
    if a.players or both:
        out = subprocess.run(['node', os.path.join(ROOT, 'tools', 'list_real_people.mjs')], check=True, capture_output=True, text=True, cwd=ROOT).stdout
        people = json.loads(out)
        if a.limit:
            people = people[:a.limit]
        targets = {p['person']: (p['name'], p['nat'], False) for p in people}
        credits = run('player', targets, PLAYER_DIR, a.retry_misses)
        write_photos_js(credits)
    if a.managers or both:
        run('manager', {k: (v, None, True) for k, v in MANAGERS.items()}, MANAGER_DIR, a.retry_misses)


if __name__ == '__main__':
    main()
