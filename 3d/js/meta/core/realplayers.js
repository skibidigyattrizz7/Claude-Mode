// V2: real footballers (requested by the owner). Retired greats are ICON cards (one prime version each),
// currently active players are STAR cards (current-ish ratings). Clubs remain fictional: Stars are placed at
// fictional clubs, Icons play for the special "Pitchside Icons" club. DOM-free and fully deterministic
// (no shared RNG is consumed, so the generated database and existing saves are unaffected).
import { Rng, clamp, hashStr } from './rng.js';
import { CLUBS } from './data.js';
import { parseStyles, genPhysique, styleCountRange, maxPlus, PLAYSTYLES } from './physique.js';
import { REG_ROWS } from './realregulars.js';

// Row: [slug, full name, card name, nation, pos, alt positions, foot, weak foot, skill moves, OVR,
//       face stats (outfield: pac sho pas dri def phy | GK: div han kic ref spd pos), age, height, skin tone 0..5, extra]
// extra: { hs: hair style override, lg: league for Star club placement }
// ---------- Icons (retired; prime versions) ----------
const ICON_ROWS = [
  ['pele', 'Pelé', 'Pelé', 'BRA', 'CF', ['ST', 'CAM'], 'R', 4, 5, 98, [95, 96, 93, 96, 60, 78], 29, 173, 5],
  ['maradona', 'Diego Maradona', 'Maradona', 'ARG', 'CAM', ['CF', 'ST'], 'L', 3, 5, 97, [91, 93, 94, 97, 40, 76], 26, 165, 2],
  ['messi_icon', 'Lionel Messi', 'Messi', 'ARG', 'RW', ['CF', 'CAM'], 'L', 4, 4, 97, [93, 94, 92, 97, 38, 68], 25, 170, 1],
  ['ronaldo_icon', 'Cristiano Ronaldo', 'C. Ronaldo', 'POR', 'ST', ['LW', 'CF'], 'R', 4, 5, 96, [95, 96, 82, 92, 35, 84], 29, 187, 2],
  ['nazario', 'Ronaldo Nazário', 'Ronaldo', 'BRA', 'ST', ['CF'], 'R', 4, 5, 96, [97, 96, 81, 96, 45, 84], 21, 183, 3, { hs: 2 }],
  ['cruyff', 'Johan Cruyff', 'Cruyff', 'NED', 'CF', ['CAM', 'LW', 'ST'], 'R', 4, 5, 96, [92, 90, 92, 95, 42, 72], 27, 178, 0],
  ['distefano', 'Alfredo Di Stéfano', 'Di Stéfano', 'ARG', 'CF', ['ST', 'CAM'], 'R', 4, 4, 95, [89, 93, 89, 92, 55, 84], 30, 178, 1],
  ['beckenbauer', 'Franz Beckenbauer', 'Beckenbauer', 'GER', 'CB', ['CDM', 'CM'], 'R', 4, 3, 95, [80, 70, 88, 85, 94, 84], 29, 181, 0],
  ['zidane', 'Zinedine Zidane', 'Zidane', 'FRA', 'CAM', ['CM', 'CF'], 'R', 4, 5, 95, [80, 88, 94, 95, 70, 82], 30, 185, 2, { hs: 2 }],
  ['best', 'George Best', 'Best', 'NIR', 'RW', ['LW', 'CF'], 'R', 5, 5, 93, [94, 88, 85, 95, 40, 70], 24, 175, 0],
  ['platini', 'Michel Platini', 'Platini', 'FRA', 'CAM', ['CM', 'CF'], 'R', 4, 4, 94, [80, 92, 93, 91, 50, 70], 29, 179, 0],
  ['ronaldinho', 'Ronaldinho', 'Ronaldinho', 'BRA', 'CAM', ['LW', 'CF'], 'R', 4, 5, 94, [91, 91, 91, 96, 37, 80], 26, 182, 4],
  ['maldini', 'Paolo Maldini', 'Maldini', 'ITA', 'CB', ['LB'], 'R', 4, 2, 95, [85, 55, 74, 72, 96, 86], 28, 186, 1],
  ['garrincha', 'Garrincha', 'Garrincha', 'BRA', 'RW', ['RM'], 'R', 4, 5, 94, [94, 84, 84, 96, 37, 70], 28, 169, 3],
  ['yashin', 'Lev Yashin', 'Yashin', 'RUS', 'GK', [], 'R', 3, 1, 94, [94, 92, 80, 95, 65, 94], 30, 189, 0],
  ['matthews', 'Stanley Matthews', 'Matthews', 'ENG', 'RW', ['RM'], 'R', 4, 5, 90, [89, 72, 88, 94, 35, 65], 30, 175, 0],
  ['baggio', 'Roberto Baggio', 'Baggio', 'ITA', 'CF', ['CAM', 'ST'], 'R', 4, 5, 93, [86, 92, 88, 93, 40, 66], 27, 174, 1],
  ['henry', 'Thierry Henry', 'Henry', 'FRA', 'ST', ['LW', 'CF'], 'R', 4, 4, 94, [96, 92, 84, 92, 40, 78], 27, 188, 4, { hs: 2 }],
  ['vanbasten', 'Marco van Basten', 'Van Basten', 'NED', 'ST', ['CF'], 'R', 4, 4, 94, [86, 96, 80, 89, 42, 82], 25, 188, 0],
  ['xavi', 'Xavi Hernández', 'Xavi', 'ESP', 'CM', ['CDM', 'CAM'], 'R', 4, 4, 93, [72, 76, 96, 91, 66, 68], 30, 170, 1],
  ['iniesta', 'Andrés Iniesta', 'Iniesta', 'ESP', 'CM', ['CAM', 'LW'], 'R', 4, 4, 93, [80, 78, 93, 95, 60, 68], 28, 171, 0, { hs: 5 }],
  ['figo', 'Luís Figo', 'Figo', 'POR', 'RW', ['RM', 'CAM'], 'R', 4, 5, 92, [87, 84, 90, 92, 40, 75], 28, 180, 1],
  ['romario', 'Romário', 'Romário', 'BRA', 'ST', ['CF'], 'R', 3, 4, 92, [90, 93, 78, 92, 32, 65], 28, 167, 3],
  ['eusebio', 'Eusébio', 'Eusébio', 'POR', 'ST', ['CF'], 'R', 4, 4, 93, [93, 94, 80, 91, 35, 80], 24, 175, 5],
  ['rummenigge', 'Karl-Heinz Rummenigge', 'Rummenigge', 'GER', 'ST', ['RW', 'CF'], 'R', 4, 4, 91, [90, 91, 80, 88, 40, 78], 26, 182, 0],
  ['cannavaro', 'Fabio Cannavaro', 'Cannavaro', 'ITA', 'CB', [], 'R', 3, 2, 91, [80, 45, 68, 70, 93, 84], 32, 176, 1],
  ['casillas', 'Iker Casillas', 'Casillas', 'ESP', 'GK', [], 'L', 3, 1, 91, [91, 86, 78, 93, 62, 88], 27, 185, 1],
  ['raul', 'Raúl González', 'Raúl', 'ESP', 'ST', ['CF', 'LW'], 'L', 3, 4, 90, [84, 90, 82, 88, 42, 74], 25, 180, 1],
  ['rossi', 'Paolo Rossi', 'Rossi', 'ITA', 'ST', ['CF'], 'R', 3, 4, 89, [85, 91, 76, 87, 35, 62], 26, 174, 1],
  ['robertocarlos', 'Roberto Carlos', 'Roberto Carlos', 'BRA', 'LB', ['LWB', 'LM'], 'L', 2, 4, 91, [94, 82, 85, 84, 82, 86], 28, 168, 4, { hs: 2 }],
  ['hagi', 'Gheorghe Hagi', 'Hagi', 'ROU', 'CAM', ['CF', 'LW'], 'L', 3, 4, 91, [82, 88, 91, 91, 40, 70], 29, 174, 1],
  ['ibrahimovic', 'Zlatan Ibrahimović', 'Ibrahimović', 'SWE', 'ST', ['CF'], 'R', 4, 5, 93, [82, 93, 84, 90, 40, 90], 31, 195, 2],
  ['lampard', 'Frank Lampard', 'Lampard', 'ENG', 'CM', ['CAM'], 'R', 4, 3, 91, [76, 90, 88, 84, 70, 80], 27, 184, 0],
  ['gerrard', 'Steven Gerrard', 'Gerrard', 'ENG', 'CM', ['CAM', 'CDM'], 'R', 4, 3, 91, [80, 90, 90, 85, 74, 84], 25, 183, 0],
  ['beckham', 'David Beckham', 'Beckham', 'ENG', 'RM', ['CM', 'RW'], 'R', 3, 3, 90, [78, 84, 94, 84, 60, 74], 27, 183, 0],
  ['seedorf', 'Clarence Seedorf', 'Seedorf', 'NED', 'CM', ['CAM', 'CDM'], 'R', 5, 4, 90, [78, 84, 89, 88, 72, 82], 27, 176, 4],
  ['danialves', 'Dani Alves', 'Dani Alves', 'BRA', 'RB', ['RWB', 'RM'], 'R', 3, 4, 89, [88, 70, 86, 86, 80, 76], 28, 172, 3],
  ['vieira', 'Patrick Vieira', 'Vieira', 'FRA', 'CDM', ['CM'], 'R', 3, 3, 92, [80, 74, 84, 82, 88, 90], 26, 192, 5],
  ['koeman', 'Ronald Koeman', 'Koeman', 'NED', 'CB', ['CDM'], 'R', 3, 2, 90, [66, 86, 90, 74, 88, 82], 27, 181, 0],
  ['facchetti', 'Giacinto Facchetti', 'Facchetti', 'ITA', 'LB', ['LWB', 'CB'], 'L', 3, 2, 90, [86, 72, 78, 78, 89, 84], 28, 191, 1],
  ['lahm', 'Philipp Lahm', 'Lahm', 'GER', 'RB', ['LB', 'CDM', 'RWB'], 'R', 4, 3, 91, [85, 64, 85, 86, 90, 70], 30, 170, 0],
  ['zanetti', 'Javier Zanetti', 'Zanetti', 'ARG', 'RB', ['RWB', 'CDM', 'LB'], 'R', 4, 3, 90, [84, 62, 82, 82, 88, 84], 29, 178, 1],
  ['kocsis', 'Sándor Kocsis', 'Kocsis', 'HUN', 'ST', ['CF'], 'R', 4, 3, 90, [84, 93, 76, 85, 38, 82], 26, 177, 0],
  ['fontaine', 'Just Fontaine', 'Fontaine', 'FRA', 'ST', [], 'R', 3, 3, 90, [88, 93, 72, 86, 35, 72], 25, 174, 1],
  ['cubillas', 'Teófilo Cubillas', 'Cubillas', 'PER', 'CAM', ['CF'], 'R', 4, 4, 89, [84, 89, 88, 90, 38, 70], 29, 172, 3],
  ['kempes', 'Mario Kempes', 'Kempes', 'ARG', 'ST', ['CF'], 'L', 3, 4, 90, [86, 91, 80, 88, 40, 80], 24, 184, 1],
  ['johnstone', 'Jimmy Johnstone', 'Johnstone', 'SCO', 'RW', ['RM'], 'R', 3, 5, 88, [89, 76, 82, 93, 32, 58], 25, 162, 0],
  ['cantona', 'Eric Cantona', 'Cantona', 'FRA', 'CF', ['ST'], 'R', 4, 4, 91, [80, 91, 86, 88, 45, 86], 27, 188, 1],
  ['delpiero', 'Alessandro Del Piero', 'Del Piero', 'ITA', 'CF', ['ST', 'LW'], 'R', 4, 4, 92, [85, 91, 88, 92, 35, 68], 24, 174, 1],
  ['totti', 'Francesco Totti', 'Totti', 'ITA', 'CAM', ['CF', 'ST'], 'R', 4, 4, 92, [80, 90, 91, 90, 40, 80], 30, 180, 1],
  ['forlan', 'Diego Forlán', 'Forlán', 'URU', 'ST', ['CF'], 'R', 5, 3, 89, [84, 92, 82, 85, 40, 76], 31, 172, 0],
  ['rivaldo', 'Rivaldo', 'Rivaldo', 'BRA', 'CAM', ['LW', 'CF'], 'L', 3, 5, 92, [86, 91, 86, 92, 40, 80], 27, 186, 3],
  ['laudrup', 'Michael Laudrup', 'Laudrup', 'DEN', 'CAM', ['CF', 'CM'], 'R', 4, 5, 91, [84, 82, 93, 93, 38, 66], 27, 183, 0],
  ['neeskens', 'Johan Neeskens', 'Neeskens', 'NED', 'CM', ['CDM', 'CAM'], 'R', 3, 3, 89, [80, 80, 86, 84, 82, 84], 23, 177, 0],
  ['stoichkov', 'Hristo Stoichkov', 'Stoichkov', 'BUL', 'ST', ['LW', 'CF'], 'L', 3, 4, 91, [88, 91, 84, 90, 40, 78], 28, 178, 1],
  ['drogba', 'Didier Drogba', 'Drogba', 'CIV', 'ST', [], 'R', 3, 3, 91, [85, 90, 72, 84, 38, 92], 32, 189, 5],
  ['scholes', 'Paul Scholes', 'Scholes', 'ENG', 'CM', ['CAM'], 'R', 4, 3, 90, [70, 86, 91, 84, 70, 74], 28, 168, 0],
  ['nordahl', 'Gunnar Nordahl', 'Nordahl', 'SWE', 'ST', [], 'R', 3, 3, 90, [82, 93, 72, 82, 40, 88], 28, 181, 0],
  ['robben', 'Arjen Robben', 'Robben', 'NED', 'RW', ['RM', 'LW'], 'L', 2, 4, 91, [93, 88, 84, 92, 36, 70], 27, 180, 0, { hs: 2 }],
  ['meireles', 'Raul Meireles', 'Meireles', 'POR', 'CM', ['CDM'], 'R', 3, 3, 86, [75, 76, 83, 80, 74, 80], 28, 179, 1],
  ['fernandinho', 'Fernandinho', 'Fernandinho', 'BRA', 'CDM', ['CM', 'CB'], 'R', 3, 3, 87, [70, 70, 82, 78, 86, 84], 30, 179, 4],
  ['kroos', 'Toni Kroos', 'Kroos', 'GER', 'CM', ['CDM'], 'R', 5, 3, 91, [60, 82, 95, 84, 70, 72], 28, 183, 0],
  ['rakitic', 'Ivan Rakitić', 'Rakitić', 'CRO', 'CM', ['CDM', 'CAM'], 'R', 3, 3, 87, [70, 82, 88, 84, 70, 72], 27, 184, 0],
  ['busquets', 'Sergio Busquets', 'Busquets', 'ESP', 'CDM', ['CM'], 'R', 3, 3, 89, [58, 62, 86, 82, 86, 78], 27, 189, 1],
  ['buffon', 'Gianluigi Buffon', 'Buffon', 'ITA', 'GK', [], 'R', 3, 1, 93, [92, 90, 80, 93, 60, 93], 28, 192, 1],
  ['kaka', 'Kaká', 'Kaká', 'BRA', 'CAM', ['CF', 'CM'], 'R', 4, 4, 93, [91, 88, 88, 91, 42, 78], 25, 186, 1],
  ['mancini', 'Roberto Mancini', 'Mancini', 'ITA', 'CF', ['ST', 'CAM'], 'R', 3, 4, 87, [80, 86, 86, 88, 40, 70], 26, 175, 1],
  ['sukur', 'Hakan Şükür', 'Şükür', 'TUR', 'ST', [], 'R', 3, 3, 87, [74, 88, 72, 78, 40, 86], 30, 191, 1],
  ['rooney', 'Wayne Rooney', 'Rooney', 'ENG', 'ST', ['CF', 'CAM'], 'R', 4, 4, 91, [84, 90, 86, 87, 54, 86], 25, 176, 0],
  ['nesta', 'Alessandro Nesta', 'Nesta', 'ITA', 'CB', [], 'R', 3, 2, 92, [80, 40, 68, 70, 94, 84], 26, 187, 1],
  ['campbell', 'Sol Campbell', 'Campbell', 'ENG', 'CB', [], 'R', 3, 2, 88, [78, 45, 60, 62, 90, 90], 28, 188, 5],
  ['kluivert', 'Patrick Kluivert', 'Kluivert', 'NED', 'ST', ['CF'], 'R', 4, 4, 88, [80, 89, 78, 85, 40, 85], 24, 188, 4],
  ['zoff', 'Dino Zoff', 'Zoff', 'ITA', 'GK', [], 'R', 3, 1, 91, [89, 90, 78, 90, 55, 93], 30, 182, 1],
  ['socrates', 'Sócrates', 'Sócrates', 'BRA', 'CAM', ['CM', 'CF'], 'R', 5, 4, 91, [80, 88, 92, 88, 55, 78], 28, 192, 2],
  ['cafu', 'Cafu', 'Cafu', 'BRA', 'RB', ['RWB', 'RM'], 'R', 3, 3, 91, [90, 62, 82, 84, 86, 84], 28, 176, 4, { hs: 2 }],
  ['matthaus', 'Lothar Matthäus', 'Matthäus', 'GER', 'CM', ['CDM', 'CB'], 'R', 4, 3, 93, [82, 86, 89, 85, 86, 86], 29, 174, 0],
  ['passarella', 'Daniel Passarella', 'Passarella', 'ARG', 'CB', ['CDM'], 'R', 3, 2, 90, [72, 72, 74, 70, 92, 86], 25, 173, 1],
  ['hierro', 'Fernando Hierro', 'Hierro', 'ESP', 'CB', ['CDM'], 'R', 3, 2, 89, [68, 76, 82, 70, 90, 86], 30, 187, 1],
  ['mascherano', 'Javier Mascherano', 'Mascherano', 'ARG', 'CDM', ['CB'], 'R', 3, 2, 87, [72, 58, 78, 74, 88, 84], 26, 174, 1],
  ['villa', 'David Villa', 'Villa', 'ESP', 'ST', ['LW', 'CF'], 'R', 4, 4, 89, [86, 90, 76, 86, 36, 68], 28, 175, 1],
  ['lineker', 'Gary Lineker', 'Lineker', 'ENG', 'ST', [], 'R', 3, 3, 89, [86, 90, 72, 82, 30, 68], 26, 177, 0],
  ['bagheri', 'Karim Bagheri', 'Bagheri', 'IRN', 'CM', ['CAM', 'CDM'], 'R', 3, 3, 86, [74, 86, 82, 80, 70, 82], 26, 186, 2],
  ['deschamps', 'Didier Deschamps', 'Deschamps', 'FRA', 'CDM', ['CM'], 'R', 3, 2, 87, [70, 62, 82, 76, 86, 80], 28, 174, 1],
  ['petit', 'Emmanuel Petit', 'Petit', 'FRA', 'CDM', ['CM', 'CB'], 'L', 3, 2, 87, [72, 74, 84, 78, 84, 82], 28, 185, 0],
  ['futre', 'Paulo Futre', 'Futre', 'POR', 'LW', ['CAM'], 'L', 3, 5, 87, [90, 82, 82, 91, 32, 62], 21, 172, 1],
  ['bonev', 'Hristo Bonev', 'Bonev', 'BUL', 'CAM', ['CF', 'ST'], 'R', 3, 4, 86, [80, 86, 84, 86, 40, 74], 28, 180, 1],
  ['clemence', 'Ray Clemence', 'Clemence', 'ENG', 'GK', [], 'L', 3, 1, 88, [87, 88, 78, 89, 55, 90], 28, 183, 0],
];

