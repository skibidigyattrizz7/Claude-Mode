#!/usr/bin/env python3
"""Real EA SPORTS FC card data from FUT.GG -> 3d/js/meta/core/futplayers.js (GENERATED).

Owner (Sep 30): use fut.gg only (Futbin blocks this server), FC 27 if it exists else FC 26, non-commercial fan game.
What it collects (all through fut.gg's own JSON API, the same one its website calls; cached on disk, <= ~2 requests/s):
  * the top ~1500 BASE cards (gold/silver, men) of the current game by rating, one entry per real person,
  * every retired ICON card (rarity "Base Icon"),
  * for every hand-written real player the game already has (ids ic_ / rs_ / rp_) that is not in those two sets: a name search,
    so the card takes its real FC data too (Hero / Icon / base card, whichever exists).
Per card it keeps: rating, six face stats (GK: diving handling kicking reflexes speed positioning), positions, nation, league,
club, skill moves, weak foot, preferred foot, height, weight, date of birth, PlayStyles (+ = PlayStyle+).

  python3 tools/fetch_futgg_players.py [--top 1500] [--game 27] [--asof YYYY-MM-DD] [--refresh] [--no-existing]

Writes  3d/js/meta/core/futplayers.js  (compact rows, see the header there)
        tools/futgg_people.json         (person slug, name, fut.gg path: read by `tools/photos_futgg.py --extra tools/futgg_people.json`)
        tools/futgg_report.json         (what could not be mapped / matched)
Person slugs are STABLE: an existing game person keeps its slug (so saved ids like rs_messi keep resolving); a new person's slug
is remembered from the previous futplayers.js, so re-running never renames a card id.
"""
import argparse, datetime, json, os, re, subprocess, sys, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from futgg_common import Client, ROOT  # noqa: E402

OUT_JS = os.path.join(ROOT, '3d', 'js', 'meta', 'core', 'futplayers.js')
OUT_PEOPLE = os.path.join(ROOT, 'tools', 'futgg_people.json')
OUT_REPORT = os.path.join(ROOT, 'tools', 'futgg_report.json')
BASE_RARITY = 0      # fut.gg "Rare"/base gold+silver card (there is no separate common card in the API)
ICON_RARITY = 12     # "Base Icon"

# ---- EA ids -> game values -------------------------------------------------------------------------------------------
POS = {0: 'GK', 2: 'RWB', 3: 'RB', 5: 'CB', 7: 'LB', 8: 'LWB', 10: 'CDM', 12: 'RM', 14: 'CM', 16: 'LM', 18: 'CAM',
       21: 'CF', 23: 'RW', 25: 'ST', 27: 'LW'}
# EA PlayStyle id -> the game's PlayStyle id (core/physique.js PLAYSTYLES). Far Throw (28) has no game equivalent.
PLAYSTYLE = {0: 'finesse', 1: 'chip', 2: 'power', 3: 'deadball', 5: 'incisive', 6: 'pinged', 7: 'longball', 8: 'tikitaka',
             9: 'whipped', 10: 'jockey', 11: 'block', 12: 'intercept', 13: 'anticipate', 14: 'slidetackle', 15: 'bruiser',
             16: 'technical', 17: 'rapid', 19: 'firsttouch', 20: 'trickster', 21: 'pressproven', 22: 'quickstep',
             23: 'relentless', 25: 'acrobatic', 26: 'longthrow', 29: 'footwork', 30: 'crossclaimer', 31: 'rushout',
             32: 'farreach', 33: 'deflector', 34: 'lowdriven', 35: 'aerial', 36: 'enforcer', 37: 'gamechanger',
             38: 'inventive', 39: 'powerheader'}
