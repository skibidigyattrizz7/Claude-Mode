#!/usr/bin/env python3
"""Faster photo pass through English Wikipedia's batch API (owner, Sep 30).

Wikidata rate-limits this network hard, so this pass asks en.wikipedia.org instead, 50 people per request:
the article for "<full name>" (or "<full name> (footballer)" / "(football manager)"), checked by its short
description, and its lead image restricted to FREE files (pilicense=free). Licence / author come from the same
API (imageinfo + extmetadata of the Commons file) and are checked again against fetch_player_photos.ALLOWED.
Crop, output files, credits.json and playerphotos.js are shared with tools/fetch_player_photos.py.

  python3 tools/fetch_photos_wp.py            # players + managers, skips people that already have a photo
  python3 tools/fetch_photos_wp.py --limit 30
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import fetch_player_photos as F  # noqa: E402

ENWIKI = 'https://en.wikipedia.org/w/api.php'
FOOTY = re.compile(r'(footballer|football player|soccer|football manager|football coach|association football)', re.I)


def lookup(titles):
    """{requested title: (resolved title, description, free lead image filename | None)}"""
    out = {}
    for group in F.chunks(list(dict.fromkeys(titles)), 50):
        d = F.api(ENWIKI, action='query', titles='|'.join(group), redirects='1', prop='pageimages|description',
                  piprop='name', pilicense='free')
        q = d.get('query', {})
        back = {}
        for n in (q.get('normalized') or []) + (q.get('redirects') or []):
            back[n['to']] = back.get(n['from'], n['from'])
        for pg in q.get('pages', []):
            if pg.get('missing'):
                continue
            src = back.get(pg['title'], pg['title'])
            src = back.get(src, src)
            out[src] = (pg['title'], pg.get('description', ''), pg.get('pageimage'))
    return out


def file_info(files):
    out = {}
    for group in F.chunks(list(dict.fromkeys(files)), 40):
        d = F.api(ENWIKI, action='query', titles='|'.join('File:' + f for f in group), prop='imageinfo',
                  iiprop='url|extmetadata', iiurlwidth='500')
        for pg in d.get('query', {}).get('pages', []):
            ii = (pg.get('imageinfo') or [None])[0]
            if not ii:
                continue
            fn = pg['title'][5:]
            md = ii.get('extmetadata') or {}
            g = lambda k: (md.get(k) or {}).get('value', '')
            out[fn.replace(' ', '_')] = out[fn] = {
                'thumb': ii.get('thumburl') or ii.get('url'),
                'author': F.clean(g('Artist')) or F.clean(g('Credit')) or 'Unknown',
                'license': F.clean(g('LicenseShortName')) or F.clean(g('License')),
                'nonfree': g('NonFree').lower() == 'true',
                'url': ii.get('descriptionurl') or '',
            }
    return out


def run(label, targets, out_dir):
    """targets: {key: full name}"""
    credits_path = os.path.join(out_dir, 'credits.json')
    credits = F.load_json(credits_path, {})
    todo = {k: n for k, n in targets.items() if not (k in credits and os.path.exists(os.path.join(out_dir, credits[k]['file'])))}
    print(f'{label}: {len(todo)} to fetch ({len(targets) - len(todo)} already have a photo)', file=sys.stderr)
    names = {k: F.ALIASES.get(k) or F.ALIASES.get(n) or n for k, n in todo.items()}
    found = {}
    suffixes = ['', ' (footballer)', ' (football manager)', ' (Brazilian footballer)', ' (Argentine footballer)']
    for suf in suffixes:
        left = {k: n for k, n in names.items() if k not in found}
        if not left:
            break
        res = lookup([n + suf for n in left.values()])
        for k, n in left.items():
            r = res.get(n + suf)
            if r and r[2] and FOOTY.search(r[1] or ''):
                found[k] = (r[0], r[2])
    info = file_info([f for _, f in found.values()])
    os.makedirs(out_dir, exist_ok=True)
    misses = []
    for k in todo:
        if k not in found:
            misses.append(k); continue
        title, fn = found[k]
        i = info.get(fn) or info.get(fn.replace('_', ' '))
        if not i or i['nonfree'] or not F.licence_ok(i['license']) or not i['thumb']:
            misses.append(k); continue
        try:
            data = F._fetch(i['thumb'], binary=True)
            if not data:
                misses.append(k); continue
            webp = F.portrait(data)
        except Exception as e:  # noqa: BLE001
            print(f'  {k}: {e}', file=sys.stderr); misses.append(k); continue
        file = f'{k}.webp'
        with open(os.path.join(out_dir, file), 'wb') as f:
            f.write(webp)
        credits[k] = {'name': targets[k], 'file': file, 'author': i['author'], 'license': i['license'], 'url': i['url'], 'article': title}
        if len(credits) % 25 == 0:
            F.save_json(credits_path, credits)
            print(f'  {len(credits)} photos', file=sys.stderr)
    F.save_json(credits_path, credits)
    print(f'{label}: {len(credits)} with photos, {len(misses)} misses', file=sys.stderr)
    return credits, misses


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    out = subprocess.run(['node', os.path.join(F.ROOT, 'tools', 'list_real_people.mjs')], check=True, capture_output=True, text=True, cwd=F.ROOT).stdout
    people = json.loads(out)
    if a.limit:
        people = people[:a.limit]
    credits, misses = run('player', {p['person']: p['name'] for p in people}, F.PLAYER_DIR)
    F.write_photos_js(credits)
    _, mmiss = run('manager', dict(F.MANAGERS), F.MANAGER_DIR)
    F.save_json(F.MISSES, {'players': sorted(misses), 'managers': sorted(mmiss)})


if __name__ == '__main__':
    main()
