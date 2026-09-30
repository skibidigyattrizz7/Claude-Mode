"""Parser / matcher tests for tools/fetch_futgg_players.py (no network).  python3 -m unittest discover -s tools/tests"""
import datetime, os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import fetch_futgg_players as F  # noqa: E402

ASOF = datetime.date(2026, 9, 30)


def definition(**kw):
    d = {
        'eaId': 231747, 'basePlayerEaId': 231747, 'basePlayerSlug': '231747-kylian-mbappe', 'firstName': 'Kylian', 'lastName': 'Mbappé',
        'commonName': 'Kylian Mbappé', 'nickname': None, 'overall': 91, 'dateOfBirth': '1998-12-20', 'height': 182, 'weight': 81,
        'foot': 1, 'skillMoves': 5, 'weakFoot': 4, 'position': 25, 'alternativePositionIds': [27],
        'playstyles': [0, 25, 34, 37, 17, 19], 'playstylesPlus': [22],
        'facePace': 96, 'faceShooting': 91, 'facePassing': 80, 'faceDribbling': 92, 'faceDefending': 29, 'facePhysicality': 76,
        'nation': {'name': 'France'}, 'league': {'name': 'LALIGA EA SPORTS'}, 'club': {'name': 'Real Madrid'}, 'rarity': {'name': 'Rare'},
    }
    d.update(kw)
    return d


class ParseCard(unittest.TestCase):
    def test_outfield_card(self):
        c = F.parse_card(definition(), {'cardName': 'Mbappé'}, ASOF, 'b', '27')
        self.assertEqual((c['pos'], c['alt'], c['ovr'], c['face']), ('ST', ['LW'], 91, [96, 91, 80, 92, 29, 76]))
        self.assertEqual((c['foot'], c['wf'], c['sm'], c['height'], c['weight']), ('R', 4, 5, 182, 81))
        self.assertEqual((c['nat'], c['lg'], c['club'], c['league'], c['age']), ('FRA', 'SOL', 'Real Madrid', 'LALIGA EA SPORTS', 27))
        self.assertEqual(c['card'], 'Mbappé')

    def test_playstyles_plus_first_and_mapped(self):
        c = F.parse_card(definition(), None, ASOF, 'b')
        self.assertEqual(c['styles'][0], ('quickstep', True))
        self.assertEqual([s for s, _ in c['styles']], ['quickstep', 'finesse', 'acrobatic', 'lowdriven', 'gamechanger', 'rapid', 'firsttouch'])
        self.assertEqual(F.style_str(c['styles']).split()[0], 'quickstep+')

    def test_unknown_playstyle_ids_are_dropped(self):
        c = F.parse_card(definition(playstyles=[0, 28, 99], playstylesPlus=[]), None, ASOF, 'b')
        self.assertEqual(c['styles'], [('finesse', False)])  # 28 = Far Throw has no game equivalent

    def test_goalkeeper_uses_gk_stats_and_left_foot(self):
        d = definition(position=0, alternativePositionIds=[], foot=2, gkFaceDiving=88, gkFaceHandling=85, gkFaceKicking=80,
                       gkFaceReflexes=90, gkFaceSpeed=50, gkFacePositioning=87, playstyles=[32, 29], playstylesPlus=[])
        c = F.parse_card(d, None, ASOF, 'b')
        self.assertEqual((c['pos'], c['face'], c['foot']), ('GK', [88, 85, 80, 90, 50, 87], 'L'))
        self.assertEqual([s for s, _ in c['styles']], ['farreach', 'footwork'])

    def test_incomplete_or_unknown_position_is_skipped(self):
        self.assertIsNone(F.parse_card(definition(facePace=0), None, ASOF, 'b'))
        self.assertIsNone(F.parse_card(definition(position=1), None, ASOF, 'b'))

    def test_icons_have_no_club_and_the_icon_league(self):
        c = F.parse_card(definition(club={'name': 'ICON'}, league={'name': 'Icons'}), None, ASOF, 'i')
        self.assertEqual((c['lg'], c['club']), ('ICN', ''))

    def test_age(self):
        self.assertEqual(F.age_on('1987-06-24', datetime.date(2026, 6, 23)), 38)
        self.assertEqual(F.age_on('1987-06-24', datetime.date(2026, 6, 24)), 39)


class Mapping(unittest.TestCase):
    def test_leagues(self):
        self.assertEqual(F.game_league('Premier League'), 'ISL')
        self.assertEqual(F.game_league('EFL Championship'), 'ISL')
        self.assertEqual(F.game_league("Ligue 1 McDonald's"), 'ETO')
        self.assertEqual(F.game_league('Serie A Enilive'), 'AUR')
        self.assertEqual(F.game_league('ROSHN Saudi League'), 'CON')
        self.assertEqual(F.game_league('anything', is_icon=True), 'ICN')

    def test_nations(self):
        for name, code in (('France', 'FRA'), ('Ivory Coast', 'CIV'), ('Korea Republic', 'KOR'), ('Bosnia Herzegovina', 'BIH'), ('Algeria', 'ALG')):
            self.assertEqual(F.NATION[name], code)

    def test_every_nation_code_is_unique_per_country(self):
        codes = {}
        for name, code in F.NATION.items():
            codes.setdefault(code, set()).add(name)
        for code, names in codes.items():
            self.assertLessEqual(len(names), 3, (code, names))
        self.assertNotIn('ISL', codes, 'ISL is the Premier League id in the game: Iceland is ICE')