// ---------- Stars (active; current-ish ratings) ----------
const STAR_ROWS = [
  ['messi', 'Lionel Messi', 'Messi', 'ARG', 'RW', ['CF', 'CAM'], 'L', 4, 4, 86, [72, 86, 89, 89, 33, 64], 39, 170, 1, { lg: 'CON' }],
  ['ronaldo', 'Cristiano Ronaldo', 'C. Ronaldo', 'POR', 'ST', ['LW'], 'R', 4, 5, 85, [78, 90, 76, 80, 34, 77], 41, 187, 2, { lg: 'CON' }],
  ['neymar', 'Neymar Jr.', 'Neymar Jr', 'BRA', 'LW', ['CAM'], 'R', 5, 5, 82, [80, 82, 84, 88, 35, 60], 34, 175, 3, { lg: 'CON' }],
  ['mbappe', 'Kylian Mbappé', 'Mbappé', 'FRA', 'ST', ['LW'], 'R', 4, 5, 91, [97, 90, 81, 92, 37, 77], 27, 178, 4, { lg: 'SOL', hs: 2 }],
  ['salah', 'Mohamed Salah', 'Salah', 'EGY', 'RW', ['RM'], 'L', 3, 4, 89, [89, 88, 86, 89, 45, 76], 34, 175, 3, { lg: 'ISL' }],
  ['debruyne', 'Kevin De Bruyne', 'De Bruyne', 'BEL', 'CM', ['CAM'], 'R', 5, 4, 87, [70, 86, 93, 86, 63, 74], 35, 181, 0, { lg: 'AUR' }],
  ['modric', 'Luka Modrić', 'Modrić', 'CRO', 'CM', ['CAM', 'CDM'], 'R', 4, 4, 83, [70, 76, 88, 87, 70, 68], 40, 172, 0, { lg: 'AUR' }],
  ['lukaku', 'Romelu Lukaku', 'Lukaku', 'BEL', 'ST', [], 'L', 3, 3, 82, [78, 84, 72, 77, 38, 86], 33, 191, 5, { lg: 'AUR' }],
  ['neuer', 'Manuel Neuer', 'Neuer', 'GER', 'GK', [], 'R', 4, 1, 86, [85, 84, 90, 87, 58, 86], 40, 193, 0, { lg: 'MEI' }],
  ['benzema', 'Karim Benzema', 'Benzema', 'FRA', 'ST', ['CF'], 'R', 4, 4, 85, [74, 87, 82, 85, 38, 78], 38, 185, 2, { lg: 'ETO', hs: 2 }],
  ['ramos', 'Sergio Ramos', 'Ramos', 'ESP', 'CB', ['RB'], 'R', 3, 3, 82, [62, 64, 72, 68, 84, 82], 40, 184, 1, { lg: 'CON' }],
  ['cavani', 'Edinson Cavani', 'Cavani', 'URU', 'ST', [], 'R', 4, 3, 78, [66, 80, 68, 72, 45, 78], 39, 184, 1, { lg: 'CON' }],
];

