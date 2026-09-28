// Real personal info for real players (owner request, Sep 27: "Messi is literally 39" — never show a fake age).
// DOM-free, pure data + helpers.
//
// BIOS: person slug (players.js personOf / p.person) -> 'dob|height cm|foot|weight kg|died'
//   dob   'YYYY-MM-DD' (or 'YYYY' when only the year is known)
//   every other field may be empty = not known here.
// Rules (see personalInfo):
//   * Age is ALWAYS computed from the date of birth and the current date — never from a stored number.
//   * Anything we don't know for a real player is shown as "Unknown" (never a guess). Hand-authored card rows
//     (Icons, Stars, the hand-written regulars) already carry real height/weight/foot, so those are used when
//     BIOS has no override; the compact "EXT" regular rows had their height/weight GENERATED, so for those only
//     BIOS values count.
//   * Fictional / generated players get "Unknown" for every personal field (DOB, age, height, weight, foot).
// Sources: public records (club/federation profiles, Wikipedia) as remembered; entries we weren't sure of are
// deliberately left out.
export const BIOS = {
  // ---------- Icons ----------
  pele: '1940-10-23|173|R||2022-12-29', maradona: '1960-10-30|165|L|70|2020-11-25', messi: '1987-06-24|170|L|72',
  ronaldo: '1985-02-05|187|R|83', nazario: '1976-09-18|183|R', cruyff: '1947-04-25|178|R||2016-03-24',
  distefano: '1926-07-04|178|R||2014-07-07', beckenbauer: '1945-09-11|181|R||2024-01-07', zidane: '1972-06-23|185|R|80',
  best: '1946-05-22|175|R||2005-11-25', platini: '1955-06-21|178|R', ronaldinho: '1980-03-21|182|R|80',
  maldini: '1968-06-26|186|R|85', garrincha: '1933-10-28|169|R||1983-01-20', yashin: '1929-10-22|189|R||1990-03-20',
  matthews: '1915-02-01|175|R||2000-02-23', baggio: '1967-02-18|174|R|73', henry: '1977-08-17|188|R|83',
  vanbasten: '1964-10-31|188|R|80', xavi: '1980-01-25|170|R|68', iniesta: '1984-05-11|171|R|68', figo: '1972-11-04|180|R|75',
  romario: '1966-01-29|167|R', eusebio: '1942-01-25|175|R||2014-01-05', rummenigge: '1955-09-25|182|R',
  cannavaro: '1973-09-13|176|R|75', casillas: '1981-05-20|182|L', raul: '1977-06-27|180|L', rossi: '1956-09-23|174|R||2020-12-09',
  robertocarlos: '1973-04-10|168|L|70', hagi: '1965-02-05|174|L', ibrahimovic: '1981-10-03|195|R|95',
  lampard: '1978-06-20|184|R', gerrard: '1980-05-30|183|R', beckham: '1975-05-02|183|R|75', seedorf: '1976-04-01|176|R',
  danialves: '1983-05-06|172|R', vieira: '1976-06-23|192|R', koeman: '1963-03-21|181|R', facchetti: '1942-07-18|191|||2006-09-04',
  lahm: '1983-11-11|170|R|66', zanetti: '1973-08-10|178|R', kocsis: '1929-09-21|177|R||1979-07-22',
  fontaine: '1933-08-18|174|R||2023-03-01', cubillas: '1949-03-08|172|R', kempes: '1954-07-15|184|L',
  johnstone: '1944-09-30||R||2006-03-13', cantona: '1966-05-24|188|R', delpiero: '1974-11-09|174|R', totti: '1976-09-27|180|R',
  forlan: '1979-05-19|172|R', rivaldo: '1972-04-19|186|L', laudrup: '1964-06-15|183|R', neeskens: '1951-09-15|177|R||2024-10-06',
  stoichkov: '1966-02-08|178|L', drogba: '1978-03-11|189|R', scholes: '1974-11-16|168|R', nordahl: '1921-10-19||R||1995-09-15',
  robben: '1984-01-23|180|L', meireles: '1983-03-17|179|R', fernandinho: '1985-05-04|179|R', kroos: '1990-01-04|183|R|76',
  rakitic: '1988-03-10|184|R', busquets: '1988-07-16|189|R|76', buffon: '1978-01-28|192|R', kaka: '1982-04-22|186|R|82',
  mancini: '1964-11-27||R', sukur: '1971-09-01|191|R', rooney: '1985-10-24|176|R', nesta: '1976-03-19|187|R',
  campbell: '1974-09-18|188|R', kluivert: '1976-07-01|188|R', zoff: '1942-02-28|182|R', socrates: '1954-02-19|192|R||2011-12-04',
  cafu: '1970-06-07|176|R', matthaus: '1961-03-21|174|R', passarella: '1953-05-25|173|R', hierro: '1968-03-23|187|R',
  mascherano: '1984-06-08|174|R', villa: '1981-12-03|175|R', lineker: '1960-11-30|177|R', bagheri: '1974-02-20||R',
  deschamps: '1968-10-15|174|R', petit: '1970-09-22|185|L', futre: '1966-02-28||L', bonev: '1947-02-03||R',
  clemence: '1948-08-05|183|||2023-11-15',
  aboutrika: '1978-11-07', hossamhassan: '1966-08-10', elhadary: '1973-01-15', ahmedhassan: '1975-05-02', hanyramzy: '1969-03-10',
  elkhatib: '1954-10-30', waelgomaa: '1975-08-03', zidanmo: '1981-12-11', amrzaki: '1983-04-01', mido: '1983-02-23',
  ahmedfathy: '1984-11-10',
  // ---------- Stars ----------
  neymar: '1992-02-05|175|R|68', mbappe: '1998-12-20|178|R|75', salah: '1992-06-15|175|L|71', debruyne: '1991-06-28|181|R',
  modric: '1985-09-09|172|R|66', lukaku: '1993-05-13|191|L', neuer: '1986-03-27|193|R|93', benzema: '1987-12-19|185|R|81',
  ramos: '1986-03-30|184|R|82', cavani: '1987-02-14|184|R|71',
  // ---------- regulars (hand-written rows: height/weight/foot authored) ----------
  alisson: '1992-10-02', courtois: '1992-05-11', terstegen: '1992-04-30', donnarumma: '1999-02-25', maignan: '1995-07-03',
  oblak: '1993-01-07', ederson: '1993-08-17', emimartinez: '1992-09-02', sommer: '1988-12-17', kobel: '1997-12-06',
  raya: '1995-09-15', diogocosta: '1999-09-19', vicario: '1996-10-07', unaisimon: '1997-06-11', mamardashvili: '2000-09-29',
  onana: '1996-04-02', vandijk: '1991-07-08', rubendias: '1997-05-14', saliba: '2001-03-24', marquinhos: '1994-05-14',
  rudiger: '1993-03-03', bastoni: '1999-04-13', gvardiol: '2002-01-23', kimminjae: '1996-11-15', upamecano: '1998-10-27',
  tah: '1996-02-11', gabriel: '1997-12-19', araujo: '1999-03-07', cubarsi: '2007-01-22', huijsen: '2005-04-14',
  militao: '1998-01-18', kounde: '1998-11-12', akanji: '1995-07-19', vandeven: '2001-04-19', konate: '1999-05-25',
  pacho: '2001-10-16', hincapie: '2002-01-09', guehi: '2000-07-13', stones: '1994-05-28', schlotterbeck: '1999-12-01',
  bremer: '1997-03-18', alaba: '1992-06-24', deligt: '1999-08-12', koulibaly: '1991-06-20', hakimi: '1998-11-04',
  theohernandez: '1997-10-06', dumfries: '1996-04-18', alexanderarnold: '1998-10-07', robertson: '1994-03-11',
  nunomendes: '2002-06-19', grimaldo: '1995-09-20', frimpong: '2000-12-10', davies: '2000-11-02', cancelo: '1994-05-27',
  dimarco: '1997-11-10', reecejames: '1999-12-08', porro: '1999-09-13', balde: '2003-10-18', carvajal: '1992-01-11',
  dilorenzo: '1993-08-04', cucurella: '1998-07-22', rodri: '1996-06-22', rice: '1999-01-14', valverde: '1998-07-22',
  pedri: '2002-11-25', gavi: '2004-08-05', frenkiedejong: '1997-05-12', barella: '1997-02-07', calhanoglu: '1994-02-08',
  macallister: '1998-12-24', enzofernandez: '2001-01-17', caicedo: '2001-11-02', szoboszlai: '2000-10-25',
  brunofernandes: '1994-09-08', bernardosilva: '1994-08-10', tchouameni: '2000-01-27', camavinga: '2002-11-10',
  vitinha: '2000-02-13', joaoneves: '2004-09-27', kimmich: '1995-02-08', pavlovic: '2004-05-03', xhaka: '1992-09-27',
  tonali: '2000-05-08', mctominay: '1996-12-08', zielinski: '1994-05-20', kessie: '1996-12-19', casemiro: '1992-02-23',
  brunoguimaraes: '1997-11-16', fabianruiz: '1996-04-03', zubimendi: '1999-02-02', merino: '1996-06-22',
  reijnders: '1998-07-29', koopmeiners: '1998-02-28', kante: '1991-03-29', palhinha: '1995-07-09', depaul: '1994-05-24',
  goretzka: '1995-02-06', wirtz: '2003-05-03', musiala: '2003-02-26', odegaard: '1998-12-17', bellingham: '2003-06-29',
  foden: '2000-05-28', palmer: '2002-05-06', olmo: '1998-05-07', arda: '2005-02-25', xavisimons: '2003-04-21',
  maddison: '1996-11-23', paqueta: '1997-08-27', vinicius: '2000-07-12', saka: '2001-09-05', yamal: '2007-07-13',
  raphinha: '1996-12-14', dembele: '1997-05-15', leao: '1999-06-10', kvaratskhelia: '2001-02-12', nicowilliams: '2002-07-12',
  olise: '2001-12-12', doku: '2002-05-27', rodrygo: '2001-01-09', son: '1992-07-08', mbeumo: '1999-08-07', kudus: '2000-08-02',
  mitoma: '1997-05-20', luisdiaz: '1997-01-13', gakpo: '1999-05-07', sane: '1996-01-11', coman: '1996-06-13',
  garnacho: '2004-07-01', barcola: '2002-09-02', doue: '2005-06-03', pulisic: '1998-09-18', lookman: '1997-10-20',
  mane: '1992-04-10', kulusevski: '2000-04-25', bowen: '1996-12-20', grealish: '1995-09-10', rashford: '1997-10-31',
  kubo: '2001-06-04', haaland: '2000-07-21', kane: '1993-07-28', lewandowski: '1988-08-21', lautaro: '1997-08-22',
  julianalvarez: '2000-01-31', osimhen: '1998-12-29', isak: '1999-09-21', gyokeres: '1998-06-04', griezmann: '1991-03-21',
  vlahovic: '2000-01-28', thuram: '1997-08-06', watkins: '1995-12-30', darwinnunez: '1999-06-24', sesko: '2003-05-31',
  hojlund: '2003-02-04', retegui: '1999-04-29', kean: '2000-02-28', dovbyk: '1997-06-21', openda: '2000-02-16',
  jonathandavid: '2000-01-14', mitrovic: '1994-09-16', ekitike: '2002-06-20', schick: '1996-01-24', marmoush: '1999-02-07',
  nicolasjackson: '2001-06-20', sorloth: '1995-12-05', kolomuani: '1998-12-05', joaofelix: '1999-11-10', goncaloramos: '2001-06-20',
  // ---------- regulars (compact rows: height/weight were generated, so only these values count) ----------
  // goalkeepers
  cech: '1982-05-20|196|L', vandersar: '1970-10-29|197|R', degea: '1990-11-07|192|R', lloris: '1986-12-26|188|L',
  joehart: '1987-04-19|196|R', claudiobravo: '1983-04-13|184|R', pepereina: '1982-08-31|188|R', victorvaldes: '1982-01-14|183|R',
  diegolopezgk: '1981-11-03|196|R', handanovic: '1984-07-14|193|R', sirigu: '1987-01-12|192|R', areola: '1993-02-27|195|R',
  mandanda: '1985-03-28|185|R', barthez: '1971-06-28|183|R', landreau: '1979-05-14|184|R', kahn: '1969-06-15|188|R',
  lehmann: '1969-11-10|190|R', adler: '1985-01-15|191|R', weidenfeller: '1980-08-06|188|R', peruzzi: '1970-02-16|181|R',
  toldo: '1971-12-02|196|R', desanctis: '1977-03-26|190|R', abbiati: '1977-07-08|191|R', szczesny: '1990-04-18|195|R',
  canizares: '1969-12-18|181|R', zubizarreta: '1961-10-23|186|R', diegoalves: '1985-06-24|188|R', ruipatricio: '1988-02-15|190|L',
  anthonylopes: '1990-10-01|184|R', enyeama: '1982-08-29|180|R', kameni: '1984-02-18|186|R', barrygk: '1979-12-30|180|R',
  kaspers: '1986-11-05|185|R', peters: '1963-11-18|191|R', sorensengk: '1976-06-12|193|R', robertgreen: '1980-01-18|190|R',
  robinsongk: '1979-10-15|193|L', davidjames: '1970-08-01|196|R', seaman: '1963-09-19|193|R', martyn: '1966-08-11|188|R',
  howardgk: '1979-03-06|191|R', kellergk: '1969-11-29|188|R', friedel: '1971-05-18|188|R', guzangk: '1984-09-09|193|R',
  shaygiven: '1976-04-20|186|R', bonner: '1960-05-24|188|R', neilsullivan: '1970-02-24', craiggordon: '1982-12-31|193|R',
  andygoram: '1964-04-13||||2022-07-02', grbic: '1996-01-18|195|R', subasic: '1984-10-27|191|R', pletikosa: '1979-01-08|193|R',
  livakovic: '1995-01-09|188|R', stojkovicgk: '1983-07-28|195|R', rajkovic: '1995-10-31|191|R', schumacher: '1954-03-06|186|R',
  maiergk: '1944-02-28|182|R', kopke: '1962-03-12', illgner: '1967-04-07', banks: '1937-12-30|185|R||2019-02-12',
  shiltongk: '1949-09-18|183|R', jenningsgk: '1945-06-12', southall: '1958-09-16', juliocesar: '1979-09-03|186|R',
  ceni: '1973-01-22', muslera: '1986-06-16|190|R', martinsilva: '1983-03-25', romerogk: '1987-02-22|192|R',
  goycochea: '1963-10-17', pumpido: '1957-07-30', taffarel: '1966-05-08', marcosgk: '1973-08-04', rustureba: '1973-05-10|186|R',
  // centre-backs
  rioferdinand: '1978-11-07|189|R', johnterry: '1980-12-07|187|R', carragher: '1978-01-28|185|R', ledleyking: '1980-10-12|188|R',
  tonyadams: '1966-10-10|191|R', pallister: '1965-06-30|193|R', deswalker: '1965-11-26', bobbymoore: '1941-04-12||R||1993-02-24',
  terrybutcher: '1958-12-28', stevebruce: '1960-12-31', vidicnem: '1981-10-21|188|R', thiagosilva: '1984-09-22|181|R',
  davidluiz: '1987-04-22|189|R', lucio: '1978-05-08|188|R', aldair: '1965-11-30', alexcb: '1982-06-17', naldo: '1982-09-10',
  dantecb: '1983-10-18|187|R', mirandacb: '1984-09-07|186|R', waltersamuel: '1978-03-23|183|R', gabrielmilito: '1980-09-07',
  otamendi: '1988-02-12|183|R', zapataroy: '1986-09-30|187|R', marioyepes: '1976-01-13|186|R', ivancordoba: '1976-08-11|173|R',
  diegogodin: '1986-02-16|187|R', gimenezcb: '1995-01-20|185|R', diegolugano: '1980-11-02|188|R', brunoalves: '1981-11-27|189|R',
  pepecb: '1983-02-26|188|R', ricardocarvalho: '1978-05-18|183|R', fernandocouto: '1969-08-02', williamgallas: '1977-08-17',
  laurentblanc: '1965-11-19|192|R', desailly: '1968-09-07|185|R', leboeuf: '1968-01-22', lilianthuram: '1972-01-01|185|R',
  mexes: '1982-03-30', varane: '1993-04-25|191|R', umtiti: '1993-11-14|182|L', kimpembe: '1995-08-13|189|L', rami: '1985-12-27|190|R',
  sakho: '1990-02-13|187|L', zouma: '1994-10-27|190|R', hummels: '1988-12-16|191|R', boateng: '1988-09-03|192|R',
  mertesacker: '1984-09-29|198|R', metzelder: '1980-11-05', buchwald: '1961-01-24', hummelsdup2: '1988-02-29|187|R',
  chiellini: '1984-08-14|187|L', bonucci: '1987-05-01|190|R', barzagli: '1981-05-08|187|R', materazzi: '1973-08-19|193|R',
  panucci: '1973-04-12', ciroferrara: '1967-02-11', baresi: '1960-05-08|176|R', scirea: '1953-05-25||||1989-09-03',
  gentile: '1953-09-27', pique: '1987-02-02|194|R', puyol: '1978-04-13|178|R', marchenacb: '1979-07-31', inigomartinez: '1991-05-17|182|L',
  albiol: '1985-09-04|190|R', marcbartra: '1991-01-15|184|R', laporte: '1994-05-27|191|L', frankdeboer: '1970-05-15',
  jaapstam: '1972-07-17|191|R', heitinga: '1983-11-15', mathijsen: '1980-04-05', vlaar: '1985-02-16', devrijcb: '1992-02-05|189|R',
  dalyblind: '1990-03-09|180|L', vertonghen: '1987-04-24|189|L', alderweireld: '1989-03-02|186|R', vermaelen: '1985-11-14|183|L',
  kompany: '1986-04-10|190|R', vanbuyten: '1978-02-07|197|R', agger: '1984-12-12|191|L', simonkjaer: '1989-03-26|191|R',
  christensencb: '1996-04-10|187|R', colinhendry: '1965-12-07', alanhansen: '1955-06-13', richarddunne: '1979-09-21',
  paulmcgrath: '1959-12-04', ashleywilliams: '1984-08-23', alpayozalan: '1973-05-29', domagojvida: '1989-04-29|184|R',
  dejanlovren: '1989-07-05|188|R', royalaya: '1973-04-14', coloccini: '1982-01-22', ezequielgaray: '1986-10-10',
  marcosrojo: '1990-03-20|187|L', cristianromero: '1998-04-27|185|R', lisandromartinez: '1998-01-18|175|L', kolotoure: '1981-03-19|183|R',
  rigobertsong: '1976-07-01', josephyobo: '1980-09-06', johnmensah: '1982-11-29', harrymaguire: '1993-03-05|194|R',
  joleonlescott: '1982-08-16', philjagielka: '1982-08-17', garycahill: '1985-12-19|193|R', chrissmalling: '1989-11-22|194|R',
  michaelkeanecb: '1993-01-11|188|R', fabianschar: '1991-12-20|186|R', johandjourou: '1987-01-18', sendersos: '1985-02-14',
  rafamarquez: '1979-02-13|182|R', claudiosuarez: '1968-12-17', gheorghepopescu: '1967-10-09', traiandellas: '1976-01-31',
  // full-backs
  garyneville: '1975-02-18|180|R', ashleycole: '1980-12-20|176|L', kylewalker: '1990-05-28|183|R', kierantrippier: '1990-09-19|173|R',
  leightonbaines: '1984-12-11|170|L', dannyrose: '1990-07-02|173|L', lukeshaw: '1995-07-12|178|L', benchilwell: '1996-12-21|178|L',
  gaelclichy: '1985-07-26|176|L', patriceevra: '1981-05-15|175|L', bacarysagna: '1983-02-14|176|R', lizarazu: '1969-12-09|169|L',
  ericabidal: '1979-09-11|186|L', kurzawa: '1992-09-04|182|L', pavard: '1996-03-28|186|R', lucashernandez: '1996-02-14|184|L',
  brehme: '1960-11-09||||2024-02-20', christianziege: '1972-02-01', arnefriedrich: '1979-05-29', schmelzer: '1988-01-22',
  zambrotta: '1977-02-19|182|R', fabiogrosso: '1977-11-28|190|L', balzaretti: '1981-12-06', desciglio: '1992-10-20|183|R',
  florenzi: '1991-03-11|173|R', spinazzola: '1993-03-25|186|L', salgado: '1975-10-22', jordialba: '1989-03-21|170|L',
  arbeloa: '1983-01-17|184|R', joancapdevila: '1978-02-03', juanfran: '1985-01-09|181|R', marcosalonso: '1990-12-28|188|L',
  azpilicueta: '1989-08-28|178|R', jesusnavas: '1985-11-21|172|R', maicon: '1981-07-26|184|R', marcelo: '1988-05-12|174|L',
  filipeluis: '1985-08-09|182|L', alexsandro: '1991-01-26|180|L', fagner: '1989-06-11', danilobra: '1991-07-15|184|R',
  ivanovicb: '1984-02-22|185|R', kolarov: '1985-11-10|187|L', reiziger: '1973-05-03', vanbronckhorst: '1975-02-05|178|L',
  meunier: '1991-09-12|191|R', coentrao: '1988-03-11|179|L', semedo: '1993-11-16|177|R', guerreiro: '1993-12-22|170|L',
  vrsaljko: '1992-01-10|181|R', dannymcgrain: '1950-05-01', philneal: '1951-02-20', vivanderson: '1956-08-29',
  kennysansom: '1958-09-26', stuartpearce: '1962-04-24', denisirwin: '1965-10-31', graemelesaux: '1968-10-17',
  djalmasantos: '1929-02-27||||2013-07-23', niltonsantos: '1925-05-16||||2013-11-27', bertivogts: '1946-12-30', paulbreitner: '1951-09-05',
  emersonpalmieri: '1994-08-03|176|L', nicotagliafico: '1992-08-31|172|L', sergeaurier: '1992-12-24|176|R', chrisgunter: '1989-07-21',
  // midfielders
  ballack: '1976-09-26|189|R', schweinsteiger: '1984-08-01|183|R', khedira: '1987-04-04|189|R', gundogan: '1990-10-24|180|R',
  weigl: '1995-09-08|186|R', pirlo: '1979-05-19|177|R', gattuso: '1978-01-09|177|R', derossi: '1983-07-24|185|R',
  verratti: '1992-11-05|165|R', jorginho: '1991-12-20|180|R', vidalarturo: '1987-05-22|180|R', marchisio: '1986-01-19|180|R',
  montolivo: '1985-01-18', xabialonso: '1981-11-25|183|R', davidsilva: '1986-01-08|170|L', cescfabregas: '1987-05-04|180|R',
  kokecm: '1992-01-08|176|R', thiagoalcantara: '1991-04-11|174|R', saulniguez: '1994-11-21|184|L', makelele: '1973-02-18|174|R',
  mvila: '1990-06-29', matuidi: '1987-04-09|180|L', pogba: '1993-03-15|191|R', rabiot: '1995-04-03|188|L', sissoko: '1989-08-16|187|R',
  nzonzi: '1988-12-15|196|R', roykeane: '1971-08-10|178|R', michaelcarrick: '1981-07-28|188|R', owenhargreaves: '1981-01-20',
  jackwilshere: '1992-01-01|172|L', jamesmilner: '1986-01-04|175|R', garethbarry: '1981-02-23||L', stankovic: '1978-09-11',
  maticnem: '1988-08-01|194|L', sms: '1995-02-27|191|R', nainggolan: '1988-05-04|176|R', witsel: '1989-01-12|186|R',
  fellaini: '1987-11-22|194|R', dembelemousa: '1987-07-16|185|R', sneijder: '1984-06-09|170|R', vanbommel: '1977-04-22',
  nigeldejong: '1984-11-30|174|R', vandervaart: '1983-02-11|177|L', davids: '1973-03-13|169|L', ronalddeboer: '1970-05-15',
  gilbertosilva: '1976-10-07', zeroberto: '1974-07-06||L', fredcm: '1993-03-05|169|L', redondo: '1969-06-06||L',
  riquelme: '1978-06-24|182|R', cambiasso: '1980-08-18', paredesleandro: '1994-06-29|180|R', fernandogago: '1986-04-10',
  banega: '1988-06-29|175', nedved: '1972-08-30|177|R', emrebelozoglu: '1980-09-07', nikokovac: '1971-10-15', essien: '1982-12-03|178|R',
  mikelobi: '1987-04-22|188|R', oliseh: '1974-09-14', yayatoure: '1983-05-13|189|R', zokora: '1980-12-14', gueyeidrissa: '1989-09-26|174|R',
  papabouba: '1978-01-28||||2020-11-29', kouyate: '1989-12-21', thomasdelaney: '1991-09-03', kimkallstrom: '1982-08-24',
  anderssvensson: '1976-07-17', krychowiak: '1990-01-29|186|R', karagounis: '1977-03-06', tymoshchuk: '1979-03-30',
  rijkaard: '1962-09-30|190|R', zico: '1953-03-03|172|R', rivelino: '1946-01-01||L', falcao80: '1953-10-16',
  // attackers
  robinho: '1984-01-25|173|R', willianbra: '1988-08-09|175|R', coutinho: '1992-06-12|172|R', douglascosta: '1990-09-14|172|L',
  hulk: '1986-07-25|180|L', oscarbra: '1991-09-09|179|R', pabloaimar: '1979-11-03', arielortega: '1974-03-04', dimaria: '1988-02-14|180|L',
  overmars: '1973-03-29|173', memphisdepay: '1994-02-13|176|R', arshavin: '1981-05-29|172|R', tomasrosicky: '1980-10-04|178|R',
  mutuadrian: '1979-01-08', muller: '1989-09-13|186|R', gotze: '1992-06-03|176|R', draxler: '1993-09-20|187|R', reusmarco: '1989-05-31|180|R',
  zolagf: '1966-07-05|168|R', cassano: '1982-07-12|175|R', elshaarawy: '1992-10-27|178|R', insigne: '1991-06-04|163|R',
  fedechiesa: '1997-10-25|175|R', cazorla: '1984-12-13|168|R', isco: '1992-04-21|176|R', ansufati: '2002-10-31|178|R',
  oyarzabal: '1997-04-21|181|L', joaquin: '1981-07-21|181|R', ribery: '1983-04-07|170|R', fekir: '1993-07-18|173|L',
  thauvin: '1993-01-26|179|L', payetdim: '1987-03-29|175|R', benarfa: '1987-03-07|178', deco: '1977-08-27|174|R', nanirw: '1986-11-17|175|R',
  quaresma: '1983-09-26|175|R', landondonovan: '1982-03-04|173|R', clintdempsey: '1983-03-09|185|R', damarcusbeasley: '1982-05-24',
  damienduff: '1979-03-02|177|L', ryangiggs: '1973-11-29|179|L', garethbale: '1989-07-16|185|L', aaronramsey: '1990-12-26|178|R',
  wilfriedzaha: '1992-11-10|180|R', christianeriksen: '1992-02-14|182|R', jayjayokocha: '1973-08-14|173|R', abedipele: '1964-11-05',
  parkjisung: '1981-02-25|175|R', kisungyueng: '1989-01-24|187|R', kagawa: '1989-03-17|172|R', honda: '1986-06-13|182|L',
  nakamura: '1978-06-24|178|L', nakata: '1977-01-22', timcahill: '1979-12-06|178|R', harrykewell: '1978-09-22|180|L', bebeto: '1964-02-16',
  adriano: '1982-02-17|189|L', alexandrepato: '1989-09-02|179|R', careca: '1960-10-05', jairzinho: '1944-12-25', tostao: '1947-01-25',
  batistuta: '1969-02-01|185|R', crespo: '1975-07-05|184|R',
  // Egypt (2026 squad) — only what we're sure of
  elshenawy: '1988-12-18||R', ahmedhegazi: '1991-01-25|195|R', abdelmonem: '1999-02-01', elneny: '1992-07-11|180|R',
  koka: '1993-03-05', zizosayed: '1996-01-10', trezeguethassan: '1994-10-01|179|R',
  mostafamohamed: '1997-11-28|185|R',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parsed bio for a person slug, or null. */
export function bioFor(person) {
  const raw = person && BIOS[person];
  if (!raw) return null;
  const [dob, h, foot, w, died] = raw.split('|');
  return {
    dob: dob || null,
    height: h ? Number(h) : null,
    foot: foot === 'L' || foot === 'R' ? foot : null,
    weight: w ? Number(w) : null,
    died: died || null,
  };
}

function parts(iso) {
  const m = /^(\d{4})(?:-(\d{2})-(\d{2}))?$/.exec(String(iso || ''));
  return m ? { y: +m[1], m: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null } : null;
}

/** Whole years between an ISO date ('YYYY-MM-DD') and `on` (Date or ISO). Year-only dobs return null. */
export function ageOn(dob, on = new Date()) {
  const b = parts(dob);
  if (!b || b.m == null) return null;
  const t = typeof on === 'string' ? parts(on) : { y: on.getFullYear(), m: on.getMonth() + 1, d: on.getDate() };
  if (!t) return null;
  let a = t.y - b.y;
  if (t.m != null && (t.m < b.m || (t.m === b.m && (t.d ?? 31) < b.d))) a--;
  return a;
}

/** '24 Jun 1987' (or '1987' when only the year is known). */
export function fmtDate(iso) {
  const p = parts(iso);
  if (!p) return null;
  return p.m ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : String(p.y);
}

/**
 * The personal-info block for a card's details view. Never generated values:
 *   { real, dob, dobLabel, age, ageLabel, height, weight, foot, died, status } — unknown fields are null and
 *   every *Label / display string reads 'Unknown'.
 * `authored`: true when the card's own height/weight/foot are hand-authored real values (Icons, Stars,
 * hand-written regulars) rather than generated; realplayers.js sets `p.physReal` for those.
 */
export function personalInfo(p, now = new Date()) {
  const U = 'Unknown';
  const real = !!(p && p.real);
  const out = { real, dob: null, dobLabel: U, age: null, ageLabel: U, height: null, weight: null, foot: null, died: null, status: null };
  if (!real) return out;
  const b = bioFor(p.person) || {};
  const authored = !!p.physReal;
  out.dob = b.dob || null;
  out.dobLabel = b.dob ? fmtDate(b.dob) : U;
  out.height = b.height || (authored && Number.isFinite(p.height) ? p.height : null);
  out.weight = b.weight || (authored && Number.isFinite(p.weight) ? p.weight : null);
  out.foot = b.foot || (authored && (p.foot === 'L' || p.foot === 'R') ? p.foot : null);
  if (b.died) {
    out.died = b.died;
    const at = ageOn(b.dob, b.died);
    out.ageLabel = `Died ${fmtDate(b.died)}${at != null ? ` (aged ${at})` : ''}`;
  } else if (b.dob) {
    out.age = ageOn(b.dob, now);
    if (out.age == null) { // year-only dob: the age is one of two values
      const y = parts(b.dob).y, n = now.getFullYear();
      out.ageLabel = `${n - y - 1}–${n - y}`;
    } else out.ageLabel = String(out.age);
  }
  if (p.era === 'prime' || p.club === 'ICN') out.status = out.died ? 'Icon (deceased)' : 'Icon (prime version)';
  return out;
}

/**
 * Personal rows for the card details view, as plain [label, text] pairs (DOM-free so tests can check exactly
 * what a player's profile shows). Fictional players read 'Unknown' everywhere.
 */
export function profileFacts(p, now = new Date()) {
  const i = personalInfo(p, now);
  const U = 'Unknown';
  const rows = [
    ['Date of birth', i.dobLabel],
    ['Age', i.ageLabel],
    ['Height', i.height ? `${i.height} cm` : U],
    ['Weight', i.weight ? `${i.weight} kg` : U],
    ['Preferred foot', i.foot === 'L' ? 'Left' : i.foot === 'R' ? 'Right' : U],
  ];
  if (i.status) rows.push(['Status', i.status]);
  if (!i.real) rows.push(['Player', 'Fictional player']);
  return rows;
}