# fut.gg nation name -> game nation code (core/data.js; the new ones are card-only nations there)
NATION = {
    'England': 'ENG', 'France': 'FRA', 'Germany': 'GER', 'Spain': 'ESP', 'Italy': 'ITA', 'Portugal': 'POR', 'Netherlands': 'NED',
    'Belgium': 'BEL', 'Argentina': 'ARG', 'Brazil': 'BRA', 'Uruguay': 'URU', 'Croatia': 'CRO', 'Mexico': 'MEX',
    'United States': 'USA', 'Japan': 'JPN', 'Korea Republic': 'KOR', 'Nigeria': 'NGA', 'Senegal': 'SEN', 'Morocco': 'MAR',
    'Ghana': 'GHA', 'Cameroon': 'CMR', 'Egypt': 'EGY', 'Sweden': 'SWE', 'Denmark': 'DEN', 'Norway': 'NOR', 'Poland': 'POL',
    'Switzerland': 'SUI', 'Austria': 'AUT', 'Colombia': 'COL', 'Chile': 'CHI', 'Scotland': 'SCO', 'Republic of Ireland': 'IRL',
    'Wales': 'WAL', 'Türkiye': 'TUR', 'Turkey': 'TUR', 'Serbia': 'SRB', "Côte d'Ivoire": 'CIV', 'Ecuador': 'ECU', 'Canada': 'CAN',
    'Australia': 'AUS', 'Ukraine': 'UKR', 'Greece': 'GRE', 'Czechia': 'CZE', 'Czech Republic': 'CZE', 'Hungary': 'HUN',
    'Peru': 'PER', 'Romania': 'ROU', 'Bulgaria': 'BUL', 'Iran': 'IRN', 'Russia': 'RUS', 'Northern Ireland': 'NIR',
    'Georgia': 'GEO', 'Slovenia': 'SVN', 'India': 'IND', 'Philippines': 'PHI', 'Kenya': 'KEN', 'Palestine': 'PLE',
    'Israel': 'ISR', 'Ivory Coast': 'CIV', 'Bosnia Herzegovina': 'BIH', 'Luxemburg': 'LUX', 'FYR Macedonia': 'MKD',
    'Trinidad & Tobago': 'TRI', 'Guinea Bissau': 'GNB', 'CAR': 'CTA', 'Korea Republic': 'KOR', 'China': 'CHN',
    # card-only nations added by this update (core/data.js CARD_NATIONS)
    'Algeria': 'ALG', 'Tunisia': 'TUN', 'Mali': 'MLI', 'Burkina Faso': 'BFA', 'Guinea': 'GUI', 'DR Congo': 'COD', 'Congo DR': 'COD',
    'Gabon': 'GAB', 'Iceland': 'ICE', 'Slovakia': 'SVK', 'Bosnia and Herzegovina': 'BIH', 'Albania': 'ALB',
    'North Macedonia': 'MKD', 'Montenegro': 'MNE', 'Kosovo': 'KVX', 'Armenia': 'ARM', 'Azerbaijan': 'AZE', 'Kazakhstan': 'KAZ',
    'Costa Rica': 'CRC', 'Paraguay': 'PAR', 'Venezuela': 'VEN', 'Bolivia': 'BOL', 'Finland': 'FIN', 'Jamaica': 'JAM',
    'Panama': 'PAN', 'Honduras': 'HON', 'Haiti': 'HAI', 'Curaçao': 'CUW', 'Suriname': 'SUR', 'Trinidad and Tobago': 'TRI',
    'South Africa': 'RSA', 'Zambia': 'ZAM', 'Zimbabwe': 'ZIM', 'Angola': 'ANG', 'Mozambique': 'MOZ', 'Benin': 'BEN', 'Togo': 'TOG',
    'Cape Verde': 'CPV', 'Cape Verde Islands': 'CPV', 'Gambia': 'GAM', 'Guinea-Bissau': 'GNB', 'Sierra Leone': 'SLE',
    'Liberia': 'LBR', 'Equatorial Guinea': 'EQG', 'Central African Republic': 'CTA', 'Congo': 'CGO', 'Uganda': 'UGA',
    'Tanzania': 'TAN', 'Ethiopia': 'ETH', 'Sudan': 'SDN', 'Libya': 'LBY', 'Comoros': 'COM', 'Madagascar': 'MAD', 'Namibia': 'NAM',
    'Saudi Arabia': 'KSA', 'Iraq': 'IRQ', 'Syria': 'SYR', 'Jordan': 'JOR', 'Lebanon': 'LBN', 'United Arab Emirates': 'UAE',
    'Qatar': 'QAT', 'Oman': 'OMA', 'Uzbekistan': 'UZB', 'China PR': 'CHN', 'Thailand': 'THA', 'Indonesia': 'IDN', 'Vietnam': 'VIE',
    'New Zealand': 'NZL', 'Luxembourg': 'LUX', 'Cyprus': 'CYP', 'Malta': 'MLT', 'Latvia': 'LVA', 'Lithuania': 'LTU', 'Estonia': 'EST',
    'Moldova': 'MDA', 'Belarus': 'BLR', 'Faroe Islands': 'FRO', 'Andorra': 'AND', 'Liechtenstein': 'LIE', 'San Marino': 'SMR',
    'Gibraltar': 'GIB', 'Guyana': 'GUY', 'Cuba': 'CUB', 'Dominican Republic': 'DOM', 'El Salvador': 'SLV', 'Guatemala': 'GUA',
    'Nicaragua': 'NCA', 'Grenada': 'GRN', 'Antigua and Barbuda': 'ATG', 'Saint Kitts and Nevis': 'SKN', 'Bermuda': 'BER',
    'Burundi': 'BDI', 'Rwanda': 'RWA', 'Malawi': 'MWI', 'Niger': 'NIG', 'Mauritania': 'MTN', 'Chad': 'CHA', 'Eswatini': 'SWZ',
    'South Sudan': 'SSD', 'Lesotho': 'LES', 'Botswana': 'BOT', 'Seychelles': 'SEY', 'Mauritius': 'MRI', 'Djibouti': 'DJI',
    'São Tomé and Príncipe': 'STP', 'Eritrea': 'ERI', 'Somalia': 'SOM', 'Bahrain': 'BHR', 'Kuwait': 'KUW', 'Yemen': 'YEM',
    'Afghanistan': 'AFG', 'Pakistan': 'PAK', 'Bangladesh': 'BAN', 'Sri Lanka': 'SRI', 'Nepal': 'NEP', 'Myanmar': 'MYA',
    'Malaysia': 'MAS', 'Singapore': 'SGP', 'Hong Kong': 'HKG', 'Chinese Taipei': 'TPE', 'Korea DPR': 'PRK', 'Mongolia': 'MGL',
    'Tajikistan': 'TJK', 'Kyrgyzstan': 'KGZ', 'Turkmenistan': 'TKM', 'Papua New Guinea': 'PNG',
    'New Caledonia': 'NCL', 'Fiji': 'FIJ', 'Tahiti': 'TAH', 'Puerto Rico': 'PUR', 'Belize': 'BLZ', 'Saint Lucia': 'LCA',
    'Montserrat': 'MSR', 'Bahamas': 'BAH', 'Barbados': 'BRB', 'Guam': 'GUM', 'Aruba': 'ARU', 'Martinique': 'MTQ',
    'Guadeloupe': 'GLP', 'Réunion': 'REU', 'French Guiana': 'GUF', 'Zanzibar': 'ZAN',
}
# fut.gg league name -> the game's league id (core/data.js LEAGUES); anything else is the "Rest of World" league CON
LEAGUE = {
    'Premier League': 'ISL', 'EFL Championship': 'ISL', 'EFL League One': 'ISL', 'EFL League Two': 'ISL',
    'LALIGA EA SPORTS': 'SOL', 'LaLiga': 'SOL', 'LALIGA HYPERMOTION': 'SOL', 'LaLiga 2': 'SOL',
    'Bundesliga': 'MEI', '2. Bundesliga': 'MEI', '3. Liga': 'MEI',
    'Serie A Enilive': 'AUR', 'Serie A': 'AUR', 'Serie BKT': 'AUR', 'Serie B': 'AUR',
    'Ligue 1 McDonald\'s': 'ETO', 'Ligue 1': 'ETO', 'Ligue 2 BKT': 'ETO', 'Ligue 2': 'ETO',
}
LEAGUE_PREFIX = (('premier league', 'ISL'), ('efl ', 'ISL'), ('laliga', 'SOL'), ('bundesliga', 'MEI'), ('2. bundesliga', 'MEI'),
                 ('serie a', 'AUR'), ('serie b', 'AUR'), ('ligue 1', 'ETO'), ('ligue 2', 'ETO'))


