#!/usr/bin/env python3
"""Real promo cards (data/promo_cards/*.json) -> 3d/js/meta/core/realpromos.js (GENERATED).

Keeps only the promo cards whose base player is in the game database (matched by name + nation to the real BASE cards that
tools/list_base_cards.mjs prints) and rated 75+. No image_url is kept (those hotlink fut.gg): at runtime the card shows its base
player's local photo or the SVG avatar. Each promo family is mapped to an existing campaign id (core/promos.js PROMOS) so release
weeks, promo packs and pools just work. Run:  python3 tools/build_real_promos.py [--games 27 26]
"""
import argparse, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_futgg_players import NATION, POS, fold, key  # noqa: E402
from futgg_common import ROOT  # noqa: E402

OUT = os.path.join(ROOT, '3d', 'js', 'meta', 'core', 'realpromos.js')
REPORT = os.path.join(ROOT, 'tools', 'real_promos_report.json')
YEAR = {'FC27': 27, 'FC26': 26, 'FC25': 25, 'FC24': 24}
MIN_OVR = 75

# family name (lower case, first matching rule wins) -> existing campaign id (core/promos.js)
RULES = [
    ('team of the year', 'toty'), ('toty', 'toty'), ('team of the season', 'tots'), ('tots', 'tots'), ('futties', 'fiesta'),
    ('birthday', 'birthday'), ('future stars', 'futurestars'), ('fantasy', 'fantasy'), ('winter wildcards', 'frost'),
    ('scream', 'fright'), ('fright', 'fright'), ('thunderstruck', 'storm'), ('showdown', 'showdown'),
    ('road to the knockouts', 'rttk'), ('knockout royalty', 'rttk'), ('dreamchasers', 'rttk'), ('road to the final', 'rttf'),
    ('trophy titans', 'titans'), ('shapeshifter', 'shapeshifters'), ('flashback', 'flashback'), ('time warp', 'flashback'),
    ('centurions', 'centurions'), ('national pride', 'cupplayer'), ('path to glory', 'gloryroad'), ('phenoms', 'phenoms'),
    ('greats of the game', 'cupicon'), ('festival of football', 'cupstar'), ('ones to watch', 'oty'), ('player of the month', 'potm'),
    ('end of an era', 'finalchapter'), ('ultimate succession', 'finalchapter'), ('hero', 'halo'), ('primetime', 'champions'),
    ('champions', 'champions'), ('ratings reload', 'levelup'), ('star performer', 'levelup'), ('world tour', 'ballers'), ('joga bonito', 'ballers'),
]
DEFAULT = 'moments'


def campaign_of(promo):
    low = promo.lower()
    for k, c in RULES:
        if k in low:
            return c
    return DEFAULT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--games', nargs='*', default=['27', '26'])
    a = ap.parse_args()
    bases = json.loads(subprocess.run(['node', os.path.join(ROOT, 'tools', 'list_base_cards.mjs')], check=True, capture_output=True, text=True, cwd=ROOT).stdout)
    for b in bases:
        b['hn'] = fold(b['name']); b['hk'] = ''.join(b['hn']); b['ck'] = key(b['card'])
    by_nat = {}
    for b in bases:
        by_nat.setdefault(b['nat'], []).append(b)
    fams, fam_idx, rows, seen = [], {}, [], set()
    rep = {'matched': 0, 'noBase': 0, 'ambiguous': 0, 'lowOvr': 0, 'noNation': {}, 'perFamily': {}}
    for g in a.games:
        for c in json.load(open(os.path.join(ROOT, 'data', 'promo_cards', f'fc{g}.json'))):
            if c['ea_id'] in seen or c['ovr'] < MIN_OVR:
                rep['lowOvr'] += c['ovr'] < MIN_OVR
                continue
            seen.add(c['ea_id'])
            nat = NATION.get(c['nation'])
            if not nat:
                rep['noNation'][c['nation']] = rep['noNation'].get(c['nation'], 0) + 1
                continue
            icon = c.get('club') == 'ICON' or c.get('league') == 'Icons' or 'ICON' in c['promo']
            full, short = fold(c['name']), fold(c['card_name'])
            toks = set(full) | set(short)
            fk, sk = ''.join(full), ''.join(short)
            gk = c['pos'] == 'GK'
            scored = []
            for b in by_nat.get(nat, []):
                if (b['pos'] == 'GK') != gk or (b['kind'] == 'icon') != icon and not (('hero' in c['promo'].lower()) and b['kind'] == 'icon'):
                    continue
                if b['hk'] in (fk, sk):
                    s = 100
                elif len(b['hn']) >= 2 and set(b['hn']) <= toks:
                    s = 80
                elif len(b['hn']) == 1 and b['ck'] == sk:
                    s = 60 if abs(b['ovr'] - c['ovr']) <= 20 else 0
                elif b['ck'] == sk and len(short) >= 2:
                    s = 70
                else:
                    s = 0
                if s:
                    scored.append((s - (0 if (b['kind'] == 'icon') == icon else 15), b))
            if not scored:
                rep['noBase'] += 1
                continue
            scored.sort(key=lambda x: -x[0])
            top = [b for s, b in scored if s == scored[0][0]]
            if len({b['person'] for b in top}) > 1:
                rep['ambiguous'] += 1
                continue
            base = top[0]
            fam = f"{c['promo']}"
            if fam not in fam_idx:
                fam_idx[fam] = len(fams)
                fams.append([fam, campaign_of(fam)])
            st = c['stats']
            face = [st['div'], st['han'], st['kic'], st['ref'], st['spd'], st['pos']] if gk else [st['pac'], st['sho'], st['pas'], st['dri'], st['def'], st['phy']]
            if not all(1 <= v <= 99 for v in face):
                continue
            alt = [x for x in (c.get('alt_pos') or []) if x in POS.values() and x != c['pos']][:4]
            rows.append([c['ea_id'], YEAR['FC' + g], fam_idx[fam], base['id'], c['ovr'], c['pos'], alt, face, c.get('skill_moves') or 2, c.get('weak_foot') or 3,
                         c.get('club') or '', c.get('league') or ''])
            rep['matched'] += 1
            rep['perFamily'][fam] = rep['perFamily'].get(fam, 0) + 1
    rows.sort(key=lambda r: (-r[1], r[2], -r[4], r[0]))
    head = """// GENERATED by tools/build_real_promos.py from data/promo_cards/*.json -- do not edit by hand.
// Real promo cards (FC 27 / FC 26) whose base player is in the database, rated 75+. NO image urls: a card shows its base player's local
// photo (or the SVG avatar). core/realpromobuild.js turns every row into a card (id rc<yy>_<eaId>) appended at the very END of the database.
// Family: [real promo name, campaign id in core/promos.js (release week, pack pool, card design)]
// Row: [promo card eaId, game 27|26, family index, base card id, overall, pos, alt positions, six face stats (GK: div han kic ref spd pos),
//       skill moves, weak foot, real club, real league]
"""
    body = 'export const REAL_PROMO_FAMILIES = ' + json.dumps(fams, ensure_ascii=False, separators=(',', ':')) + ';\nexport const REAL_PROMO_ROWS = [\n' + \
        ',\n'.join('  ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + '\n];\n'
    open(OUT, 'w', encoding='utf-8').write(head + body)
    json.dump({**rep, 'rows': len(rows), 'families': len(fams)}, open(REPORT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(len(rows), 'rows', len(fams), 'families', {k: v for k, v in rep.items() if k != 'perFamily'}, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
