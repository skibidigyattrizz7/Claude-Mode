// National teams, kits, fictional squads and formations (pure data + helpers).
import { makeRng, hashStr, colorDist, mixHex, clamp, luminance } from './util.js';

// [code, name, rating, homeKit, awayKit, nameStyle]
// kit = [shirt, secondary, shorts, socks, numberColour, pattern]
const RAW = [
  ['BRA', 'Brazil', 87, ['#FFDC02', '#1E9E4A', '#1B3A8C', '#FFFFFF', '#1E6B3A', 'plain'], ['#1E4FB5', '#FFDC02', '#FFFFFF', '#1E4FB5', '#FFFFFF', 'plain'], 'luso'],
  ['ARG', 'Argentina', 89, ['#8FC8EB', '#FFFFFF', '#111111', '#FFFFFF', '#111111', 'stripes'], ['#2A2350', '#8FC8EB', '#2A2350', '#2A2350', '#FFFFFF', 'plain'], 'hisp'],
  ['FRA', 'France', 88, ['#1C2957', '#E4222D', '#FFFFFF', '#E4222D', '#FFFFFF', 'plain'], ['#F4F4F4', '#1C2957', '#F4F4F4', '#F4F4F4', '#1C2957', 'plain'], 'fr'],
  ['ENG', 'England', 86, ['#FFFFFF', '#1B2C5C', '#1B2C5C', '#FFFFFF', '#1B2C5C', 'plain'], ['#C8102E', '#1B2C5C', '#C8102E', '#C8102E', '#FFFFFF', 'plain'], 'anglo'],
  ['ESP', 'Spain', 87, ['#C8102E', '#FFC72C', '#1B2A55', '#1B2A55', '#FFC72C', 'plain'], ['#EDE7D6', '#C8102E', '#EDE7D6', '#EDE7D6', '#C8102E', 'plain'], 'hisp'],
  ['GER', 'Germany', 85, ['#FFFFFF', '#111111', '#111111', '#FFFFFF', '#111111', 'plain'], ['#C2185B', '#6A1B9A', '#6A1B9A', '#C2185B', '#FFFFFF', 'plain'], 'germ'],
  ['POR', 'Portugal', 85, ['#C8102E', '#046A38', '#046A38', '#C8102E', '#F2C94C', 'plain'], ['#F4F4F4', '#046A38', '#F4F4F4', '#F4F4F4', '#C8102E', 'plain'], 'luso'],
  ['NED', 'Netherlands', 84, ['#F36C21', '#111111', '#F36C21', '#F36C21', '#111111', 'plain'], ['#1B3D7A', '#F36C21', '#1B3D7A', '#1B3D7A', '#F36C21', 'plain'], 'dutch'],
  ['ITA', 'Italy', 83, ['#0B5FB3', '#FFFFFF', '#FFFFFF', '#0B5FB3', '#FFFFFF', 'plain'], ['#FFFFFF', '#0B5FB3', '#FFFFFF', '#FFFFFF', '#0B5FB3', 'plain'], 'ital'],
  ['BEL', 'Belgium', 82, ['#D0021B', '#F5C518', '#D0021B', '#D0021B', '#F5C518', 'plain'], ['#E8F1FA', '#D0021B', '#E8F1FA', '#E8F1FA', '#D0021B', 'plain'], 'fr'],
  ['CRO', 'Croatia', 82, ['#FFFFFF', '#E1251B', '#FFFFFF', '#1A3FA8', '#1A3FA8', 'checks'], ['#16224D', '#E1251B', '#16224D', '#16224D', '#FFFFFF', 'plain'], 'slav'],
  ['URU', 'Uruguay', 80, ['#6CB4E4', '#FFFFFF', '#111111', '#111111', '#111111', 'plain'], ['#FFFFFF', '#6CB4E4', '#FFFFFF', '#FFFFFF', '#111111', 'plain'], 'hisp'],
  ['MAR', 'Morocco', 81, ['#C1272D', '#006233', '#006233', '#C1272D', '#FFFFFF', 'plain'], ['#FFFFFF', '#C1272D', '#FFFFFF', '#FFFFFF', '#C1272D', 'plain'], 'arab'],
  ['COL', 'Colombia', 79, ['#FCD116', '#003893', '#003893', '#FFFFFF', '#003893', 'plain'], ['#1F2A6B', '#FCD116', '#1F2A6B', '#1F2A6B', '#FFFFFF', 'plain'], 'hisp'],
  ['USA', 'USA', 78, ['#FFFFFF', '#0A3161', '#0A3161', '#FFFFFF', '#0A3161', 'plain'], ['#0A3161', '#B31942', '#0A3161', '#0A3161', '#FFFFFF', 'plain'], 'anglo'],
  ['MEX', 'Mexico', 77, ['#006847', '#FFFFFF', '#FFFFFF', '#006847', '#FFFFFF', 'plain'], ['#F2F2F2', '#9B1B30', '#9B1B30', '#F2F2F2', '#9B1B30', 'plain'], 'hisp'],
  ['JPN', 'Japan', 78, ['#0B2A7A', '#FFFFFF', '#0B2A7A', '#0B2A7A', '#FFFFFF', 'plain'], ['#FFFFFF', '#0B2A7A', '#FFFFFF', '#FFFFFF', '#0B2A7A', 'plain'], 'jp'],
  ['KOR', 'South Korea', 76, ['#D6202B', '#111111', '#111111', '#D6202B', '#FFFFFF', 'plain'], ['#FFFFFF', '#111111', '#FFFFFF', '#FFFFFF', '#D6202B', 'plain'], 'kr'],
  ['SEN', 'Senegal', 78, ['#FFFFFF', '#00853F', '#FFFFFF', '#FFFFFF', '#00853F', 'plain'], ['#00853F', '#FDEF42', '#00853F', '#00853F', '#FFFFFF', 'plain'], 'waf'],
  ['DEN', 'Denmark', 79, ['#C60C30', '#FFFFFF', '#FFFFFF', '#C60C30', '#FFFFFF', 'plain'], ['#FFFFFF', '#C60C30', '#FFFFFF', '#FFFFFF', '#C60C30', 'plain'], 'nord'],
  ['SUI', 'Switzerland', 78, ['#D52B1E', '#FFFFFF', '#D52B1E', '#D52B1E', '#FFFFFF', 'plain'], ['#FFFFFF', '#D52B1E', '#FFFFFF', '#FFFFFF', '#D52B1E', 'plain'], 'germ'],
  ['NGA', 'Nigeria', 76, ['#0A8A4A', '#FFFFFF', '#FFFFFF', '#0A8A4A', '#FFFFFF', 'plain'], ['#FFFFFF', '#0A8A4A', '#0A8A4A', '#FFFFFF', '#0A8A4A', 'plain'], 'waf'],
  ['SWE', 'Sweden', 76, ['#FECC00', '#006AA7', '#006AA7', '#FECC00', '#006AA7', 'plain'], ['#0B2D5B', '#FECC00', '#0B2D5B', '#0B2D5B', '#FECC00', 'plain'], 'nord'],
  ['POL', 'Poland', 75, ['#FFFFFF', '#DC143C', '#DC143C', '#FFFFFF', '#DC143C', 'plain'], ['#DC143C', '#FFFFFF', '#DC143C', '#DC143C', '#FFFFFF', 'plain'], 'slav'],
  ['CMR', 'Cameroon', 73, ['#007A5E', '#CE1126', '#CE1126', '#FCD116', '#FCD116', 'plain'], ['#FCD116', '#007A5E', '#FCD116', '#FCD116', '#007A5E', 'plain'], 'waf'],
  ['EGY', 'Egypt', 74, ['#C8102E', '#FFFFFF', '#FFFFFF', '#111111', '#FFFFFF', 'plain'], ['#FFFFFF', '#C8102E', '#FFFFFF', '#FFFFFF', '#C8102E', 'plain'], 'arab'],
  ['GHA', 'Ghana', 72, ['#FFFFFF', '#111111', '#FFFFFF', '#FFFFFF', '#111111', 'plain'], ['#CE1126', '#FCD116', '#CE1126', '#CE1126', '#FCD116', 'plain'], 'waf'],
  ['AUS', 'Australia', 72, ['#FFCD00', '#00843D', '#00843D', '#FFCD00', '#00843D', 'plain'], ['#00843D', '#FFCD00', '#00843D', '#00843D', '#FFCD00', 'plain'], 'anglo'],
  ['CAN', 'Canada', 74, ['#D80621', '#FFFFFF', '#D80621', '#D80621', '#FFFFFF', 'plain'], ['#FFFFFF', '#D80621', '#FFFFFF', '#FFFFFF', '#D80621', 'plain'], 'anglo'],
  ['CHI', 'Chile', 72, ['#D52B1E', '#0039A6', '#0039A6', '#FFFFFF', '#FFFFFF', 'plain'], ['#FFFFFF', '#D52B1E', '#FFFFFF', '#FFFFFF', '#0039A6', 'plain'], 'hisp'],
  ['SCO', 'Scotland', 73, ['#1C2C5B', '#FFFFFF', '#FFFFFF', '#1C2C5B', '#FFFFFF', 'plain'], ['#F7C8D6', '#1C2C5B', '#1C2C5B', '#F7C8D6', '#1C2C5B', 'plain'], 'anglo'],
  ['IRL', 'Ireland', 71, ['#169B62', '#FFFFFF', '#FFFFFF', '#169B62', '#FFFFFF', 'plain'], ['#FFFFFF', '#169B62', '#FFFFFF', '#FFFFFF', '#169B62', 'plain'], 'anglo'],
];

