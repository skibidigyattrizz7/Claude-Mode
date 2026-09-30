#!/usr/bin/env python3
"""Real player photos, v2 (owner, Sep 30: "for basic cards just do their face like FIFA and remove background").

For every real person: find the English Wikipedia article (as tools/fetch_photos_wp.py does), take its FREE lead
image, then
  * reject photos from the wrong era: photo year (EXIF DateTimeOriginal) minus birth year (article description,
    "born 1990") must be 17..36 for retired players (no old-man legends) and 17..42 for players still playing
    (no childhood photos); retired players with an undated photo get no photo (drawn avatar) rather than a guess;
  * find the face (OpenCV), cut the person out of the background (rembg, u2net_human_seg);
  * write a FIFA-style head-and-shoulders cutout      -> 3d/assets/players/<person>.webp      (240x300, alpha)
    and a bigger upper-body "dynamic" cutout (promos) -> 3d/assets/players/dyn/<person>.webp  (300x375, alpha).
Raw downloads are cached in tools/.photo_raw/ (git-ignored), API answers in tools/.photo_cache/.

  python3 tools/photos_v2.py [--limit N] [--only slug,slug]
"""
import argparse, io, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import fetch_player_photos as F  # noqa: E402
import fetch_photos_wp as W      # noqa: E402

RAW = os.path.join(F.ROOT, 'tools', '.photo_raw')
DYN_DIR = os.path.join(F.PLAYER_DIR, 'dyn')
BORN = re.compile(r'born (\d{4})|\((?:b\. )?(\d{4})\s*[–-]')
YEAR = re.compile(r'\b(19[5-9]\d|20[0-3]\d)\b')

_face = None
_seg = None


def face_box(img):
    """Largest frontal face (x, y, w, h) in the upper 75% of the image, or None."""
    global _face
    import cv2, numpy as np
    if _face is None:
        _face = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    g = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2GRAY)
    h = g.shape[0]
    faces = _face.detectMultiScale(g, scaleFactor=1.08, minNeighbors=6, minSize=(int(h * 0.06), int(h * 0.06)))
    faces = [f for f in faces if f[1] + f[3] / 2 < h * 0.75]
    if not len(faces):
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def cutout(img):
    global _seg
    from rembg import remove, new_session
    if _seg is None:
        _seg = new_session('u2net_human_seg')
    return remove(img.convert('RGB'), session=_seg, post_process_mask=True)


