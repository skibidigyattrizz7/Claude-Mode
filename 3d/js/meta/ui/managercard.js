// Manager card (owner, Sep 30): real, packable managers (core/managers.js REAL_MANAGERS) and the cosmetic custom
// manager. Photo when the club has it (assets/managers/<slug>.webp), initials otherwise.
import { h } from './dom.js';
import { flagSVG } from './art.js';
import { NATION_BY_CODE, leagueName } from '../core/data.js';

const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();

/** m: manager object ({ name, nat, league, photo?, real? }). size: 'sm' | 'md'. locked: shown as not owned yet. */
export function managerCard(m, { size = 'md', locked = false } = {}) {
  const face = h('div', { class: 'pm-mcard-face' });
  if (m.photo && !locked) {
    const img = h('img', { class: 'pm-mcard-photo', src: m.photo, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.remove(); face.append(h('span', { class: 'pm-mcard-ini' }, initials(m.name))); }, { once: true });
    face.append(img);
  } else face.append(h('span', { class: 'pm-mcard-ini' }, locked ? '?' : initials(m.name)));
  const nat = NATION_BY_CODE[m.nat];
  return h('div', { class: `pm-mcard pm-mcard--${size}${locked ? ' is-locked' : ''}${m.real ? ' is-real' : ''}`, title: locked ? 'Not collected yet' : m.name },
    h('span', { class: 'pm-mcard-tag' }, 'MANAGER'),
    face,
    h('div', { class: 'pm-mcard-info' },
      h('b', { class: 'pm-mcard-name' }, locked ? '???' : m.name),
      !m.nat ? h('small', { class: 'pm-mcard-meta' }, locked ? '' : 'Club manager') : h('div', { class: 'pm-mcard-meta' },
        h('span', { class: 'pm-mcard-flag', html: flagSVG(m.nat, 'pc-flag') }),
        h('small', null, [nat ? nat.name : m.nat, m.league ? leagueName(m.league) : 'Any league'].filter(Boolean).join(' · ')))));
}