def game_league(name, is_icon=False):
    if is_icon:
        return 'ICN'
    if name in LEAGUE:
        return LEAGUE[name]
    low = (name or '').lower()
    for pre, lg in LEAGUE_PREFIX:
        if low.startswith(pre):
            return lg
    return 'CON'


# ---- names -----------------------------------------------------------------------------------------------------------
def fold(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]', ' ', s.replace("'", '').replace('-', ' ')).split()


def key(s):
    return ''.join(fold(s))


def parse_styles(defn):
    """[(game id, plus)] from a fut.gg definition/list item; PlayStyle+ first."""
    plus = [PLAYSTYLE.get(i) for i in (defn.get('playstylesPlus') or defn.get('playStylePlusEaIds') or [])]
    reg = [PLAYSTYLE.get(i) for i in (defn.get('playstyles') or defn.get('playStyleEaIds') or [])]
    out, seen = [], set()
    for sid, pl in [(s, True) for s in plus] + [(s, False) for s in reg]:
        if sid and sid not in seen:
            seen.add(sid)
            out.append((sid, pl))
    return out


def age_on(dob, asof):
    b = datetime.date.fromisoformat(dob[:10])
    return asof.year - b.year - ((asof.month, asof.day) < (b.month, b.day))


def face_of(d, is_gk):
    if is_gk:
        return [d.get('gkFaceDiving') or 0, d.get('gkFaceHandling') or 0, d.get('gkFaceKicking') or 0,
                d.get('gkFaceReflexes') or 0, d.get('gkFaceSpeed') or 0, d.get('gkFacePositioning') or 0]
    return [d.get('facePace') or 0, d.get('faceShooting') or 0, d.get('facePassing') or 0,
            d.get('faceDribbling') or 0, d.get('faceDefending') or 0, d.get('facePhysicality') or 0]