// Syllable pools for generating fictional surnames in a regional flavour.
const NAME_STYLES = {
  luso: [['Ar', 'Bel', 'Cas', 'Dor', 'Fal', 'Gra', 'Lu', 'Mar', 'Nor', 'Pal', 'Quev', 'Ros', 'Sam', 'Tav', 'Val', 'Zan'], ['anho', 'eiro', 'inho', 'oso', 'ales', 'eira', 'ado', 'ento', 'ildo', 'arte', 'elo']],
  hisp: [['Al', 'Ber', 'Cor', 'Dal', 'Esc', 'Fer', 'Gal', 'Lar', 'Mer', 'Nav', 'Or', 'Pic', 'Riv', 'San', 'Tol', 'Vil'], ['ez', 'ano', 'ero', 'illa', 'ondo', 'aga', 'ada', 'uez', 'ino', 'ales', 'orra']],
  fr: [['Bou', 'Char', 'Dela', 'Four', 'Gar', 'Lam', 'Mar', 'Per', 'Ros', 'Tou', 'Val', 'Ver', 'Mou', 'Ren'], ['eau', 'ard', 'ier', 'ette', 'ault', 'in', 'on', 'elle', 'ais', 'oux']],
  anglo: [['Ash', 'Brad', 'Craw', 'Dun', 'Elk', 'Fair', 'Hal', 'Kent', 'Lang', 'Mor', 'Pem', 'Rad', 'Stan', 'Thorn', 'Wick'], ['ton', 'ley', 'wood', 'field', 'ford', 'by', 'well', 'son', 'ham', 'ridge', 'more']],
  germ: [['Adl', 'Bran', 'Eich', 'Fal', 'Grun', 'Hart', 'Kel', 'Lind', 'Mess', 'Ost', 'Rein', 'Schal', 'Stei', 'Wal'], ['berg', 'mann', 'stein', 'dorf', 'hof', 'ling', 'ner', 'hardt', 'ke', 'bach']],
  dutch: [['Van Dal', 'De Brug', 'Hoog', 'Kuij', 'Mees', 'Oost', 'Ruy', 'Spij', 'Ter Wel', 'Vlie'], ['en', 'ers', 'stra', 'kamp', 'hout', 'ma', 'dijk', 'land']],
  ital: [['Bar', 'Ces', 'Dal', 'Fab', 'Gal', 'Lom', 'Mar', 'Nov', 'Pel', 'Ros', 'Sar', 'Tor', 'Vig'], ['etti', 'ani', 'ello', 'ucci', 'one', 'ini', 'azzo', 'otti', 'ese']],
  slav: [['Bor', 'Dra', 'Gor', 'Jur', 'Kov', 'Lub', 'Mil', 'Nov', 'Petr', 'Rad', 'Stan', 'Vuk', 'Zel'], ['ić', 'ski', 'ak', 'ević', 'owicz', 'czyk', 'enko', 'an']],
  jp: [['Ka', 'Ta', 'Mi', 'Yo', 'Ha', 'Ko', 'Na', 'Sa', 'Fu', 'Mo', 'Shi', 'I'], ['mura', 'kawa', 'moto', 'shita', 'zaki', 'hara', 'da', 'no', 'yama', 'saki', 'ta']],
  kr: [['Han', 'Seo', 'Yun', 'Bae', 'Ryu', 'Jin', 'Moon', 'Song', 'Kang', 'Oh'], [' Min', ' Jae', ' Hyun', ' Woo', ' Seok', ' Tae', ' Joon']],
  waf: [['Ade', 'Oko', 'Bam', 'Kwa', 'Ose', 'Nde', 'Mba', 'Diou', 'Tcho', 'Ama', 'Sar', 'Olu'], ['yemi', 'nkwo', 'ba', 'ku', 'nde', 'mba', 'fo', 'ssou', 'teng', 'wale', 'ye']],
  arab: [['Amr', 'Bouz', 'Hadd', 'Kar', 'Mans', 'Sal', 'Tah', 'Zak', 'Nas', 'Raf'], ['ani', 'oui', 'ouri', 'edi', 'ari', 'imi', 'awi', 'aoui']],
  nord: [['Ahl', 'Berg', 'Dahl', 'Eke', 'Frod', 'Hol', 'Lund', 'Norr', 'Sjö', 'Vik', 'Ask'], ['gren', 'qvist', 'sen', 'strand', 'ström', 'by', 'lind', 'vall']],
};

