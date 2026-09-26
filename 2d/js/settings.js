// Persistent game settings. Gameplay assists are stored per player (p1 / p2) so both
// humans in a local match can play with their own preferences.
import { store } from './storage.js';

const KEY = 'touchline.settings.v1';

/** FIFA-style gameplay settings (one copy per human player). */
export const GAMEPLAY_DEFAULTS = Object.freeze({
  passGround: 'Assisted',   // Assisted | Semi | Manual
  passThrough: 'Assisted',
  passLob: 'Assisted',
  shot: 'Assisted',         // Assisted | Precision | Manual
  shotError: true,          // realistic shot error (skill, pressure, sprinting)
  timedFinishing: false,    // second tap of Shoot at contact
  defending: 'Tactical',    // Assisted | Tactical
  autoMarking: true,        // teammates track runners
  autoTackle: false,        // your player tackles automatically when it's clean
  autoClear: true,          // automatic first-time clearances in your own box
  autoSwitch: 'Auto',       // Auto | Air | Manual
  switchIndicator: true,    // show who the next switch will select
  receiverLock: false,      // locked to the pass receiver until the ball arrives
});

/** Allowed values for the option settings (booleans are simply on / off). */
export const GAMEPLAY_OPTIONS = {
  passGround: ['Assisted', 'Semi', 'Manual'],
  passThrough: ['Assisted', 'Semi', 'Manual'],
  passLob: ['Assisted', 'Semi', 'Manual'],
  shot: ['Assisted', 'Precision', 'Manual'],
  defending: ['Assisted', 'Tactical'],
  autoSwitch: ['Auto', 'Air', 'Manual'],
};

export const DEFAULT_SETTINGS = {
  matchMinutes: 4,          // real minutes for a full 90' match
  difficulty: 'Normal',
  assist: 'Assisted',       // legacy mirror of gameplay.p1.shot (menus, old saves)
  sound: true,
  aimLine: true,
  zoom: 1.0,
  penaltyPower: 'hold',     // hold | slider (both always work; this chooses the default hint)
};

/** Merge stored gameplay data with the defaults, dropping anything invalid. */
export function sanitizeGameplay(data, legacyShot) {
  const out = {};
  for (const pl of ['p1', 'p2']) {
    const src = data && typeof data === 'object' && data[pl] && typeof data[pl] === 'object' ? data[pl] : {};
    const g = { ...GAMEPLAY_DEFAULTS };
    if (legacyShot && GAMEPLAY_OPTIONS.shot.includes(legacyShot)) g.shot = legacyShot;
    for (const k of Object.keys(GAMEPLAY_DEFAULTS)) {
      const v = src[k];
      if (typeof GAMEPLAY_DEFAULTS[k] === 'boolean') { if (typeof v === 'boolean') g[k] = v; }
      else if (GAMEPLAY_OPTIONS[k] && GAMEPLAY_OPTIONS[k].includes(v)) g[k] = v;
    }
    out[pl] = g;
  }
  return out;
}

const saved = store.get(KEY, {}) || {};
export const settings = { ...DEFAULT_SETTINGS, ...saved };
settings.gameplay = sanitizeGameplay(saved.gameplay, saved.assist);
settings.assist = settings.gameplay.p1.shot;

/** Gameplay settings for a controller index (0 = P1, 1 = P2). */
export function gameplayFor(ctrl) { return settings.gameplay[ctrl === 1 ? 'p2' : 'p1']; }

export function saveSettings() {
  settings.assist = settings.gameplay.p1.shot;
  store.set(KEY, settings);
}