def parse_card(defn, item, asof, kind, game='27'):
    """One fut.gg card -> a plain dict of everything the game needs (or None when the card is unusable).

    `defn` is the definition (weight, dob, ...), `item` the search-result entry (cardName, nickname, ...) or None."""
    item = item or {}
    pos = POS.get(defn.get('position'))
    if not pos:
        return None
    is_gk = pos == 'GK'
    face = face_of(defn, is_gk)
    if not all(1 <= v <= 99 for v in face):
        return None  # incomplete face stats
    nat = (defn.get('nation') or {}).get('name') or ''
    league = (defn.get('league') or {}).get('name') or ''
    club = (defn.get('club') or defn.get('uniqueClub') or {}).get('name') or ''
    first, last = defn.get('firstName') or '', defn.get('lastName') or ''
    common = defn.get('commonName') or item.get('commonName') or (first + ' ' + last).strip()
    card = item.get('cardName') or defn.get('nickname') or last or common
    dob = (defn.get('dateOfBirth') or '')[:10]
    alt = []
    for i in defn.get('alternativePositionIds') or []:
        a = POS.get(i)
        if a and a != pos and a not in alt:
            alt.append(a)
    return {
        'eaId': defn['eaId'], 'base': defn.get('basePlayerEaId') or defn['eaId'], 'kind': kind, 'game': str(game),
        'name': common, 'card': card, 'first': first, 'last': last, 'nick': defn.get('nickname') or item.get('nickname') or '',
        'natName': nat, 'nat': NATION.get(nat), 'pos': pos, 'alt': alt[:4],
        'foot': 'L' if defn.get('foot') == 2 else 'R', 'wf': defn.get('weakFoot') or 3, 'sm': defn.get('skillMoves') or 2,
        'ovr': defn['overall'], 'face': face, 'dob': dob, 'age': age_on(dob, asof) if dob else 0,
        'height': defn.get('height') or 0, 'weight': defn.get('weight') or 0,
        'league': league, 'lg': game_league(league, kind == 'i'), 'club': club if kind != 'i' else '',
        'styles': parse_styles(defn), 'gradingScore': defn.get('gradingScore') or item.get('gradingScore') or 0,
        'path': '/players/%s/' % (defn.get('basePlayerSlug') or ''), 'rarity': (defn.get('rarity') or {}).get('name') or item.get('rarityName') or '',
    }