// 7-a-side formation (2-3-1). x = fraction of pitch from own goal line, y = fraction of width.
export const FORMATION = [
  { role: 'GK', x: 0.03, y: 0.5, num: 1 },
  { role: 'DF', x: 0.2, y: 0.3, num: 4 },
  { role: 'DF', x: 0.2, y: 0.7, num: 5 },
  { role: 'MF', x: 0.4, y: 0.18, num: 7 },
  { role: 'MF', x: 0.37, y: 0.5, num: 10 },
  { role: 'MF', x: 0.4, y: 0.82, num: 11 },
  { role: 'FW', x: 0.58, y: 0.5, num: 9 },
];

function kitObj(k) {
  return { shirt: k[0], sec: k[1], shorts: k[2], socks: k[3], num: k[4], pattern: k[5] };
}

function genName(style, rng, used) {
  const [pre, suf] = NAME_STYLES[style] || NAME_STYLES.anglo;
  for (let tries = 0; tries < 40; tries++) {
    const n = pre[Math.floor(rng() * pre.length)] + suf[Math.floor(rng() * suf.length)];
    if (!used.has(n)) { used.add(n); return n; }
  }
  return 'Player' + used.size;
}

/** Build a team's squad: 7 players with fictional names and rating-derived attributes. */
function buildSquad(code, rating, style) {
  const rng = makeRng(hashStr(code + ':squad'));
  const used = new Set();
  const base = clamp((rating - 50) / 45, 0.15, 0.98);
  // strength comes from its own stream so names / other attributes stay unchanged
  const srng = makeRng(hashStr(code + ':strength'));
  const STR_BONUS = { GK: 0.05, DF: 0.1, MF: -0.04, FW: 0.04 };
  return FORMATION.map((f) => {
    const v = () => clamp(base + (rng() - 0.5) * 0.16, 0.1, 1);
    const a = { pace: v(), shooting: v(), passing: v(), tackling: v(), dribbling: v(), keeping: 0.3, stamina: v() };
    if (f.role === 'FW') { a.shooting = clamp(a.shooting + 0.1, 0, 1); a.pace = clamp(a.pace + 0.06, 0, 1); }
    if (f.role === 'DF') { a.tackling = clamp(a.tackling + 0.1, 0, 1); a.shooting -= 0.1; }
    if (f.role === 'MF') a.passing = clamp(a.passing + 0.08, 0, 1);
    if (f.role === 'GK') { a.keeping = clamp(base + 0.04 + (rng() - 0.5) * 0.1, 0.2, 1); a.shooting = 0.2; }
    a.strength = clamp(0.35 + base * 0.45 + STR_BONUS[f.role] + (srng() - 0.5) * 0.3, 0.1, 1);
    return { name: genName(style, rng, used).toUpperCase(), num: f.num, role: f.role, attrs: a };
  });
}