// slug -> [weight kg, PlayStyles ('+' suffix = PlayStyle+)]
const PHYS = {
  pele: [73, ['finesse+', 'acrobatic+', 'technical', 'powerheader']],
  maradona: [70, ['technical+', 'trickster+', 'finesse', 'firsttouch']],
  messi_icon: [72, ['finesse+', 'tikitaka+', 'technical', 'firsttouch']],
  ronaldo_icon: [83, ['power+', 'powerheader+', 'acrobatic', 'rapid']],
  nazario: [82, ['rapid+', 'technical+', 'finesse', 'trickster']],
  cruyff: [70, ['technical+', 'incisive+', 'flair', 'firsttouch']],
  distefano: [76, ['finesse+', 'relentless', 'incisive', 'powerheader']],
  beckenbauer: [75, ['anticipate+', 'longball+', 'intercept', 'pressproven']],
  zidane: [80, ['technical+', 'firsttouch+', 'flair', 'pressproven']],
  best: [65, ['trickster+', 'technical+', 'rapid', 'finesse']],
  platini: [73, ['deadball+', 'incisive+', 'finesse', 'tikitaka']],
  ronaldinho: [80, ['trickster+', 'flair+', 'finesse', 'deadball']],
  maldini: [83, ['anticipate+', 'jockey+', 'slidetackle', 'intercept']],
  garrincha: [72, ['trickster+', 'rapid+', 'technical', 'whipped']],
  yashin: [82, ['farreach+', 'quickreflexes+', 'crossclaimer', 'rushout']],
  matthews: [70, ['trickster+', 'whipped+', 'technical']],
  baggio: [73, ['finesse+', 'deadball+', 'technical', 'firsttouch']],
  henry: [83, ['finesse+', 'rapid+', 'quickstep', 'technical']],
  vanbasten: [80, ['acrobatic+', 'finesse+', 'powerheader', 'firsttouch']],
  xavi: [68, ['tikitaka+', 'incisive+', 'pressproven', 'firsttouch']],
  iniesta: [68, ['technical+', 'pressproven+', 'tikitaka', 'incisive']],
  figo: [75, ['whipped+', 'technical+', 'trickster', 'finesse']],
  romario: [70, ['finesse+', 'chip+', 'quickstep', 'firsttouch']],
  eusebio: [73, ['power+', 'rapid+', 'finesse', 'quickstep']],
  rummenigge: [77, ['finesse+', 'power', 'rapid', 'acrobatic']],
  cannavaro: [75, ['anticipate+', 'slidetackle+', 'intercept', 'jockey']],
  casillas: [84, ['quickreflexes+', 'farreach+', 'rushout']],
  raul: [73, ['finesse+', 'chip', 'firsttouch']],
  rossi: [66, ['acrobatic+', 'lowdriven', 'firsttouch']],
  robertocarlos: [70, ['power+', 'rapid+', 'whipped', 'relentless']],
  hagi: [72, ['finesse+', 'deadball+', 'incisive', 'technical']],
  ibrahimovic: [95, ['acrobatic+', 'power+', 'bruiser', 'firsttouch']],
  lampard: [88, ['power+', 'lowdriven+', 'relentless', 'incisive']],
  gerrard: [83, ['power+', 'pinged+', 'longball', 'relentless']],
  beckham: [75, ['whipped+', 'deadball+', 'longball']],
  seedorf: [76, ['power+', 'pressproven+', 'incisive']],
  danialves: [70, ['whipped+', 'relentless', 'technical']],
  vieira: [83, ['intercept+', 'bruiser+', 'relentless', 'pressproven']],
  koeman: [82, ['deadball+', 'power+', 'longball', 'aerial']],
  facchetti: [85, ['jockey+', 'relentless+', 'aerial', 'intercept']],
  lahm: [66, ['jockey+', 'intercept+', 'tikitaka', 'relentless']],
  zanetti: [75, ['relentless+', 'jockey+', 'intercept']],
  kocsis: [76, ['powerheader+', 'finesse+', 'lowdriven']],
  fontaine: [70, ['lowdriven+', 'finesse+', 'quickstep']],
  cubillas: [72, ['deadball+', 'finesse', 'technical']],
  kempes: [78, ['power+', 'finesse+', 'rapid']],
  johnstone: [60, ['trickster+', 'technical', 'rapid']],
  cantona: [88, ['flair+', 'power+', 'chip', 'firsttouch']],
  delpiero: [73, ['finesse+', 'deadball+', 'technical', 'chip']],
  totti: [82, ['incisive+', 'chip+', 'finesse', 'flair']],
  forlan: [75, ['power+', 'deadball', 'lowdriven']],
  rivaldo: [75, ['acrobatic+', 'finesse+', 'technical', 'deadball']],
  laudrup: [76, ['incisive+', 'technical+', 'flair', 'firsttouch']],
  neeskens: [75, ['relentless+', 'power', 'anticipate']],
  stoichkov: [73, ['power+', 'deadball+', 'finesse', 'trickster']],
  drogba: [90, ['powerheader+', 'bruiser+', 'power', 'firsttouch']],
  scholes: [70, ['pinged+', 'power+', 'longball', 'tikitaka']],
  nordahl: [94, ['power+', 'powerheader+', 'bruiser']],
  robben: [80, ['finesse+', 'rapid+', 'trickster', 'technical']],
  meireles: [70, ['power', 'relentless', 'tikitaka']],
  fernandinho: [67, ['intercept+', 'relentless', 'bruiser']],
  kroos: [76, ['pinged+', 'longball+', 'tikitaka', 'deadball']],
  rakitic: [78, ['pinged+', 'longball', 'power']],
  busquets: [76, ['tikitaka+', 'intercept', 'pressproven']],
  buffon: [92, ['quickreflexes+', 'deflector+', 'farreach', 'crossclaimer']],
  kaka: [82, ['rapid+', 'finesse+', 'incisive', 'technical']],
  mancini: [70, ['flair+', 'chip', 'technical']],
  sukur: [83, ['powerheader+', 'aerial', 'finesse']],
  rooney: [83, ['power+', 'acrobatic+', 'relentless', 'longball']],
  nesta: [79, ['anticipate+', 'slidetackle+', 'intercept', 'jockey']],
  campbell: [95, ['aerial+', 'bruiser', 'block']],
  kluivert: [80, ['powerheader+', 'firsttouch', 'finesse']],
  zoff: [80, ['crossclaimer+', 'deflector+', 'farreach']],
  socrates: [80, ['chip+', 'incisive+', 'flair', 'finesse']],
  cafu: [75, ['relentless+', 'rapid+', 'whipped', 'jockey']],
  matthaus: [72, ['power+', 'relentless+', 'anticipate', 'pinged']],
  passarella: [73, ['aerial+', 'powerheader+', 'anticipate']],
  hierro: [83, ['longball+', 'aerial', 'power']],
  mascherano: [73, ['slidetackle+', 'intercept', 'relentless']],
  villa: [69, ['finesse+', 'lowdriven', 'quickstep']],
  lineker: [78, ['lowdriven+', 'quickstep', 'firsttouch']],
  bagheri: [80, ['power+', 'longball', 'relentless']],
  deschamps: [70, ['intercept+', 'relentless', 'tikitaka']],
  petit: [78, ['longball+', 'intercept', 'power']],
  futre: [68, ['trickster+', 'rapid', 'technical']],
  bonev: [76, ['deadball+', 'finesse']],
  clemence: [80, ['crossclaimer+', 'quickreflexes', 'farreach']],
  // Stars
  messi: [72, ['finesse+', 'tikitaka', 'technical']],
  ronaldo: [85, ['power+', 'powerheader', 'acrobatic']],
  neymar: [68, ['trickster', 'flair', 'technical']],
  mbappe: [75, ['rapid+', 'quickstep+', 'finesse', 'lowdriven']],
  salah: [71, ['finesse+', 'rapid', 'technical', 'quickstep']],
  debruyne: [76, ['incisive+', 'pinged', 'whipped', 'power']],
  modric: [66, ['trivela', 'tikitaka', 'pressproven']],
  lukaku: [100, ['power', 'bruiser', 'powerheader']],
  neuer: [93, ['footwork+', 'rushout', 'farreach']],
  benzema: [81, ['firsttouch+', 'finesse', 'incisive']],
  ramos: [82, ['aerial', 'powerheader', 'slidetackle']],
  cavani: [71, ['powerheader', 'acrobatic']],
};