# ---- collection ------------------------------------------------------------------------------------------------------
def all_pages(client, game, **params):
    """Every page of a search (deduped by item eaId; warns when fut.gg's paging drops or repeats a card)."""
    out, page, total, seen = [], 1, None, set()
    while True:
        d = client.search(game, page=page, count=100, **params)
        if not d:
            break
        total = d['total']
        for it in d['data']:
            if it['eaId'] not in seen:
                seen.add(it['eaId'])
                out.append(it)
        if not d.get('next'):
            break
        page = d['next']
    if total is not None and len(out) != total:
        print(f'  warning: {params}: got {len(out)} unique of {total}', file=sys.stderr)
    return out


def collect_base(client, game, top):
    """Best `top` base cards (men), one per person."""
    picked, persons = [], set()
    for ovr in range(99, 55, -1):
        d = client.search(game, sorts='-grading_score', gender=1, rarity_id=BASE_RARITY, overall__gte=ovr, overall__lte=ovr, count=1, page=1)
        if not d or not d['total']:
            continue
        band = all_pages(client, game, sorts='-grading_score', gender=1, rarity_id=BASE_RARITY, overall__gte=ovr, overall__lte=ovr)
        band.sort(key=lambda it: (-it.get('gradingScore', 0), it['eaId']))
        for it in band:
            b = it.get('basePlayerEaId') or it['eaId']
            if b in persons or it.get('isHero') or it.get('isIcon'):
                continue
            persons.add(b)
            picked.append(it)
        print(f'  base {ovr}: {len(band)} cards, {len(picked)} people so far', file=sys.stderr, flush=True)
        if len(picked) >= top:
            break
    return picked[:top]


def collect_icons(client, game):
    items = all_pages(client, game, sorts='-grading_score', gender=1, rarity_id=ICON_RARITY)
    out, seen = [], set()
    for it in items:
        b = it.get('basePlayerEaId') or it['eaId']
        if b not in seen:
            seen.add(b)
            out.append(it)
    return out


def card_kind(it):
    """'b' base card | 'i' Icon | 'h' Hero | None (any special / promo card) for a search-result entry."""
    if it.get('rarityEaId') == ICON_RARITY or (it.get('isIcon') and it.get('rarityName') == 'Base Icon'):
        return 'i'
    if it.get('isHero') and (it.get('rarityName') or '').lower() == 'hero':
        return 'h'
    if not it.get('isSpecial') and not it.get('isIcon') and not it.get('isHero') and (it.get('rarityName') or '') in ('Rare', 'Common'):
        return 'b'
    return None


def _stub(it):
    """Just enough of a search-result entry for match_score (no definition needed)."""
    return {'name': it.get('commonName') or '', 'first': it.get('firstName') or '', 'last': it.get('lastName') or '',
            'nick': it.get('nickname') or '', 'card': it.get('cardName') or '', 'nat': NATION.get((it.get('nation') or {}).get('name')),
            'pos': it.get('position') or '', 'ovr': it.get('overall') or 0}


def search_existing(client, game, hand, asof):
    """Cards (base / Icon / Hero) fut.gg has for one hand-written player, found by name."""
    toks = fold(hand['name'])
    found = []
    # the full name first, then the surname, then the first name; stop at the first query that gives a usable card
    for q in dict.fromkeys([' '.join(toks), toks[-1] if toks else '', toks[0] if len(toks) > 1 and len(toks[0]) >= 5 else '']):
        if not q:
            continue
        d = client.search(game, name=q, gender=1, count=60, sorts='-overall', page=1)
        found = [(card_kind(it), it) for it in (d or {}).get('data', [])]
        found = [(k, it) for k, it in found if k]
        if any(match_score(hand, _stub(it)) >= 70 for _, it in found):
            break
    found = [(k, it) for k, it in found if match_score(hand, _stub(it)) >= 70]
    if not found:
        return []
    dd = definitions(client, game, [it['eaId'] for _, it in found])
    out = []
    for kind, it in found:
        if it['eaId'] in dd:
            c = parse_card(dd[it['eaId']], it, asof, kind, game)
            if c:
                out.append(c)
    return out


def definitions(client, game, eaids):
    res = {}
    ids = list(eaids)
    for i in range(0, len(ids), 25):
        for d in client.definitions(game, ids[i:i + 25]):
            res[d['eaId']] = d
    return res