// Palette + pattern pool used to build each nation's third kit procedurally, so every
// team gets a distinct home/away/third set without hand-authoring dozens more colours.
const THIRD_PALETTE = ['#111111', '#FFFFFF', '#00C2A8', '#FF6B00', '#6A1B9A', '#0057B8', '#C9A227', '#E8112D', '#2E7D32'];
const THIRD_PATTERNS = ['plain', 'stripes', 'hoops', 'sashes', 'checks'];

/** Build a nation's third kit: a colour that contrasts with both its home and away kits,
 *  in a pattern (stripes/hoops/sashes/checks/plain) picked deterministically per team. */
function thirdKit(code, home, away) {
  const rng = makeRng(hashStr(code + ':third'));
  let shirt = THIRD_PALETTE[0], bestScore = -1;
  for (const c of THIRD_PALETTE) {
    const score = Math.min(colorDist(c, home.shirt), colorDist(c, away.shirt));
    if (score > bestScore) { bestScore = score; shirt = c; }
  }
  const secPool = THIRD_PALETTE.filter((c) => c !== shirt);
  const sec = secPool[Math.floor(rng() * secPool.length)];
  const pattern = THIRD_PATTERNS[Math.floor(rng() * THIRD_PATTERNS.length)];
  const num = luminance(shirt) > 0.55 ? '#111111' : '#FFFFFF';
  return { shirt, sec, shorts: shirt, socks: shirt, num, pattern };
}

