// Static game data: nations (real countries + real kit colours), fictional leagues and clubs,
// and name-generation material. DOM-free. All club / league / player names are invented.

// kit tuple: [shirt primary, shirt secondary, number, shorts, socks]
const K = (a) => ({ primary: a[0], secondary: a[1], number: a[2], shorts: a[3], socks: a[4] });

// [code, name, name region, strength 1..5, flag, home kit, away kit, formation]
const NATION_ROWS = [
  ['ENG', 'England', 'en', 5, { t: 'cross', c: ['#FFFFFF', '#CE1124'] }, ['#FFFFFF', '#1B2A4A', '#1B2A4A', '#1B2A4A', '#FFFFFF'], ['#C8102E', '#FFFFFF', '#FFFFFF', '#C8102E', '#C8102E'], '4-2-3-1'],
  ['FRA', 'France', 'fr', 5, { t: 'v', c: ['#0055A4', '#FFFFFF', '#EF4135'] }, ['#1F2A5A', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#C8102E'], ['#FFFFFF', '#1F2A5A', '#1F2A5A', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['GER', 'Germany', 'de', 5, { t: 'h', c: ['#000000', '#DD0000', '#FFCE00'] }, ['#FFFFFF', '#000000', '#000000', '#000000', '#FFFFFF'], ['#1E1E1E', '#D00000', '#FFFFFF', '#1E1E1E', '#1E1E1E'], '4-2-3-1'],
  ['ESP', 'Spain', 'es', 5, { t: 'h', c: ['#AA151B', '#F1BF00', '#F1BF00', '#AA151B'] }, ['#C60B1E', '#FFC400', '#FFC400', '#0A1F44', '#0A1F44'], ['#F4F1E6', '#C60B1E', '#C60B1E', '#F4F1E6', '#F4F1E6'], '4-3-3'],
  ['ITA', 'Italy', 'it', 4, { t: 'v', c: ['#009246', '#FFFFFF', '#CE2B37'] }, ['#1F5FAF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#1F5FAF'], ['#FFFFFF', '#1F5FAF', '#1F5FAF', '#1F5FAF', '#FFFFFF'], '3-5-2'],
  ['POR', 'Portugal', 'pt', 5, { t: 'v2', c: ['#006600', '#FF0000'] }, ['#C8102E', '#006600', '#FFD700', '#006600', '#C8102E'], ['#FFFFFF', '#006600', '#C8102E', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['NED', 'Netherlands', 'nl', 4, { t: 'h', c: ['#AE1C28', '#FFFFFF', '#21468B'] }, ['#F36C21', '#000000', '#000000', '#F36C21', '#F36C21'], ['#1B2A4A', '#F36C21', '#F36C21', '#1B2A4A', '#1B2A4A'], '4-3-3'],
  ['BEL', 'Belgium', 'nl', 4, { t: 'v', c: ['#000000', '#FDDA24', '#EF3340'] }, ['#E30613', '#000000', '#FDDA24', '#E30613', '#E30613'], ['#FFFFFF', '#E30613', '#E30613', '#FFFFFF', '#FFFFFF'], '3-5-2'],
  ['ARG', 'Argentina', 'es', 5, { t: 'h', c: ['#74ACDF', '#FFFFFF', '#74ACDF'], sun: '#F6B40E' }, ['#75AADB', '#FFFFFF', '#000000', '#000000', '#FFFFFF'], ['#2B2D6E', '#75AADB', '#75AADB', '#2B2D6E', '#2B2D6E'], '4-4-2'],
  ['BRA', 'Brazil', 'pt', 5, { t: 'brazil', c: ['#009C3B', '#FEDF00', '#002776'] }, ['#FEDD00', '#009C3B', '#009C3B', '#002776', '#FFFFFF'], ['#002776', '#FEDD00', '#FFFFFF', '#FFFFFF', '#002776'], '4-3-3'],
  ['URU', 'Uruguay', 'es', 4, { t: 'h', c: ['#FFFFFF', '#0038A8', '#FFFFFF', '#0038A8', '#FFFFFF'], sun: '#FCD116' }, ['#5CBFEB', '#000000', '#000000', '#000000', '#000000'], ['#FFFFFF', '#5CBFEB', '#5CBFEB', '#FFFFFF', '#FFFFFF'], '4-4-2'],
  ['CRO', 'Croatia', 'sl', 4, { t: 'h', c: ['#FF0000', '#FFFFFF', '#171796'] }, ['#E4002B', '#FFFFFF', '#171796', '#FFFFFF', '#171796'], ['#1B2A6B', '#E4002B', '#FFFFFF', '#1B2A6B', '#1B2A6B'], '4-3-3'],
  ['MEX', 'Mexico', 'es', 3, { t: 'v', c: ['#006847', '#FFFFFF', '#CE1126'] }, ['#006847', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#CE1126'], ['#FFFFFF', '#006847', '#006847', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['USA', 'United States', 'en', 3, { t: 'usa', c: ['#B22234', '#FFFFFF', '#3C3B6E'] }, ['#FFFFFF', '#1B2A4A', '#1B2A4A', '#1B2A4A', '#FFFFFF'], ['#1B2A4A', '#C8102E', '#FFFFFF', '#1B2A4A', '#1B2A4A'], '4-3-3'],
  ['JPN', 'Japan', 'jp', 3, { t: 'circle', c: ['#FFFFFF', '#BC002D'] }, ['#1C3C8F', '#FFFFFF', '#FFFFFF', '#1C3C8F', '#1C3C8F'], ['#FFFFFF', '#1C3C8F', '#1C3C8F', '#FFFFFF', '#FFFFFF'], '4-2-3-1'],
  ['KOR', 'South Korea', 'kr', 3, { t: 'circle2', c: ['#FFFFFF', '#CD2E3A', '#0047A0'] }, ['#CD2E3A', '#000000', '#FFFFFF', '#000000', '#CD2E3A'], ['#FFFFFF', '#000000', '#000000', '#FFFFFF', '#FFFFFF'], '4-2-3-1'],
  ['NGA', 'Nigeria', 'af', 3, { t: 'v', c: ['#008751', '#FFFFFF', '#008751'] }, ['#008751', '#FFFFFF', '#FFFFFF', '#008751', '#008751'], ['#FFFFFF', '#008751', '#008751', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['SEN', 'Senegal', 'af', 4, { t: 'v', c: ['#00853F', '#FDEF42', '#E31B23'] }, ['#FFFFFF', '#00853F', '#00853F', '#FFFFFF', '#FFFFFF'], ['#00853F', '#FDEF42', '#FFFFFF', '#00853F', '#00853F'], '4-3-3'],
  ['MAR', 'Morocco', 'ar', 4, { t: 'solid', c: ['#C1272D'], star: '#006233' }, ['#C1272D', '#006233', '#FFFFFF', '#006233', '#C1272D'], ['#FFFFFF', '#C1272D', '#C1272D', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['GHA', 'Ghana', 'af', 3, { t: 'h', c: ['#CE1126', '#FCD116', '#006B3F'], star: '#000000' }, ['#FFFFFF', '#000000', '#000000', '#FFFFFF', '#FFFFFF'], ['#CE1126', '#FCD116', '#FCD116', '#CE1126', '#CE1126'], '4-2-3-1'],
  ['CMR', 'Cameroon', 'af', 3, { t: 'v', c: ['#007A5E', '#CE1126', '#FCD116'] }, ['#007A5E', '#CE1126', '#FCD116', '#CE1126', '#FCD116'], ['#FFFFFF', '#007A5E', '#007A5E', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['EGY', 'Egypt', 'ar', 3, { t: 'h', c: ['#CE1126', '#FFFFFF', '#000000'] }, ['#CE1126', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#000000'], ['#FFFFFF', '#CE1126', '#CE1126', '#000000', '#FFFFFF'], '4-2-3-1'],
  ['SWE', 'Sweden', 'no', 3, { t: 'nordic', c: ['#006AA7', '#FECC00'] }, ['#FECC00', '#006AA7', '#006AA7', '#006AA7', '#FECC00'], ['#006AA7', '#FECC00', '#FECC00', '#006AA7', '#006AA7'], '4-4-2'],
  ['DEN', 'Denmark', 'no', 4, { t: 'nordic', c: ['#C60C30', '#FFFFFF'] }, ['#C60C30', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#C60C30'], ['#FFFFFF', '#C60C30', '#C60C30', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['NOR', 'Norway', 'no', 3, { t: 'nordic2', c: ['#BA0C2F', '#FFFFFF', '#00205B'] }, ['#BA0C2F', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#00205B'], ['#FFFFFF', '#00205B', '#00205B', '#00205B', '#FFFFFF'], '4-3-3'],
  ['POL', 'Poland', 'sl', 3, { t: 'h', c: ['#FFFFFF', '#DC143C'] }, ['#FFFFFF', '#DC143C', '#DC143C', '#DC143C', '#FFFFFF'], ['#DC143C', '#FFFFFF', '#FFFFFF', '#DC143C', '#DC143C'], '4-4-2'],
  ['SUI', 'Switzerland', 'de', 3, { t: 'swiss', c: ['#D52B1E', '#FFFFFF'] }, ['#D52B1E', '#FFFFFF', '#FFFFFF', '#D52B1E', '#D52B1E'], ['#FFFFFF', '#D52B1E', '#D52B1E', '#FFFFFF', '#FFFFFF'], '4-2-3-1'],
  ['AUT', 'Austria', 'de', 3, { t: 'h', c: ['#ED2939', '#FFFFFF', '#ED2939'] }, ['#ED2939', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#ED2939'], ['#FFFFFF', '#1A1A1A', '#1A1A1A', '#1A1A1A', '#FFFFFF'], '4-2-3-1'],
  ['COL', 'Colombia', 'es', 4, { t: 'h', c: ['#FCD116', '#FCD116', '#003893', '#CE1126'] }, ['#FCD116', '#003893', '#003893', '#003893', '#FFFFFF'], ['#003893', '#FCD116', '#FCD116', '#003893', '#003893'], '4-2-3-1'],
  ['CHI', 'Chile', 'es', 3, { t: 'chile', c: ['#FFFFFF', '#D52B1E', '#0039A6'] }, ['#D52B1E', '#0039A6', '#FFFFFF', '#0039A6', '#FFFFFF'], ['#FFFFFF', '#D52B1E', '#D52B1E', '#FFFFFF', '#FFFFFF'], '3-5-2'],
  ['SCO', 'Scotland', 'en', 3, { t: 'saltire', c: ['#005EB8', '#FFFFFF'] }, ['#1C2C5B', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#1C2C5B'], ['#FFFFFF', '#1C2C5B', '#1C2C5B', '#1C2C5B', '#FFFFFF'], '4-4-2'],
  ['IRL', 'Ireland', 'en', 2, { t: 'v', c: ['#169B62', '#FFFFFF', '#FF883E'] }, ['#169B62', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#169B62'], ['#FFFFFF', '#169B62', '#169B62', '#FFFFFF', '#FFFFFF'], '4-4-2'],
  ['WAL', 'Wales', 'en', 2, { t: 'h', c: ['#FFFFFF', '#00B140'] }, ['#C8102E', '#FFFFFF', '#FFFFFF', '#C8102E', '#C8102E'], ['#FFFFFF', '#C8102E', '#C8102E', '#FFFFFF', '#FFFFFF'], '3-5-2'],
  ['TUR', 'Türkiye', 'tr', 3, { t: 'solid', c: ['#E30A17'], crescent: '#FFFFFF' }, ['#E30A17', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#E30A17'], ['#FFFFFF', '#E30A17', '#E30A17', '#FFFFFF', '#FFFFFF'], '4-2-3-1'],
  ['SRB', 'Serbia', 'sl', 3, { t: 'h', c: ['#C6363C', '#0C4076', '#FFFFFF'] }, ['#C6363C', '#FFFFFF', '#FFFFFF', '#0C4076', '#FFFFFF'], ['#FFFFFF', '#C6363C', '#C6363C', '#FFFFFF', '#FFFFFF'], '3-5-2'],
  ['CIV', 'Ivory Coast', 'af', 3, { t: 'v', c: ['#F77F00', '#FFFFFF', '#009E60'] }, ['#FF8200', '#009E60', '#009E60', '#FFFFFF', '#009E60'], ['#FFFFFF', '#FF8200', '#FF8200', '#FFFFFF', '#FFFFFF'], '4-3-3'],
  ['ECU', 'Ecuador', 'es', 2, { t: 'h', c: ['#FFD100', '#FFD100', '#034EA2', '#EF3340'] }, ['#FFD100', '#034EA2', '#034EA2', '#034EA2', '#FFD100'], ['#034EA2', '#FFD100', '#FFFFFF', '#034EA2', '#034EA2'], '4-4-2'],
  ['CAN', 'Canada', 'en', 2, { t: 'canada', c: ['#D80621', '#FFFFFF', '#D80621'] }, ['#D80621', '#FFFFFF', '#FFFFFF', '#D80621', '#D80621'], ['#FFFFFF', '#D80621', '#D80621', '#FFFFFF', '#FFFFFF'], '4-4-2'],
  ['AUS', 'Australia', 'en', 2, { t: 'solid', c: ['#00247D'], star: '#FFFFFF' }, ['#FFCD00', '#00843D', '#00843D', '#00843D', '#FFCD00'], ['#00843D', '#FFCD00', '#FFCD00', '#00843D', '#00843D'], '4-2-3-1'],
  ['UKR', 'Ukraine', 'sl', 2, { t: 'h', c: ['#0057B7', '#FFD700'] }, ['#FFD700', '#0057B7', '#0057B7', '#FFD700', '#FFD700'], ['#0057B7', '#FFD700', '#FFD700', '#0057B7', '#0057B7'], '4-3-3'],
  ['GRE', 'Greece', 'gr', 2, { t: 'h', c: ['#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF'] }, ['#FFFFFF', '#0D5EAF', '#0D5EAF', '#FFFFFF', '#FFFFFF'], ['#0D5EAF', '#FFFFFF', '#FFFFFF', '#0D5EAF', '#0D5EAF'], '4-2-3-1'],
  ['CZE', 'Czechia', 'sl', 2, { t: 'czech', c: ['#FFFFFF', '#D7141A', '#11457E'] }, ['#D7141A', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#11457E'], ['#FFFFFF', '#D7141A', '#D7141A', '#FFFFFF', '#FFFFFF'], '3-5-2'],
];

// Extra nations (V2): only used for real players' nationality and extra national teams. They are kept
// OUT of NATIONS so the deterministic generated database (and every existing save) stays identical.
const EXTRA_NATION_ROWS = [
  ['HUN', 'Hungary', 'hu', 3, { t: 'h', c: ['#CE2939', '#FFFFFF', '#477050'] }, ['#CE2939', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#477050'], ['#FFFFFF', '#CE2939', '#CE2939', '#FFFFFF', '#FFFFFF'], '4-2-3-1'],
  ['PER', 'Peru', 'es', 3, { t: 'v', c: ['#D91023', '#FFFFFF', '#D91023'] }, ['#FFFFFF', '#D91023', '#D91023', '#FFFFFF', '#FFFFFF'], ['#D91023', '#FFFFFF', '#FFFFFF', '#D91023', '#D91023'], '4-3-3'],
  ['ROU', 'Romania', 'ro', 3, { t: 'v', c: ['#002B7F', '#FCD116', '#CE1126'] }, ['#FCD116', '#002B7F', '#002B7F', '#FCD116', '#FCD116'], ['#CE1126', '#FCD116', '#FFFFFF', '#CE1126', '#CE1126'], '4-2-3-1'],
  ['BUL', 'Bulgaria', 'sl', 3, { t: 'h', c: ['#FFFFFF', '#00966E', '#D62612'] }, ['#FFFFFF', '#00966E', '#00966E', '#00966E', '#FFFFFF'], ['#D62612', '#FFFFFF', '#FFFFFF', '#D62612', '#D62612'], '4-4-2'],
  ['IRN', 'Iran', 'fa', 3, { t: 'h', c: ['#239F40', '#FFFFFF', '#DA0000'] }, ['#FFFFFF', '#DA0000', '#DA0000', '#FFFFFF', '#FFFFFF'], ['#DA0000', '#FFFFFF', '#FFFFFF', '#DA0000', '#DA0000'], '4-2-3-1'],
  ['RUS', 'Russia', 'sl', 3, { t: 'h', c: ['#FFFFFF', '#0039A6', '#D52B1E'] }, ['#D52B1E', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#D52B1E'], ['#FFFFFF', '#0039A6', '#0039A6', '#0039A6', '#FFFFFF'], '4-2-3-1'],
  ['NIR', 'Northern Ireland', 'en', 2, { t: 'cross', c: ['#FFFFFF', '#CE1124'] }, ['#00843D', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#00843D'], ['#FFFFFF', '#00843D', '#00843D', '#00843D', '#FFFFFF'], '4-4-2'],
];
const toNation = ([code, name, region, str, flag, home, away, formation]) => ({
  code, name, region, str, flag, formation, kit: K(home), away: K(away),
});
export const NATIONS = NATION_ROWS.map(toNation);
export const EXTRA_NATIONS = EXTRA_NATION_ROWS.map((r) => ({ ...toNation(r), extra: true }));
/** Every nation that can field a national team (base generated nations + V2 extras). */
export const ALL_NATIONS = NATIONS.concat(EXTRA_NATIONS);
export const NATION_BY_CODE = Object.fromEntries(ALL_NATIONS.map((n) => [n.code, n]));

// ---------- name material (all syllable-generated; no real people) ----------
export const NAME_REGIONS = {
  en: {
    first: ['Jack', 'Harry', 'Oliver', 'George', 'Charlie', 'James', 'Tom', 'Luke', 'Ryan', 'Callum', 'Connor', 'Liam', 'Nathan', 'Aaron', 'Jamie', 'Kieran', 'Ben', 'Sam', 'Alfie', 'Mason', 'Dylan', 'Lewis', 'Joe', 'Owen', 'Reece', 'Tyler', 'Ethan', 'Finley', 'Rory', 'Toby', 'Ellis', 'Morgan', 'Jordan', 'Brandon', 'Cole', 'Miles'],
    roots: ['Ash', 'Brad', 'Carr', 'Dun', 'Fair', 'Hal', 'Hart', 'Kent', 'Mor', 'Pem', 'Ral', 'Stan', 'Thorn', 'Whit', 'Wood', 'Brook', 'Cald', 'Fen', 'Gar', 'Hol', 'Lang', 'Mar', 'Nor', 'Pres', 'Row', 'Shel', 'Sut', 'Tal', 'War', 'Bran', 'Crane', 'Dal', 'Eld', 'Fox', 'Pent', 'Wick', 'Brig', 'Coln'],
    suf: ['by', 'ton', 'ley', 'well', 'wood', 'ford', 'ham', 'son', 'field', 'worth', 'more', 'ridge', 'shaw', 'dale', 'ings', 'combe', 'gate', 'man', 'er', 'lock', 'stone', 'wright'],
  },
  es: {
    first: ['Alejandro', 'Pablo', 'Diego', 'Javier', 'Sergio', 'Carlos', 'Mateo', 'Iker', 'Marcos', 'Adrián', 'Álvaro', 'Hugo', 'Rubén', 'Raúl', 'Iván', 'Gonzalo', 'Nicolás', 'Santiago', 'Tomás', 'Joaquín', 'Emiliano', 'Facundo', 'Agustín', 'Julián', 'Ignacio', 'Rodrigo', 'Bruno', 'Óscar', 'Unai', 'Andrés', 'Cristian', 'Felipe', 'Esteban'],
    roots: ['Mar', 'Gal', 'Fer', 'Rod', 'Vel', 'Cas', 'Mend', 'Or', 'Sal', 'Bar', 'Qui', 'Ped', 'Lor', 'Mon', 'Riv', 'Ben', 'Esc', 'Gar', 'Nav', 'Pal', 'Val', 'Ser', 'Tor', 'Alv', 'Cor', 'Olm', 'Zam', 'Arr', 'Lez', 'Cab', 'Tej', 'Ur'],
    suf: ['ez', 'ano', 'ero', 'ino', 'ado', 'illa', 'ón', 'edo', 'uera', 'al', 'ara', 'iño', 'osa', 'ente', 'elo', 'ales', 'ena', 'iaga', 'ondo'],
  },
  pt: {
    first: ['João', 'Pedro', 'Tiago', 'Rafael', 'Gonçalo', 'Rodrigo', 'Bruno', 'Diogo', 'Lucas', 'Gabriel', 'Thiago', 'Vinícius', 'Matheus', 'Caio', 'Felipe', 'Renan', 'Wesley', 'Douglas', 'Anderson', 'Leandro', 'Marcelo', 'Henrique', 'Guilherme', 'Rúben', 'Nuno', 'Fábio', 'Danilo', 'Igor', 'Murilo', 'Otávio', 'Elias', 'Samuel'],
    roots: ['Alm', 'Barr', 'Carv', 'Fons', 'Guim', 'Lob', 'Mour', 'Nasc', 'Oliv', 'Perr', 'Queir', 'Rib', 'Sant', 'Teix', 'Vasc', 'Cost', 'Brag', 'Fal', 'Mach', 'Pint', 'Card', 'Rez', 'Tav', 'Gou', 'Mend'],
    suf: ['eira', 'ão', 'ado', 'inho', 'elo', 'ano', 'ino', 'oso', 'ende', 'es', 'ira', 'uel', 'al', 'ares', 'eiro', 'ança'],
  },
  fr: {
    first: ['Lucas', 'Hugo', 'Théo', 'Mathis', 'Nathan', 'Enzo', 'Antoine', 'Julien', 'Maxime', 'Alexandre', 'Baptiste', 'Clément', 'Adrien', 'Florian', 'Yanis', 'Rayan', 'Moussa', 'Ibrahim', 'Mehdi', 'Loïc', 'Quentin', 'Romain', 'Bastien', 'Évan', 'Jules', 'Noah', 'Axel', 'Warren', 'Dayot', 'Malo', 'Sacha', 'Gaël'],
    roots: ['Bel', 'Char', 'Dub', 'Fav', 'Gir', 'Lab', 'Lef', 'Mar', 'Mor', 'Per', 'Rou', 'Vall', 'Ber', 'Cham', 'Del', 'Fon', 'Gau', 'Lan', 'Mich', 'Ren', 'Taill', 'Vid', 'Bonn', 'Cour', 'Duv'],
    suf: ['eau', 'ier', 'and', 'ard', 'ot', 'et', 'ois', 'elle', 'ault', 'in', 'on', 'eux', 'ac', 'ourt', 'enne', 'ignac'],
  },
  de: {
    first: ['Lukas', 'Leon', 'Jonas', 'Felix', 'Maximilian', 'Paul', 'Niklas', 'Tim', 'Jan', 'Florian', 'Julian', 'Tobias', 'Kai', 'Marco', 'Timo', 'Moritz', 'Jannik', 'Fabian', 'Sebastian', 'Lars', 'Benedikt', 'Dominik', 'Matthias', 'Kevin', 'Nico', 'Robin', 'Luca', 'Finn', 'Malte', 'Henrik'],
    roots: ['Bau', 'Schm', 'Hof', 'Kel', 'Wag', 'Brand', 'Kraus', 'Lang', 'Neu', 'Stein', 'Vogt', 'Wolf', 'Zim', 'Berg', 'Fisch', 'Hart', 'Kess', 'Lind', 'Roth', 'Sei', 'Wein', 'Eich', 'Gro', 'Rein', 'Stra'],
    suf: ['mann', 'er', 'feld', 'hardt', 'berg', 'ler', 'ke', 'ner', 'stein', 'ow', 'rich', 'bach', 'dorf', 'ling', 'hof', 'hausen'],
  },
  it: {
    first: ['Lorenzo', 'Matteo', 'Andrea', 'Alessandro', 'Federico', 'Davide', 'Riccardo', 'Simone', 'Nicolò', 'Gianluca', 'Marco', 'Stefano', 'Luca', 'Francesco', 'Giorgio', 'Tommaso', 'Pietro', 'Emanuele', 'Samuele', 'Manuel', 'Filippo', 'Giacomo', 'Daniele', 'Alberto', 'Enrico', 'Leonardo'],
    roots: ['Bar', 'Bell', 'Cal', 'Dell', 'Fer', 'Gall', 'Lomb', 'Marc', 'Ross', 'Sart', 'Tor', 'Vitt', 'Acc', 'Bian', 'Cont', 'Esp', 'Grec', 'Marin', 'Pell', 'Riz', 'Sal', 'Zan', 'Cap', 'Fior', 'Nard'],
    suf: ['ini', 'etti', 'ello', 'one', 'ari', 'ucci', 'ato', 'ino', 'olo', 'azzi', 'ese', 'otti', 'ano', 'ieri', 'aldi', 'ucco'],
  },
  nl: {
    first: ['Daan', 'Sem', 'Lars', 'Bram', 'Thijs', 'Jesse', 'Stijn', 'Ruben', 'Koen', 'Joris', 'Niels', 'Wout', 'Jens', 'Milan', 'Tijmen', 'Sander', 'Bas', 'Luuk', 'Mats', 'Dries', 'Pieter', 'Jelle', 'Senne', 'Arne', 'Youri', 'Kjell'],
    roots: ['Berg', 'Dijk', 'Hout', 'Kamp', 'Meer', 'Veld', 'Bosch', 'Brink', 'Jong', 'Wit', 'Groot', 'Smit', 'Viss', 'Mol', 'Kok', 'Bak', 'Hoek', 'Leeu', 'Maas', 'Straa'],
    suf: ['', 's', 'hof', 'man', 'stra', 'ink', 'ema', 'ker', 'huis', 'ma', 'ens', 'ers', 'aert', 'ijk'],
    pre: ['van ', 'de ', 'van der ', 'van den ', '', '', '', ''],
  },
  no: {
    first: ['Erik', 'Magnus', 'Oscar', 'Emil', 'Anders', 'Henrik', 'Mikkel', 'Rasmus', 'Jonas', 'Lukas', 'Viktor', 'Axel', 'Elias', 'Sander', 'Kasper', 'Tobias', 'Mathias', 'Sindre', 'Jesper', 'Filip', 'Oskar', 'Joakim', 'Sebastian', 'Albin', 'Ludvig'],
    roots: ['Lind', 'Berg', 'Dahl', 'Holm', 'Sand', 'Strand', 'Lund', 'Nord', 'Hag', 'Aas', 'Bjerk', 'Fjell', 'Ek', 'Sjö', 'Vik', 'Stor', 'Hed', 'Borg', 'Sol', 'Kvist'],
    suf: ['gren', 'qvist', 'sen', 'ström', 'berg', 'by', 'lund', 'vik', 'dal', 'heim', 'ås', 'rud', 'gaard', 'stad'],
  },
  sl: {
    first: ['Luka', 'Marko', 'Ivan', 'Petar', 'Nikola', 'Filip', 'Tomasz', 'Jakub', 'Kamil', 'Mateusz', 'Dominik', 'Stefan', 'Milan', 'Andrej', 'Josip', 'Dušan', 'Ondřej', 'Oleksandr', 'Mykola', 'Bohdan', 'Karol', 'Vojtěch', 'Aleksandar', 'Mario', 'Borna', 'Szymon'],
    roots: ['Kov', 'Pet', 'Nov', 'Jan', 'Mil', 'Wis', 'Kraw', 'Zel', 'Hor', 'Dvor', 'Bog', 'Rad', 'Stan', 'Mar', 'Ves', 'Lew', 'Sok', 'Tkach', 'Bor', 'Pav', 'Grab', 'Kral', 'Zaj'],
    suf: ['ić', 'ović', 'ski', 'czyk', 'ak', 'enko', 'ek', 'in', 'uk', 'ević', 'owski', 'ar', 'ina', 'ský', 'ec'],
  },
  af: {
    first: ['Chidi', 'Emeka', 'Kwame', 'Kofi', 'Moussa', 'Ibrahima', 'Samuel', 'Victor', 'Yaw', 'Cheikh', 'Abdou', 'Ousmane', 'Idrissa', 'Joseph', 'Emmanuel', 'Jean', 'Serge', 'Wilfried', 'Franck', 'Eric', 'Babatunde', 'Tunde', 'Obinna', 'Kelechi', 'Lamine', 'Pape', 'Seydou', 'Kojo', 'Ebo', 'Christian'],
    roots: ['Ade', 'Oka', 'Nwa', 'Ose', 'Ba', 'Dia', 'Tou', 'Kou', 'Mba', 'Asa', 'Ama', 'Kon', 'Sa', 'Ndi', 'Owu', 'Boa', 'Eto', 'Ma', 'Ow', 'Sis', 'Yeb'],
    suf: ['yemi', 'for', 'kwe', 'ne', 'llo', 'ré', 'amé', 'ye', 'moah', 'ssi', 'tey', 'ké', 'kolo', 'bangu', 'doh', 'fo', 'unde', 'ah', 'oko'],
  },
  ar: {
    first: ['Youssef', 'Hamza', 'Omar', 'Karim', 'Mohamed', 'Amine', 'Mahmoud', 'Ahmed', 'Ayoub', 'Ismail', 'Tarek', 'Nabil', 'Walid', 'Zakaria', 'Ilias', 'Bilal', 'Hakim', 'Anas', 'Soufiane', 'Mostafa', 'Ramy', 'Adel'],
    roots: ['Amr', 'Hadd', 'Kha', 'Sab', 'Bou', 'Ben', 'Zar', 'Mans', 'Nas', 'Fah', 'Tah', 'Sal', 'Ham', 'Raj', 'Sha'],
    suf: ['ani', 'ouri', 'idi', 'ami', 'ar', 'ir', 'oun', 'awi', 'ali', 'ek', 'ifa', 'rawi'],
    pre: ['El ', '', '', 'El-'],
  },
  tr: {
    first: ['Emre', 'Burak', 'Mert', 'Kerem', 'Cenk', 'Ozan', 'Hakan', 'Yusuf', 'Efe', 'Barış', 'Onur', 'Can', 'Kaan', 'Selim', 'Tolga', 'Umut', 'Serdar', 'Ferdi', 'Halil'],
    roots: ['Yıl', 'Kaya', 'Demir', 'Çel', 'Ak', 'Öz', 'Şah', 'Kar', 'Tur', 'Ay', 'Gül', 'Er', 'Yaz', 'Kul'],
    suf: ['maz', 'ik', 'dağ', 'türk', 'soy', 'han', 'can', 'oğlu', 'er', 'kan', 'bay', 'ci'],
  },
  gr: {
    first: ['Giorgos', 'Kostas', 'Nikos', 'Dimitris', 'Yannis', 'Christos', 'Petros', 'Vasilis', 'Tasos', 'Stelios', 'Panagiotis', 'Andreas', 'Manolis', 'Lefteris', 'Thanasis'],
    roots: ['Papa', 'Kara', 'Nik', 'Dim', 'Kon', 'Vla', 'Mav', 'Ale', 'Theo', 'Spy', 'Ang', 'Ma', 'Chri', 'Sta'],
    suf: ['dopoulos', 'idis', 'akis', 'ou', 'atos', 'ellis', 'opoulos', 'iadis', 'as', 'inos'],
  },
  jp: {
    first: ['Haruto', 'Yuto', 'Sota', 'Ren', 'Kaito', 'Daiki', 'Takumi', 'Kenta', 'Ryo', 'Shota', 'Hiroki', 'Yuki', 'Kazuki', 'Kosuke', 'Takuma', 'Riku', 'Sho', 'Tatsuya', 'Genki', 'Naoki'],
    roots: ['Ta', 'Na', 'Ka', 'Mo', 'Hi', 'Yama', 'Saka', 'Mori', 'Ishi', 'Ki', 'Fuji', 'Mura', 'Naka', 'Matsu', 'Ino', 'Ko', 'Ha', 'Su', 'Aki', 'Oka'],
    suf: ['moto', 'kawa', 'da', 'ta', 'no', 'mura', 'shita', 'zawa', 'guchi', 'hara', 'uchi', 'saki', 'bayashi', 'oka', 'shima'],
  },
  hu: {
    first: ['Bence', 'Dániel', 'Ádám', 'Levente', 'Máté', 'Balázs', 'Gergő', 'Zsolt', 'Tamás', 'Péter', 'Attila', 'Krisztián', 'Dominik', 'Roland', 'Norbert'],
    roots: ['Nagy', 'Kov', 'Szab', 'Tót', 'Hor', 'Varg', 'Kis', 'Mol', 'Farkas', 'Balog', 'Pap', 'Luk', 'Simon', 'Fekete'],
    suf: ['', 'ács', 'ó', 'h', 'váth', 'a', 'nár', 'ai', 'os', 'ics'],
  },
  ro: {
    first: ['Andrei', 'Alexandru', 'Ionuț', 'Cristian', 'Florin', 'Răzvan', 'Mihai', 'Vlad', 'Bogdan', 'Adrian', 'Ciprian', 'Nicolae', 'Dorin', 'Marius', 'Denis'],
    roots: ['Pop', 'Ion', 'Dumitr', 'Stoic', 'Stan', 'Radu', 'Munt', 'Mar', 'Cost', 'Chir', 'Moldov', 'Vlăd', 'Tănas', 'Olar'],
    suf: ['escu', 'eanu', 'ache', 'ici', 'an', 'oiu', 'ea', 'ciuc', 'aru'],
  },
  fa: {
    first: ['Ali', 'Reza', 'Mehdi', 'Hossein', 'Saeid', 'Milad', 'Sardar', 'Alireza', 'Morteza', 'Ehsan', 'Karim', 'Javad', 'Majid', 'Omid', 'Vahid'],
    roots: ['Kar', 'Ahm', 'Moh', 'Rez', 'Heid', 'Tar', 'Jah', 'Nour', 'Hos', 'Gol', 'Rah', 'Sad', 'Kazem', 'Shoj'],
    suf: ['imi', 'adi', 'ammadi', 'aei', 'ari', 'emi', 'anbakhsh', 'ollahi', 'zadeh', 'ani', 'pour'],
  },
  kr: {
    first: ['Min-jun', 'Seo-jun', 'Ji-ho', 'Hyun-woo', 'Do-yun', 'Jun-seo', 'Woo-jin', 'Sung-min', 'Tae-hyun', 'Dong-hyun', 'Jae-won', 'Young-ho', 'Ji-hun', 'Sang-woo', 'Kyu-ri', 'Seung-ho'],
    surnames: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Yoo', 'Hong', 'Baek', 'Nam'],
  },
};

// skin tone palettes (card avatar only) by region, loose and varied
export const SKIN = {
  en: ['#f1c7a8', '#e6b08c', '#c68863', '#8d5a3b', '#5c3a24'],
  es: ['#e8b995', '#d9a37b', '#c08a62', '#9b6a45'],
  pt: ['#e8b995', '#c68863', '#9b6a45', '#6f4629', '#4d2f1c'],
  fr: ['#f1c7a8', '#d9a37b', '#8d5a3b', '#5c3a24', '#43291a'],
  de: ['#f3cdb0', '#e6b08c', '#c68863', '#8d5a3b'],
  it: ['#eec09c', '#d9a37b', '#c08a62'],
  nl: ['#f3cdb0', '#e6b08c', '#8d5a3b', '#5c3a24'],
  no: ['#f6d5bb', '#f1c7a8', '#e6b08c'],
  sl: ['#f3cdb0', '#eec09c', '#e6b08c'],
  af: ['#6f4629', '#5c3a24', '#4d2f1c', '#3b2416'],
  ar: ['#d9a37b', '#c08a62', '#9b6a45'],
  tr: ['#e6b08c', '#d9a37b', '#c08a62'],
  gr: ['#eec09c', '#d9a37b', '#c08a62'],
  jp: ['#f1d0b1', '#e8c29f', '#dcb48f'],
  kr: ['#f1d0b1', '#e8c29f', '#dcb48f'],
  hu: ['#f3cdb0', '#eec09c', '#e6b08c'],
  ro: ['#eec09c', '#e6b08c', '#d9a37b'],
  fa: ['#e6b08c', '#d9a37b', '#c08a62'],
};
/** Explicit skin-tone scale used by real-player cards (index 0 light .. 5 dark). */
export const SKIN_TONES = ['#f3cdb0', '#e6b08c', '#d09a70', '#a86f47', '#7a4b2c', '#4d2f1c'];

// ---------- fictional leagues & clubs ----------
// Each league: tier-1 (10 clubs) + tier-2 (8 clubs). Clubs listed strongest-first.
export const LEAGUES = [
  {
    id: 'ISL', name: 'Isles Premier Division', short: 'IPD', tier2Name: 'Isles Division One', country: 'ENG',
    home: [['ENG', 6], ['SCO', 1.5], ['WAL', 1], ['IRL', 1]], strength: 0, color: '#6c3cff',
    clubs: [
      ['Brackmoor United', '#B3001B', '#FFFFFF'], ['Kingsmoor City', '#6CABDD', '#1C2C5B'], ['Ravensholt Athletic', '#101820', '#E4B500'],
      ['Eastwyn Rovers', '#1D428A', '#FFFFFF'], ['Hartwick Albion', '#7A263A', '#8FD1F2'], ['Calderford Town', '#FFFFFF', '#101820'],
      ['Dunmere Wanderers', '#F28C28', '#101820'], ['Wrenfield County', '#00553F', '#FFFFFF'], ['Greyhaven FC', '#4B5A68', '#F2C230'],
      ['Oakhurst Harriers', '#8B1E3F', '#F4E3B2'],
      ['Stormley Athletic', '#0C2340', '#D9D9D6'], ['Pembrook City', '#E03A3E', '#FFFFFF'], ['Lynhaven Rovers', '#2E8B57', '#F5D130'],
      ['Westerby Town', '#3A0CA3', '#FFFFFF'], ['Fellbridge United', '#C8102E', '#1A1A1A'], ['Northgate Albion', '#004F9F', '#FFD100'],
      ['Ashcombe Vale', '#6B8E23', '#FFFFFF'], ['Marlow Heath FC', '#9C824A', '#1A1A1A'],
    ],
  },
  {
    id: 'SOL', name: 'Liga del Sol', short: 'LDS', tier2Name: 'Liga del Sol Segunda', country: 'ESP',
    home: [['ESP', 8], ['ARG', 0.5], ['URU', 0.3]], strength: 0, color: '#ff5b2e',
    clubs: [
      ['Real Valdoria', '#FFFFFF', '#6A1B9A'], ['Atlético Sierramar', '#D50032', '#FFFFFF'], ['CD Puerto Alba', '#004D98', '#A50044'],
      ['Racing Montelobo', '#00A650', '#FFFFFF'], ['UD Riosol', '#FFD100', '#0033A0'], ['Deportivo Almarena', '#0067B1', '#FFFFFF'],
      ['SD Castellar', '#1A1A1A', '#E30613'], ['CF Olivares', '#00843D', '#FFD200'], ['Real Toreno', '#7A1F3D', '#FFFFFF'],
      ['CD Peñaroja', '#D52B1E', '#1A1A1A'],
      ['UD Arenosa', '#F2A900', '#1A1A1A'], ['Atlético Brisamar', '#00A3E0', '#FFFFFF'], ['CD Marbuena', '#8A1538', '#FFD100'],
      ['SD Zafrena', '#006341', '#FFFFFF'], ['Racing Calderón', '#003DA5', '#FFD100'], ['CF Villaverde Alta', '#E4002B', '#FFFFFF'],
      ['UD San Telmo', '#5B2C83', '#F2C75C'], ['Deportivo Costanera', '#0085CA', '#1A1A1A'],
    ],
  },
  {
    id: 'MEI', name: 'Meisterliga', short: 'MSL', tier2Name: 'Meisterliga Zwei', country: 'GER',
    home: [['GER', 7], ['AUT', 1.5], ['SUI', 1]], strength: -1, color: '#e8002d',
    clubs: [
      ['FC Falkenstadt', '#DC052D', '#FFFFFF'], ['SV Adlerhof', '#FDE100', '#1A1A1A'], ['1. FC Wolfsheide', '#65B32E', '#FFFFFF'],
      ['TSV Eisenfurt', '#005CA9', '#FFFFFF'], ['SC Tannental', '#1A1A1A', '#E1000F'], ['VfR Donnerfeld', '#FFFFFF', '#E32219'],
      ['Union Schwarzmoor', '#2A2A2A', '#F9D71C'], ['FC Kronwald', '#00843D', '#FFFFFF'], ['SV Weißenried', '#0055A4', '#8EC6EA'],
      ['Sportfreunde Bärental', '#8B0000', '#FFFFFF'],
      ['FC Nordhavel', '#1D3F8C', '#FFFFFF'], ['SC Sonnenried', '#F7A600', '#1A1A1A'], ['TSV Rabenburg', '#3C3C3C', '#FFFFFF'],
      ['VfR Lindenau', '#006F3C', '#F2E500'], ['SV Hohenmark', '#C8102E', '#1A1A1A'], ['FC Kaltenbach', '#6CACE4', '#FFFFFF'],
      ['Union Sturmhafen', '#003B6F', '#E30613'], ['SC Grünwaldstadt', '#2E7D32', '#FFFFFF'],
    ],
  },
  {
    id: 'AUR', name: 'Lega Aurea', short: 'LAU', tier2Name: 'Lega Argento', country: 'ITA',
    home: [['ITA', 8], ['CRO', 0.4], ['SRB', 0.3]], strength: -1, color: '#00a3e0',
    clubs: [
      ['AC Montevaro', '#000000', '#FFFFFF'], ['Virtus Portolira', '#0068A8', '#1A1A1A'], ['US Castelbruno', '#FB090B', '#1A1A1A'],
      ['SS Valmareno', '#87D8F7', '#FFFFFF'], ['Calcio Torrelunga', '#8E1F2F', '#F0BC42'], ['AC Aquabella', '#7B2482', '#FFFFFF'],
      ['FC Ferranova', '#003DA5', '#FFFFFF'], ['US Lunaria', '#FFFFFF', '#1A1A1A'], ['Sporting Pietrafonda', '#FF6600', '#003D7C'],
      ['AC Vallombra', '#1B5E20', '#FFFFFF'],
      ['US Serravetta', '#E30613', '#FFD100'], ['Calcio Casalverde', '#009246', '#FFFFFF'], ['SS Monteroso', '#B01C2E', '#FFFFFF'],
      ['FC Portoceleste', '#5CB7E6', '#1F2A5A'], ['Virtus Fiumara', '#F5D130', '#1F2A5A'], ['AC Rocca d\'Oro', '#D4AF37', '#1A1A1A'],
      ['US San Ciriaco', '#6A0DAD', '#F5D130'], ['Calcio Sabbiadoro', '#EDC9AF', '#7A263A'],
    ],
  },
  {
    id: 'ETO', name: 'Ligue Étoile', short: 'LET', tier2Name: 'Ligue Étoile Deux', country: 'FRA',
    home: [['FRA', 7], ['BEL', 1.5], ['SEN', 0.8], ['CIV', 0.8], ['CMR', 0.6], ['MAR', 0.6]], strength: -2, color: '#dafc00',
    clubs: [
      ['Olympique Belrivage', '#004170', '#DA291C'], ['AS Hautemont', '#FFFFFF', '#2FAEE0'], ['Stade Port-Lumière', '#DA291C', '#1A1A1A'],
      ['FC Chanteval', '#1A1A1A', '#FFFFFF'], ['RC Fontbrune', '#FFD700', '#D52B1E'], ['SC Roche-Mauve', '#6A2C91', '#FFFFFF'],
      ['US Vaudrelle', '#00843D', '#FFFFFF'], ['AS Grisemont', '#A6A6A6', '#003B6F'], ['Stade Aubelle', '#C8102E', '#FFFFFF'],
      ['FC Corvenne', '#1F4E9E', '#F2C230'],
      ['Olympique Lorvaux', '#EE7F00', '#1A1A1A'], ['RC Ambrelune', '#FFB81C', '#6A2C91'], ['US Sainte-Orane', '#009FE3', '#FFFFFF'],
      ['SC Val-Doré', '#D4AF37', '#003B6F'], ['AS Beaufort-la-Rive', '#00563F', '#E4002B'], ['FC Saint-Aubrac', '#B22222', '#FFFFFF'],
      ['Stade Lyssac', '#2B2B2B', '#E4B500'], ['US Mirebelle', '#E2007A', '#1A1A1A'],
    ],
  },
  {
    id: 'CON', name: 'Liga Continental', short: 'LCO', tier2Name: 'Liga Continental B', country: 'BRA',
    home: [['BRA', 4], ['ARG', 3], ['URU', 1], ['COL', 1.2], ['CHI', 0.8], ['MEX', 1], ['ECU', 0.6], ['USA', 0.5]], strength: -2, color: '#00e38c',
    clubs: [
      ['Esporte Clube Serra Dourada', '#006437', '#FFFFFF'], ['Club Atlético Pampa Alta', '#0033A0', '#FFD100'], ['Deportivo Cerro Azul', '#1A1A1A', '#00A3E0'],
      ['Sport Club Maré Verde', '#00A859', '#FFFFFF'], ['Unión Río Plateado', '#FFFFFF', '#C8102E'], ['Atlético Estrella Andina', '#E30613', '#FFFFFF'],
      ['Esporte Clube Vila Aurora', '#F58220', '#1A1A1A'], ['Racing Puerto Coral', '#6CACE4', '#FFFFFF'], ['CA Colinas del Sur', '#8B0000', '#1A1A1A'],
      ['Sport Club Pedra Alta', '#1A1A1A', '#FFFFFF'],
      ['Deportivo Mar Serena', '#0072CE', '#FFFFFF'], ['Unión Llanura Roja', '#C8102E', '#FFD100'], ['Esporte Clube Barra Dourada', '#FFCC00', '#003B8E'],
      ['Atlético Quebrada Verde', '#2E7D32', '#1A1A1A'], ['CA Tres Ríos', '#7F2A8A', '#FFFFFF'], ['Sport Club São Luar', '#1F2A5A', '#EFEFEF'],
      ['Racing Cumbre Nevada', '#9FC5E8', '#1F2A5A'], ['Unión Santa Brisa', '#E4002B', '#00843D'],
    ],
  },
];

export const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));

const SHORT_SKIP = new Set(['FC', 'AC', 'AS', 'US', 'SS', 'SC', 'SV', 'CD', 'UD', 'SD', 'CF', 'RC', 'CA', 'TSV', 'VFR', '1.', 'REAL', 'CLUB', 'ATLÉTICO', 'ATHLETIC', 'UNITED', 'CITY', 'TOWN', 'ROVERS', 'ALBION', 'COUNTY', 'WANDERERS', 'HARRIERS', 'VALE', 'RACING', 'DEPORTIVO', 'SPORTING', 'VIRTUS', 'CALCIO', 'UNION', 'UNIÓN', 'STADE', 'OLYMPIQUE', 'ESPORTE', 'CLUBE', 'SPORT', 'SPORTFREUNDE']);

function makeShort(name, used) {
  const words = name.replace(/[^\p{L}\s'-]/gu, ' ').split(/[\s-]+/).filter(Boolean);
  const core = words.filter((w) => !SHORT_SKIP.has(w.toUpperCase()) && !['del', 'de', 'la', 'do', 'da', "d'Oro"].includes(w));
  const base = (core[0] || words[words.length - 1] || 'XXX').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  const tries = [base.slice(0, 3), base[0] + base.slice(2, 4), base[0] + base[1] + base[base.length - 1], base[0] + base.slice(-2)];
  if (core[1]) tries.push((base[0] + core[1][0] + (core[1][1] || 'X')).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase());
  for (const t of tries) if (t.length === 3 && !used.has(t)) { used.add(t); return t; }
  let i = 0; while (used.has(base.slice(0, 2) + i)) i++;
  used.add(base.slice(0, 2) + i); return base.slice(0, 2) + i;
}

// Club list: id, name, short, league, tier, rep (1..5 stars), colours, target overall
function buildClubs() {
  const out = [];
  const used = new Set(NATIONS.map((n) => n.code));
  const t1Target = [84, 82, 80, 78, 77, 76, 75, 74, 73, 72];
  const t2Target = [70, 69, 68, 67, 66, 65, 64, 63];
  for (const lg of LEAGUES) {
    lg.clubs.forEach(([name, c1, c2], i) => {
      const tier = i < 10 ? 1 : 2;
      const target = (tier === 1 ? t1Target[i] : t2Target[i - 10]) + lg.strength;
      const rep = Math.max(1, Math.min(5, Math.round(((target - 58) / 26) * 5 * 2) / 2));
      out.push({
        id: `${lg.id}${String(i + 1).padStart(2, '0')}`,
        name, short: makeShort(name, used), league: lg.id, tier, rep, target,
        colors: { primary: c1, secondary: c2 },
      });
    });
  }
  return out;
}

export const CLUBS = buildClubs();
export const CLUB_BY_ID = Object.fromEntries(CLUBS.map((c) => [c.id, c]));

// Pseudo-clubs for special cards
export const SPECIAL_CLUBS = {
  LEG: { id: 'LEG', name: 'Pitchside Legends', short: 'LEG', league: 'LEG', tier: 0, rep: 5, colors: { primary: '#F4E8C1', secondary: '#B8860B' } },
  HER: { id: 'HER', name: 'Pitchside Heroes', short: 'HER', league: 'HER', tier: 0, rep: 5, colors: { primary: '#3A1C71', secondary: '#27E1C1' } },
  ICN: { id: 'ICN', name: 'Legends of the Game', short: 'LOG', league: 'ICN', tier: 0, rep: 5, colors: { primary: '#111111', secondary: '#D4AF37' } },
};
/** Pseudo clubs that never give club chemistry. */
export const SPECIAL_CLUB_IDS = new Set(Object.keys(SPECIAL_CLUBS));
export function clubById(id) { return CLUB_BY_ID[id] || SPECIAL_CLUBS[id] || null; }
export function leagueName(id) {
  if (id === 'LEG') return 'Legends';
  if (id === 'HER') return 'Heroes';
  if (id === 'ICN') return 'Legends of the Game';
  return LEAGUE_BY_ID[id] ? LEAGUE_BY_ID[id].name : id;
}

export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
export const POS_GROUP = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'ATT', RW: 'ATT', ST: 'ATT', CF: 'ATT',
};