# ---- matching against the hand-written players ------------------------------------------------------------------------
# hand-written players fut.gg knows under a different name (id -> names to try as if they were ours)
ALIASES = {'rp_vinicius': ['Vini Jr.'], 'rp_benwhite': ['Benjamin White']}


def match_score(hand, card):
    """Best score over the hand-written name and its aliases."""
    best = _match_score(hand, card)
    for alias in ALIASES.get(hand.get('id'), ()):
        best = max(best, _match_score({**hand, 'name': alias}, card))
    return best


def _match_score(hand, card):
    """How well a fut.gg card fits a hand-written person (0 = no match). hand: {name, card, nat, pos, ovr}."""
    if (hand.get('pos') == 'GK') != (card['pos'] == 'GK'):
        return 0
    hn = fold(hand['name'])
    hk = ''.join(hn)
    names = [card['name'], (card['first'] + ' ' + card['last']).strip(), card['nick']]
    ck = {key(c) for c in names if c}
    ctoks = set()
    for c in names:
        ctoks.update(fold(c))
    same_nat = card['nat'] == hand['nat']
    near = abs((hand.get('ovr') or card['ovr']) - card['ovr']) <= 10
    if hk in ck:
        score = 100  # the full name is identical
    elif len(hn) >= 2 and set(hn) <= ctoks and (set(fold(card['name'])) <= set(hn) or set(hn) <= set(fold(card['name']))):
        score = 70 + len(hn)  # our name's words are all in his full name ('Diego Maradona' / 'Diego Armando Maradona')
        # ... and his common name overlaps ours one way or the other ('David Silva' is NOT 'David López', whose full name has 'Silva')
    elif len(hn) >= 2 and len(fold(card['name'])) >= 2 and set(fold(card['name'])) <= set(hn):
        score = 65  # fut.gg's common name is a subset of ours ('Neymar Jr' / 'Neymar Jr.')
    elif len(hn) == 1 and hk in {key(card['card']), key(card['nick'])}:
        score = 60 if near else 0  # one-name players (Vitinha, Fred, Marquinhos): the rating must be close too
    else:
        return 0
    if not same_nat:
        return 60 if score >= 100 else 0  # players switch federations: only trust identical full names
    return score + 30


def match_existing(hands, cards):
    """{hand id -> card} : best card per hand-written player; ambiguous / weak matches are left out (reported)."""
    res, ambiguous = {}, []
    for h in hands:
        want = 'i' if h['kind'] == 'icon' else 'b'
        scored = []
        for c in cards:
            if h['kind'] == 'icon' and c['kind'] == 'b':
                continue  # a retired Icon is never a currently playing person's base card (two different Ahmed Hassans)
            s = match_score(h, c)
            if s < 70:
                continue
            # prefer the card kind this hand player is (icon vs base); the other kind only as a fallback
            pref = 0 if c['kind'] == want else (-15 if c['kind'] != 'h' else -25)
            pref -= 0 if c['game'] == PRIMARY[0] else 8  # the older game only when the newer has nothing
            scored.append((s + pref, -abs(h['ovr'] - c['ovr']), c))
        if not scored:
            continue
        scored.sort(key=lambda x: (-x[0], -x[1]))
        if len(scored) > 1 and scored[0][:2] == scored[1][:2] and scored[0][2]['base'] != scored[1][2]['base']:
            ambiguous.append((h['id'], [x[2]['name'] for x in scored[:3]]))
            continue
        res[h['id']] = scored[0][2]
    return res, ambiguous


PRIMARY = ['27']


# ---- output ----------------------------------------------------------------------------------------------------------
def style_str(styles):
    return ' '.join(s + ('+' if p else '') for s, p in styles)


def row_of(slug, c, is_new):
    return [slug, c['eaId'], c['kind'], 1 if is_new else 0, int(c['game']), c['name'], c['card'], c['nat'], c['pos'], c['alt'], c['foot'], c['wf'],
            c['sm'], c['ovr'], c['face'], c['dob'], c['age'], c['height'], c['weight'], c['lg'], c['club'], c['league'],
            style_str(c['styles'])]