def crop_around(rgba, face, width_faces, top_frac, out_w, out_h):
    """Crop a out_w:out_h box whose width is width_faces x the face width, face top at top_frac of the height."""
    from PIL import Image
    x, y, fw, fh = face
    cw = fw * width_faces
    ch = cw * out_h / out_w
    cx = x + fw / 2
    left, top = cx - cw / 2, y - ch * top_frac
    box = (int(round(left)), int(round(top)), int(round(left + cw)), int(round(top + ch)))
    canvas = Image.new('RGBA', (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    canvas.paste(rgba.crop((max(0, box[0]), max(0, box[1]), min(rgba.width, box[2]), min(rgba.height, box[3]))),
                 (max(0, -box[0]), max(0, -box[1])))
    return canvas.resize((out_w, out_h), Image.LANCZOS)


def webp(im, cap=26 * 1024):
    for q in (80, 72, 64, 56, 48):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= cap:
            break
    return buf.getvalue()


def file_meta(files):
    """{file: {thumb, author, license, url, nonfree, year}} via en.wikipedia (proxies Commons), 500px thumbs."""
    out = {}
    for group in F.chunks(list(dict.fromkeys(files)), 40):
        d = F.api(W.ENWIKI, action='query', titles='|'.join('File:' + f for f in group), prop='imageinfo',
                  iiprop='url|extmetadata', iiurlwidth='500')
        for pg in d.get('query', {}).get('pages', []):
            ii = (pg.get('imageinfo') or [None])[0]
            if not ii:
                continue
            md = ii.get('extmetadata') or {}
            g = lambda k: (md.get(k) or {}).get('value', '')
            y = YEAR.search(F.clean(g('DateTimeOriginal')) or '') or YEAR.search(F.clean(g('DateTime')) or '')
            rec = {'thumb': ii.get('thumburl') or ii.get('url'), 'author': F.clean(g('Artist')) or F.clean(g('Credit')) or 'Unknown',
                   'license': F.clean(g('LicenseShortName')) or F.clean(g('License')), 'nonfree': g('NonFree').lower() == 'true',
                   'url': ii.get('descriptionurl') or '', 'year': int(y.group(1)) if y else None,
                   'dated': bool(YEAR.search(F.clean(g('DateTimeOriginal')) or ''))}
            fn = pg['title'][5:]
            out[fn] = out[fn.replace(' ', '_')] = rec
    return out


def resolve(names):
    """{key: (article title, description, lead image)} with the same suffix passes as fetch_photos_wp."""
    found = {}
    for suf in ['', ' (footballer)', ' (football manager)', ' (Brazilian footballer)', ' (Argentine footballer)']:
        left = {k: n for k, n in names.items() if k not in found}
        if not left:
            break
        res = W.lookup([n + suf for n in left.values()])
        for k, n in left.items():
            r = res.get(n + suf)
            if r and r[2] and W.FOOTY.search(r[1] or ''):
                found[k] = r
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='')
    ap.add_argument('--no-download', action='store_true', help='only use cached raw images, or the v1 crops in tools/.photo_v1 (fast)')
    a = ap.parse_args()
    people = json.loads(subprocess.run(['node', os.path.join(F.ROOT, 'tools', 'list_real_people.mjs')], check=True,
                                       capture_output=True, text=True, cwd=F.ROOT).stdout)
    active = set(json.loads(subprocess.run(['node', '-e', "import('./3d/js/meta/core/players.js').then(({getDB})=>{const s=new Set();for(const p of getDB().all) if(p.real&&p.club!=='ICN'&&!p.id.startsWith('pr_')) s.add(p.person||p.baseId||p.id);console.log(JSON.stringify([...s]))})"],
                                           check=True, capture_output=True, text=True, cwd=F.ROOT).stdout))
    if a.only:
        keep = set(a.only.split(','))
        people = [p for p in people if p['person'] in keep]
    if a.limit:
        people = people[:a.limit]
    names = {p['person']: F.ALIASES.get(p['person']) or F.ALIASES.get(p['name']) or p['name'] for p in people}
    found = resolve(names)
    meta = file_meta([f for _, _, f in found.values()])
    os.makedirs(RAW, exist_ok=True); os.makedirs(DYN_DIR, exist_ok=True)
    credits_path = os.path.join(F.PLAYER_DIR, 'credits.json')
    credits = {}
    why = {}
    from PIL import Image
    for i, p in enumerate(people):
        k = p['person']
        if k not in found:
            why[k] = 'no article / free lead image'; continue
        title, desc, fn = found[k]
        m = meta.get(fn) or meta.get(fn.replace('_', ' '))
        if not m or m['nonfree'] or not F.licence_ok(m['license']) or not m['thumb']:
            why[k] = 'licence'; continue
        bm = BORN.search(desc or '')
        born = int(next(g for g in bm.groups() if g)) if bm else None
        retired = k not in active
        if born and m['year'] and m['dated']:
            age = m['year'] - born
            if age < 17 or age > (36 if retired else 42):
                why[k] = f'wrong era (age {age} in photo)'; continue
        elif retired:
            why[k] = 'retired, undated photo'; continue
        raw = os.path.join(RAW, k + '.jpg')
        v1 = os.path.join(F.ROOT, 'tools', '.photo_v1', k + '.webp')
        if not os.path.exists(raw) and a.no_download:
            if not os.path.exists(v1):
                why[k] = 'not downloaded yet'; continue
            raw = v1
        if not os.path.exists(raw):
            data = F._fetch(m['thumb'], binary=True)
            if not data:
                why[k] = 'download'; continue
            open(raw, 'wb').write(data)
        try:
            img = Image.open(raw); img.load()
            face = face_box(img)
            if face is None:
                why[k] = 'no face found'; continue
            cut = cutout(img)
            base = crop_around(cut, face, 2.7, 0.2, 240, 300)
            dyn = crop_around(cut, face, 3.7, 0.09, 300, 375)
        except Exception as e:  # noqa: BLE001
            why[k] = f'error {e}'; continue
        open(os.path.join(F.PLAYER_DIR, k + '.webp'), 'wb').write(webp(base))
        open(os.path.join(DYN_DIR, k + '.webp'), 'wb').write(webp(dyn, 34 * 1024))
        credits[k] = {'name': p['name'], 'file': k + '.webp', 'author': m['author'], 'license': m['license'], 'url': m['url'], 'article': title}
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(people)} processed, {len(credits)} photos', file=sys.stderr)
    if not a.only and not a.limit:
        # drop v1 photos that did not pass v2 (wrong era, no face...) so no bad photo stays in the game
        for fn in os.listdir(F.PLAYER_DIR):
            if fn.endswith('.webp') and fn[:-5] not in credits:
                os.remove(os.path.join(F.PLAYER_DIR, fn))
        F.save_json(credits_path, credits)
        F.write_photos_js(credits)
        F.save_json(F.MISSES, {'players': why})
    print(f'done: {len(credits)} photos, {len(why)} without', file=sys.stderr)
    from collections import Counter
    print(Counter(v.split(' (')[0] for v in why.values()), file=sys.stderr)


if __name__ == '__main__':
    main()