export const TEAMS = RAW.map(([code, name, rating, home, away, style]) => {
  const homeKit = kitObj(home), awayKit = kitObj(away);
  return {
    code, name, rating,
    home: homeKit, away: awayKit, third: thirdKit(code, homeKit, awayKit),
    squad: buildSquad(code, rating, style),
  };
});

export const teamByCode = (code) => TEAMS.find((t) => t.code === code) || TEAMS[0];

/** The colour a kit "reads as" from a distance (patterns blend). */
export function kitTone(kit) {
  return kit.pattern === 'plain' ? kit.shirt : mixHex(kit.shirt, kit.sec, 0.4);
}

export const CLASH_THRESHOLD = 170;

export function kitsClash(a, b) {
  return colorDist(kitTone(a), kitTone(b)) < CLASH_THRESHOLD;
}

const GK_COLOURS = ['#1DB954', '#F5E100', '#FF7A00', '#8E44AD', '#111111', '#00B7C3', '#E91E63', '#9E9E9E'];

/**
 * Choose kits for a fixture: home always keeps its home kit; the away side tries its
 * home -> away -> third kit in turn and takes the first that doesn't clash. If all three
 * clash (unlucky colour overlap), it falls back to whichever of the three contrasts most
 * with the home kit, so there is always enough colour contrast to tell the sides apart.
 */
export function chooseKits(home, away) {
  const hk = home.home;
  const candidates = [
    { kit: away.home, tag: 'home' },
    { kit: away.away, tag: 'away' },
    { kit: away.third, tag: 'third' },
  ];
  let chosen = candidates.find((c) => !kitsClash(hk, c.kit));
  if (!chosen) {
    chosen = candidates.slice().sort((a, b) => colorDist(kitTone(b.kit), kitTone(hk)) - colorDist(kitTone(a.kit), kitTone(hk)))[0];
  }
  const ak = chosen.kit, awayUsesAway = chosen.tag !== 'home';
  const gk = [];
  for (const k of [hk, ak]) {
    const c = GK_COLOURS.find((g) => colorDist(g, kitTone(hk)) > 180 && colorDist(g, kitTone(ak)) > 180 && !gk.some((x) => colorDist(x.shirt, g) < 180)) || '#9E9E9E';
    gk.push({ shirt: c, sec: '#222222', shorts: '#222222', socks: c, num: c === '#111111' ? '#FFFFFF' : '#111111', pattern: 'plain' });
  }
  return { kits: [hk, ak], gk, awayUsesAway, kitTag: chosen.tag };
}