HEADER = """// GENERATED by tools/fetch_futgg_players.py -- do not edit by hand (re-run the tool instead).
// Real EA SPORTS FC {game} card data from fut.gg (owner, Sep 30: non-commercial fan game; fut.gg only). Fetched {when}.
// {n} cards: {nb} base (top rated), {ni} Icon, {ne} matched to hand-written players outside those sets.
//
// Row: [person slug, fut.gg card eaId, kind ('b' base card | 'i' Icon | 'h' Hero), new (1 = becomes a new card, 0 = only updates a
//       hand-written player), game (27, or 26 for the few hand-written players FC 27 does not have), full name, card name,
//       nation, pos, alt positions, foot, weak foot, skill moves, overall,
//       face stats (outfield: pac sho pas dri def phy | GK: div han kic ref spd pos), date of birth, age on {asof}, height cm,
//       weight kg, game league (ISL SOL MEI AUR ETO CON | ICN), real club, real league, PlayStyles ('+' = PlayStyle+)]
"""


def write_js(rows, game, asof, when, counts):
    lines = [json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows]
    head = HEADER.format(game=game, when=when, asof=asof, n=len(rows), **counts)
    body = f"export const FUT_GAME = '{game}';\nexport const FUT_ASOF = '{asof}';\nexport const FUT_ROWS = [\n" + ',\n'.join('  ' + l for l in lines) + '\n];\n'
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write(head + body)


def read_previous_slugs():
    """eaId -> slug from the previous futplayers.js, so re-running never renames a card id."""
    out = {}
    if os.path.exists(OUT_JS):
        for line in open(OUT_JS, encoding='utf-8'):
            m = re.match(r'^  (\[.*\]),?$', line.rstrip('\n'))
            if m:
                try:
                    r = json.loads(m.group(1))
                    out[(r[1], r[2])] = r[0]
                except (ValueError, IndexError):
                    pass
    return out


