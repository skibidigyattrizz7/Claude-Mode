// Two hard-coded sample teams (fictional players) for the dev harness and tests.
function mk(prefix, names, base, formationPos) {
  return names.map((name, i) => {
    const pos = formationPos[i];
    const gk = pos === 'GK';
    const v = (k, d = 0) => Math.max(30, Math.min(95, base + d + ((i * 7 + k * 13) % 11) - 5));
    return {
      id: `${prefix}${i + 1}`, name, number: i === 0 ? 1 : i + 1, pos, ovr: base,
      attrs: {
        pac: v(1, gk ? -25 : pos === 'CB' ? -6 : pos.match(/W|ST/) ? 6 : 0),
        sho: v(2, gk ? -40 : pos.match(/ST|W|CAM/) ? 6 : pos.match(/B$/) ? -18 : -4),
        pas: v(3, gk ? -20 : pos.match(/CM|CAM|CDM/) ? 5 : 0),
        dri: v(4, gk ? -30 : pos.match(/W|CAM|ST/) ? 6 : pos === 'CB' ? -12 : 0),
        def: v(5, gk ? -35 : pos.match(/B$|CDM/) ? 8 : pos.match(/ST|W/) ? -35 : -6),
        phy: v(6, 0),
        div: v(7, gk ? 4 : -40), han: v(8, gk ? 2 : -40), kic: v(9, gk ? -4 : -40),
        ref: v(10, gk ? 5 : -40), spd: v(11, gk ? -8 : -40), pos: v(12, gk ? 3 : -40),
      },
    };
  });
}
const POS433 = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'];
const POS442 = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'];
export const BRAZIL = {
  id: 'BRA', name: 'Brazil', short: 'BRA',
  kit: { primary: '#FEDD00', secondary: '#009C3B', number: '#009C3B', shorts: '#002776', socks: '#FFFFFF' },
  gkKit: { primary: '#1a1a1a', secondary: '#444444', number: '#ffffff', shorts: '#1a1a1a', socks: '#1a1a1a' },
  formation: '4-3-3',
  players: mk('bra', ['T. Alvaro', 'R. Mendes', 'C. Duarte', 'F. Rocha', 'L. Pires', 'D. Moura', 'E. Salles', 'G. Viana', 'J. Prado', 'N. Coelho', 'V. Brandao'], 80, POS433),
  bench: mk('brab', ['H. Lins', 'I. Teles', 'K. Faria', 'M. Assis', 'O. Paiva'], 74, ['GK', 'CB', 'CM', 'LW', 'ST']),
  chemistry: 80,
};
export const FRANCE = {
  id: 'FRA', name: 'France', short: 'FRA',
  kit: { primary: '#1E3A8A', secondary: '#FFFFFF', number: '#FFFFFF', shorts: '#FFFFFF', socks: '#C8102E' },
  gkKit: { primary: '#2E7D32', secondary: '#1B5E20', number: '#ffffff', shorts: '#2E7D32', socks: '#2E7D32' },
  formation: '4-4-2',
  players: mk('fra', ['A. Morel', 'B. Garnier', 'C. Lemaire', 'D. Fabre', 'E. Roussel', 'F. Chevalier', 'G. Barbier', 'H. Perrin', 'J. Mercier', 'K. Dumont', 'L. Lacroix'], 80, POS442),
  bench: mk('frab', ['M. Renaud', 'N. Giraud', 'O. Vidal', 'P. Brun', 'Q. Picard'], 74, ['GK', 'CB', 'CM', 'RM', 'ST']),
  chemistry: 75,
};