export const REAL_ROW_COUNT = ICON_ROWS.length + STAR_ROWS.length;
export const REG_ROW_COUNT = REG_ROWS.length;
/** Every real person's full name per list (for duplicate checks). */
export const REAL_NAMES = { icons: ICON_ROWS.map((r) => r[1]), stars: STAR_ROWS.map((r) => r[1]), regulars: REG_ROWS.map((r) => r[1]) };

const FACE = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
const GKFACE = ['div', 'han', 'kic', 'ref', 'spd', 'pos'];
const ATTACK = new Set(['LW', 'RW', 'CAM', 'CF', 'ST', 'LM', 'RM']);

/** Nudge stats (only those that count for the position) until the position formula gives exactly `target`. */
function fitStats(src, keys, w, target) {
  const weighted = () => keys.reduce((s, k, i) => s + w[i] * src[k], 0);
  for (let it = 0; it < 60; it++) {
    const cur = weighted();
    if (Math.round(cur) === target) break;
    const d = target - cur;
    const free = keys.filter((k, i) => w[i] > 0 && (d > 0 ? src[k] < 99 : src[k] > 25));
    const ws = free.reduce((s, k) => s + w[keys.indexOf(k)], 0);
    if (!ws) break;
    for (const k of free) src[k] = clamp(src[k] + d / ws, 25, 99);
  }
  for (const k of keys) src[k] = Math.round(src[k]);
  const order = keys.map((k, i) => [k, w[i]]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  for (let guard = 0; guard < 200; guard++) {
    const r = Math.round(weighted());
    if (r === target) break;
    const up = r < target;
    const k = order.find((x) => (up ? src[x] < 99 : src[x] > 25));
    if (!k) break;
    // spread the nudge across the most important stats
    const idx = guard % Math.max(1, Math.min(3, order.length));
    const kk = (up ? src[order[idx]] < 99 : src[order[idx]] > 25) ? order[idx] : k;
    src[kk] += up ? 1 : -1;
  }
  return src;
}

/** Keep authored PlayStyles inside the V2.1 OVR-band rules (count + PlayStyle+ limits); top up from the generator. */
function normStyles(p, list) {
  const isGK = p.pos === 'GK';
  let out = list.filter((x) => PLAYSTYLES[x.id] && (PLAYSTYLES[x.id][1] === 'gk') === isGK);
  const [lo, hi] = styleCountRange(p.ovr);
  out = out.slice(0, hi);
  if (out.length < lo) for (const x of genPhysique({ ...p, id: `${p.id}-fill` }).playstyles) if (out.length < lo && !out.some((y) => y.id === x.id)) out.push({ id: x.id, plus: false });
  let plus = maxPlus(p.ovr);
  return out.map((x) => { const keep = x.plus && plus > 0; if (keep) plus--; return { id: x.id, plus: keep }; });
}

function starClub(slug, lg) {
  const pool = CLUBS.filter((c) => c.league === lg && c.tier === 1 && c.rep >= 3);
  const list = pool.length ? pool : CLUBS.filter((c) => c.tier === 1);
  return list[hashStr(`club-${slug}`) % list.length];
}

/**
 * Build real-player records. `helpers` injects functions from players.js (avoids a circular import):
 * { POS_WEIGHTS, computeOvr, marketValue, weeklyWage, tierOf }
 */
export function buildRealPlayers(helpers) {
  const { POS_WEIGHTS, computeOvr, marketValue, weeklyWage } = helpers;
  const make = (row, kind) => {
    const [slug, full, card, nat, pos, alt, foot, wf, sm, ovr, face, age, height, skin, extra = {}] = row;
    const rng = new Rng(`real-${slug}`);
    const isGK = pos === 'GK';
    const stats = {}, gk = {};
    if (isGK) {
      GKFACE.forEach((k, i) => { gk[k] = face[i]; });
      fitStats(gk, GKFACE, POS_WEIGHTS.GK, ovr);
      Object.assign(stats, {
        pac: clamp(gk.spd + rng.int(-3, 3), 30, 90), sho: rng.int(18, 30), pas: clamp(gk.kic - rng.int(6, 12), 30, 85),
        dri: clamp(Math.round(35 + ovr * 0.15) + rng.int(-4, 4), 25, 70), def: rng.int(25, 38), phy: clamp(Math.round(55 + ovr * 0.2) + rng.int(-4, 4), 45, 90),
      });
    } else {
      FACE.forEach((k, i) => { stats[k] = face[i]; });
      fitStats(stats, FACE, POS_WEIGHTS[pos], ovr);
      for (const k of GKFACE) gk[k] = rng.int(8, 16);
      gk.spd = stats.pac;
    }
    const icon = kind === 'icon';
    const club = icon ? null : starClub(slug, extra.lg || 'CON');
    const parts = full.split(' ');
    const p = {
      id: `${icon ? 'ic' : 'rs'}_${slug.replace(/_icon$/, '')}`,
      person: slug.replace(/_icon$/, ''),
      first: parts.length > 1 ? parts[0] : '', last: card, name: full, age, nat,
      club: icon ? 'ICN' : club.id, league: icon ? 'ICN' : club.league, pos, alt: alt.slice(),
      stats, gk,
    };
    p.ovr = computeOvr(pos, p);
    p.pot = p.ovr;
    p.wf = wf; p.sm = isGK ? 1 : sm; p.foot = foot;
    p.wr = isGK ? ['Med', 'Med'] : ATTACK.has(pos) ? ['High', ovr >= 90 ? 'Low' : 'Med'] : ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'].includes(pos) ? ['Med', 'High'] : ['High', 'High'];
    p.height = height;
    const ph = PHYS[slug] || [75, []];
    p.weight = ph[0];
    p.playstyles = parseStyles(ph[1]);
    p.rare = true;
    p.tier = 'gold';
    // V2: every real player is a "Legend of the Game" (LOTG) card; `era` separates retired prime
    // versions from current active versions (Messi and Ronaldo have both).
    p.special = 'lotg';
    p.era = icon ? 'prime' : 'current';
    p.real = true;
    p.skin = skin;
    if (extra.hs !== undefined) p.hair = extra.hs;
    p.value = marketValue({ ...p, age: icon ? 29 : Math.min(age, 30) }) * (icon ? 2 : 1);
    p.wage = weeklyWage({ ...p, age: 29 });
    p.look = hashStr(p.id) % 997;
    p.intended = ovr;
    return p;
  };
  const icons = ICON_ROWS.map((r) => make(r, 'icon'));
  const stars = STAR_ROWS.map((r) => make(r, 'star'));
  // V3 regulars: ordinary gold / rare gold cards of real active players (no special version).
  // Balanced placement: best players go to the most famous clubs of their league, but no club grows past
  // REG_CAP players (career squads max out at 32); overflow moves to other leagues' top flights.
  const count = new Map(Object.entries(helpers.clubCounts || {}));
  const REG_CAP = 34; // V4: raised for the +500 real-player expansion (still comfortably under a 36-player squad)
  const order = REG_ROWS.map((r, i) => [r, i]).sort((a, b) => b[0][9] - a[0][9] || (a[0][0] < b[0][0] ? -1 : 1));
  const placed = new Map();
  const top = CLUBS.filter((c) => c.tier === 1);
  for (const [row] of order) {
    const lg = row[15];
    const score = (c) => c.rep * 10 - (count.get(c.id) || 0) * 3 + (c.league === lg ? 100 : c.league === 'CON' ? 50 : 0) + (hashStr(`${row[0]}-${c.id}`) % 7) / 10;
    const open = top.filter((c) => (count.get(c.id) || 0) < REG_CAP);
    const list = open.length ? open : top;
    const club = list.reduce((a, c) => (score(c) > score(a) ? c : a), list[0]);
    placed.set(row[0], club);
    count.set(club.id, (count.get(club.id) || 0) + 1);
  }
  const regulars = REG_ROWS.map((row) => {
    const [slug, full, card, nat, pos, alt, foot, wf, sm, ovr, face, age, height, weight, skin, lg, styles] = row;
    const base = make([slug, full, card, nat, pos, alt, foot, wf, sm, ovr, face, age, height, skin, { lg }], 'star');
    const club = placed.get(slug);
    const p = { ...base, id: `rp_${slug}`, person: slug, club: club.id, league: club.league };
    delete p.era;
    p.special = null;
    p.rare = true;
    p.tier = helpers.tierOf(p.ovr);
    p.weight = clamp(weight, 58, 100);
    p.playstyles = normStyles(p, parseStyles(String(styles).split(/\s+/).filter(Boolean)));
    const growth = age <= 20 ? 6 : age <= 22 ? 4 : age <= 24 ? 2 : 0;
    p.pot = Math.min(95, p.ovr + growth);
    p.value = marketValue(p);
    p.wage = weeklyWage(p);
    p.look = hashStr(p.id) % 997;
    return p;
  });
  return { icons, stars, regulars };
}