def make_slug(c, taken):
    base = key(c['card']) or key(c['name']) or 'player'
    for cand in (base, key(c['name']), base + str(c['base'])):
        if cand and cand not in taken:
            return cand
    return f"p{c['base']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--top', type=int, default=1500)
    ap.add_argument('--game', default='27')
    ap.add_argument('--asof', default=datetime.date.today().isoformat())
    ap.add_argument('--refresh', action='store_true', help='ignore the on-disk cache')
    ap.add_argument('--fallback-game', default='26', help='older game searched for hand-written players the main game lacks (empty = none)')
    ap.add_argument('--no-existing', action='store_true', help='skip the name searches for hand-written players')
    a = ap.parse_args()
    PRIMARY[0] = a.game
    asof = datetime.date.fromisoformat(a.asof)
    client = Client(refresh=a.refresh)
    if not os.path.exists(OUT_JS):  # the game's modules import futplayers.js: a first run needs an empty stand-in to list the hand-written players
        with open(OUT_JS, 'w', encoding='utf-8') as f:
            f.write("export const FUT_GAME = '27';\nexport const FUT_ASOF = '';\nexport const FUT_ROWS = [];\n")
    hands = json.loads(subprocess.run(['node', os.path.join(ROOT, 'tools', 'list_hand_people.mjs')], check=True, capture_output=True, text=True, cwd=ROOT).stdout)
    print(f'{len(hands)} hand-written players', file=sys.stderr)

    print('top base cards ...', file=sys.stderr)
    base_items = collect_base(client, a.game, a.top)
    print('icons ...', file=sys.stderr)
    icon_items = collect_icons(client, a.game)
    ids = [it['eaId'] for it in base_items + icon_items]
    print(f'definitions for {len(ids)} cards ...', file=sys.stderr)
    defs = definitions(client, a.game, ids)
    cards, report = [], {'noDefinition': [], 'unmappedNations': {}, 'ambiguous': [], 'unmatchedHand': [], 'unusable': []}
    for kind, items in (('b', base_items), ('i', icon_items)):
        for it in items:
            d = defs.get(it['eaId'])
            if not d:
                report['noDefinition'].append(it.get('commonName'))
                continue
            c = parse_card(d, it, asof, kind, a.game)
            if not c:
                report['unusable'].append(it.get('commonName'))
                continue
            c['new'] = True
            cards.append(c)

    # hand-written players outside those sets: find their card by name
    matched, amb = match_existing(hands, cards)
    if not a.no_existing:
        # newest game first; the older game only for players the newer one does not have at all
        for game in [a.game] + ([a.fallback_game] if a.fallback_game and a.fallback_game != a.game else []):
            todo = [h for h in hands if h['id'] not in matched]
            print(f'{len(todo)} hand-written players still without a card: FC {game} name search ...', file=sys.stderr)
            have = {(c['eaId'], c['game']) for c in cards}
            for n, h in enumerate(todo):
                for c in search_existing(client, game, h, asof):
                    if (c['eaId'], c['game']) not in have:
                        have.add((c['eaId'], c['game']))
                        c['new'] = False
                        cards.append(c)
                if (n + 1) % 100 == 0:
                    print(f'  {n + 1}/{len(todo)}', file=sys.stderr, flush=True)
            matched, amb = match_existing(hands, cards)
    report['ambiguous'] = amb
    report['unmatchedHand'] = [h['id'] for h in hands if h['id'] not in matched]

    uniq = {}  # the same card can turn up in both games (same EA id): keep the newer game's
    for c in cards:
        k = (c['eaId'], c['kind'])
        if k not in uniq or (c['game'] == a.game and uniq[k]['game'] != a.game):
            uniq[k] = c
    cards = list(uniq.values())

    # person slugs: a matched card takes the hand-written person's slug; the others keep their previous slug or get a new one
    prev = read_previous_slugs()
    hand_by_id = {h['id']: h for h in hands}
    hand_persons = {h['person'] for h in hands}
    taken = set(hand_persons)
    slug_of, consumed = {}, set()
    for hid, c in matched.items():
        h = hand_by_id[hid]
        slug_of.setdefault((c['eaId'], c['kind']), h['person'])
        if c['kind'] == ('i' if h['kind'] == 'icon' else 'b'):
            consumed.add((c['eaId'], c['kind']))  # this card only updates the hand-written player; it is not a new card
    person_by_name, kinds_of = {}, {}  # (name, nation) -> slug: a fut.gg person with both a base card and an Icon keeps ONE slug
    for k, sl in slug_of.items():
        kinds_of.setdefault(sl, set()).add(k[1])
    rows, people = [], {}
    for c in sorted(cards, key=lambda c: (-c['ovr'], c['base'], c['kind'])):
        k = (c['eaId'], c['kind'])
        if not c['new'] and k not in slug_of:
            continue  # a name-search result that matched nobody
        slug = slug_of.get(k)
        if not slug:
            for cand in (person_by_name.get((key(c['name']), c['nat'])), prev.get(k)):
                if cand and c['kind'] not in kinds_of.get(cand, ()) and cand not in hand_persons:
                    slug = cand
                    break
        if not slug:
            slug = make_slug(c, taken)
        taken.add(slug)
        kinds_of.setdefault(slug, set()).add(c['kind'])
        person_by_name.setdefault((key(c['name']), c['nat']), slug)
        c['slug'] = slug
        if not c['nat']:
            report['unmappedNations'][c['natName']] = report['unmappedNations'].get(c['natName'], 0) + 1
            continue
        rows.append(row_of(slug, c, bool(c['new']) and k not in consumed))
        if slug not in people or (c['kind'] == 'b' and people[slug]['kind'] != 'b'):
            people[slug] = {'person': slug, 'name': c['name'], 'eaId': c['base'], 'kind': c['kind'], 'path': c['path'], 'nat': c['nat']}
    counts = {'nb': sum(r[2] == 'b' and r[3] == 1 for r in rows), 'ni': sum(r[2] == 'i' and r[3] == 1 for r in rows), 'ne': sum(r[3] == 0 for r in rows)}
    write_js(rows, a.game, a.asof, datetime.date.today().isoformat(), counts)
    with open(OUT_PEOPLE, 'w', encoding='utf-8') as f:
        json.dump(sorted(people.values(), key=lambda p: p['person']), f, ensure_ascii=False, indent=0)
    report['counts'] = {'rows': len(rows), **counts, 'matchedHand': len(matched), 'hand': len(hands)}
    with open(OUT_REPORT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"done: {len(rows)} rows ({counts}), {len(matched)}/{len(hands)} hand-written players matched; "
          f"{client.requests} requests, {client.hits} cache hits; unmapped nations: {report['unmappedNations']}", file=sys.stderr)


if __name__ == '__main__':
    main()