def card(name, nat='ARG', pos='CM', ovr=85, kind='b', first='', last='', nick='', card_name='', eaid=1, game='27'):
    return {'name': name, 'first': first, 'last': last, 'nick': nick, 'card': card_name or name, 'nat': nat, 'pos': pos, 'ovr': ovr,
            'kind': kind, 'eaId': eaid, 'base': eaid, 'game': game}


def hand(id_, name, nat='ARG', pos='CM', ovr=85, kind='regular'):
    return {'id': id_, 'name': name, 'card': name.split()[-1], 'nat': nat, 'pos': pos, 'ovr': ovr, 'kind': kind, 'person': id_[3:]}


class Matching(unittest.TestCase):
    def setUp(self):
        F.PRIMARY[0] = '27'

    def test_exact_and_full_name_subset(self):
        c = card('Diego Armando Maradona', first='Diego Armando', last='Maradona', kind='i', pos='CAM')
        m, _ = F.match_existing([hand('ic_maradona', 'Diego Maradona', pos='CAM', kind='icon')], [c])
        self.assertIs(m['ic_maradona'], c)

    def test_nickname_card(self):
        c = card('Ronaldo', nat='BRA', pos='ST', kind='i', first='Ronaldo Luís', last='Nazário de Lima', nick='Ronaldo')
        m, _ = F.match_existing([hand('ic_nazario', 'Ronaldo Nazário', nat='BRA', pos='ST', kind='icon')], [c])
        self.assertIn('ic_nazario', m)

    def test_a_different_person_with_a_name_in_common_is_not_matched(self):
        c = card('David López', nat='ESP', first='David', last='López Silva', ovr=74)
        m, _ = F.match_existing([hand('rp_davidsilva', 'David Silva', nat='ESP', pos='CAM', ovr=88)], [c])
        self.assertEqual(m, {})

    def test_goalkeeper_never_matches_an_outfielder(self):
        c = card('Marcos Leonardo', nat='BRA', pos='ST', first='Marcos', last='Leonardo')
        m, _ = F.match_existing([hand('rp_marcosgk', 'Marcos', nat='BRA', pos='GK', ovr=86)], [c])
        self.assertEqual(m, {})

    def test_retired_icon_never_takes_a_base_card(self):
        c = card('Ahmed Hassan', nat='EGY', pos='CM', ovr=72, first='Ahmed', last='Hassan')
        m, _ = F.match_existing([hand('ic_ahmedhassan', 'Ahmed Hassan', nat='EGY', kind='icon', ovr=87)], [c])
        self.assertEqual(m, {})

    def test_one_name_players_need_a_close_rating(self):
        far = card('Vitinha', nat='POR', card_name='Vitinha', ovr=70, eaid=1)
        near = card('Vitinha', nat='POR', card_name='Vitinha', ovr=88, eaid=2)
        m, amb = F.match_existing([hand('rp_vitinha', 'Vitinha', nat='POR', ovr=87)], [far, near])
        self.assertIs(m['rp_vitinha'], near)
        self.assertEqual(amb, [])

    def test_alias(self):
        c = card('Vini Jr.', nat='BRA', pos='LW', ovr=89)
        m, _ = F.match_existing([hand('rp_vinicius', 'Vinícius Júnior', nat='BRA', pos='LW', ovr=90)], [c])
        self.assertIs(m['rp_vinicius'], c)

    def test_newer_game_wins(self):
        a = card('Karim Benzema', nat='FRA', pos='ST', ovr=85, game='26', eaid=5)
        b = card('Karim Benzema', nat='FRA', pos='ST', ovr=84, game='27', eaid=6)
        m, _ = F.match_existing([hand('rs_benzema', 'Karim Benzema', nat='FRA', pos='ST')], [a, b])
        self.assertIs(m['rs_benzema'], b)


class Slugs(unittest.TestCase):
    def test_slug_prefers_card_name_then_full_name_then_id(self):
        c = {'card': 'Gabriel', 'name': 'Gabriel Magalhães', 'base': 7}
        self.assertEqual(F.make_slug(c, set()), 'gabriel')
        self.assertEqual(F.make_slug(c, {'gabriel'}), 'gabrielmagalhaes')
        self.assertEqual(F.make_slug(c, {'gabriel', 'gabrielmagalhaes'}), 'gabriel7')

    def test_fold(self):
        self.assertEqual(F.fold("N'Golo Kanté-Ünal"), ['ngolo', 'kante', 'unal'])


if __name__ == '__main__':
    unittest.main()
