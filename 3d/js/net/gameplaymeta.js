// Pitchside 3D — labels, groups and allowed values for the gameplay settings in shared/gameplay.js.
// Used by the Settings → Gameplay page (main.js) and to validate settings received from a peer.
// The UI is generated from GAMEPLAY_DEFAULTS keys, so fields added later still appear (with a
// generic label) even before they get an entry here.
import { GAMEPLAY_DEFAULTS } from '../shared/gameplay.js';

const ON_OFF = [[true, 'On'], [false, 'Off']];
const ASSIST3 = [['assisted', 'Assisted'], ['semi', 'Semi-Assisted'], ['manual', 'Manual']];

export const GAMEPLAY_GROUPS = [
  ['passing', 'Passing'],
  ['shooting', 'Shooting'],
  ['defending', 'Defending'],
  ['switching', 'Switching'],
  ['visual', 'Visual'],
  ['other', 'Other'],
];

/** key -> { label, desc, group, options: [[value, label], ...] } */
export const GAMEPLAY_FIELDS = {
  passAssist: {
    group: 'passing', label: 'Ground Pass Assistance', options: ASSIST3,
    desc: 'Assisted picks the teammate nearest your aim and sets the power for you. Semi-Assisted uses a narrower cone and your held power. Manual passes exactly where you aim, as hard as you hold.',
  },
  throughAssist: {
    group: 'passing', label: 'Through Pass Assistance', options: ASSIST3,
    desc: 'How much help through balls get with direction and weight into space.',
  },
  lobAssist: {
    group: 'passing', label: 'Lob Pass & Cross Assistance', options: ASSIST3,
    desc: 'How much help lofted passes and crosses get finding a teammate.',
  },
  passReceiverLock: {
    group: 'passing', label: 'Pass Receiver Lock',
    options: [['off', 'Off'], ['earlyRelease', 'Early Release'], ['lateRelease', 'Late Release']],
    desc: 'Keeps control on the pass receiver until the ball arrives. Early Release hands control back sooner so you can make runs.',
  },
  shotAssist: {
    group: 'shooting', label: 'Shot Assistance',
    options: [['assisted', 'Assisted'], ['precision', 'Precision'], ['manual', 'Manual']],
    desc: 'Assisted keeps shots aimed broadly at goal on target. Precision goes exactly where you aim and rewards on-target aim with extra pace. Manual has no help at all.',
  },
  timedFinishing: {
    group: 'shooting', label: 'Timed Finishing', options: ON_OFF,
    desc: 'Tap shoot a second time just as the player strikes the ball for extra accuracy. A badly timed tap makes it worse.',
  },
  autoShots: {
    group: 'shooting', label: 'Auto Shots', options: ON_OFF,
    desc: 'Your player shoots automatically on clear first-time chances.',
  },
  shotError: {
    group: 'shooting', label: 'Shot Error', options: ON_OFF,
    desc: 'Adds realistic error to shots taken off-balance or under pressure.',
  },
  aiDefending: {
    group: 'defending', label: 'Defending', options: [['assisted', 'Assisted'], ['tactical', 'Tactical']],
    desc: 'Assisted: teammates contain, press and cover for you. Tactical: you position and jockey yourself, teammates only hold shape.',
  },
  autoMarking: {
    group: 'defending', label: 'Auto Marking', options: ON_OFF,
    desc: 'AI teammates track attacking runners automatically.',
  },
  autoTackle: {
    group: 'defending', label: 'Auto Tackle', options: ON_OFF,
    desc: 'Your player pokes the ball away automatically when it comes within reach.',
  },
  jockeyAssist: {
    group: 'defending', label: 'Jockey Assist', options: ON_OFF,
    desc: 'While holding Jockey your player keeps facing the ball carrier.',
  },
  autoClearances: {
    group: 'defending', label: 'Auto Clearances', options: ON_OFF,
    desc: 'Defenders you are not controlling clear the ball out of danger automatically.',
  },
  autoSwitch: {
    group: 'switching', label: 'Auto Switching',
    options: [['auto', 'Auto'], ['airballs', 'Air Balls Only'], ['manual', 'Manual']],
    desc: 'When control moves to the player nearest the ball on its own. Manual only switches when you press Switch.',
  },
  autoSwitchAssist: {
    group: 'switching', label: 'Auto Switching Move Assistance',
    options: [['none', 'None'], ['low', 'Low'], ['high', 'High']],
    desc: 'How much the game keeps the new player moving the right way right after a switch.',
  },
  switchOnPass: {
    group: 'switching', label: 'Switch to Receiver',
    options: [['instant', 'Instantly'], ['release', 'Mid-pass'], ['receive', 'On Reception']],
    desc: 'When control moves to the player you passed to.',
  },
  nextPlayerIndicator: {
    group: 'switching', label: 'Next Player Switch Indicator', options: ON_OFF,
    desc: 'Shows which player Switch will select next.',
  },
  cameraShake: {
    group: 'visual', label: 'Camera Shake', options: ON_OFF,
    desc: 'Small camera shake on big hits and powerful shots.',
  },
  showAimLine: {
    group: 'visual', label: 'Aim & Pass Line', options: ON_OFF,
    desc: 'Draws a guide line for the direction you are aiming.',
  },
};

/** "someNewKey" -> "Some New Key" */
export function humanizeKey(k) {
  return String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Field descriptor for any key in GAMEPLAY_DEFAULTS (known or not). */
export function gameplayField(key, defaults = GAMEPLAY_DEFAULTS) {
  const known = GAMEPLAY_FIELDS[key];
  if (known) return { key, ...known };
  const d = defaults[key];
  return {
    key, group: 'other', label: humanizeKey(key), desc: '',
    options: typeof d === 'boolean' ? ON_OFF : typeof d === 'string' ? [[d, humanizeKey(d)]] : [],
  };
}

/** Every field currently in GAMEPLAY_DEFAULTS, grouped: [{ id, label, fields: [...] }] (empty groups dropped). */
export function gameplayGroups(defaults = GAMEPLAY_DEFAULTS) {
  const fields = Object.keys(defaults).map((k) => gameplayField(k, defaults));
  return GAMEPLAY_GROUPS.map(([id, label]) => ({ id, label, fields: fields.filter((f) => f.group === id) }))
    .filter((g) => g.fields.length);
}

/**
 * Validate gameplay settings from storage or from the peer: only keys that exist in the defaults,
 * booleans must be booleans, enum strings must be one of the known options (unknown-enum fields
 * accept a short identifier). Everything else falls back to the default.
 */
export function sanitizeGameplay(g, defaults = GAMEPLAY_DEFAULTS) {
  const src = g && typeof g === 'object' && !Array.isArray(g) ? g : {};
  const out = {};
  for (const [k, d] of Object.entries(defaults)) {
    const v = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : undefined;
    if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (typeof d === 'string') {
      const f = GAMEPLAY_FIELDS[k];
      if (f) out[k] = f.options.some(([ov]) => ov === v) ? v : d;
      else out[k] = typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(v) ? v : d;
    } else if (typeof d === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : d;
    else out[k] = d;
  }
  return out;
}
