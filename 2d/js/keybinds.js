// Keybinding model (pure — no DOM). Bindings use KeyboardEvent.code values.

export const ACTIONS = ['up', 'down', 'left', 'right', 'shoot', 'pass', 'through', 'lob', 'sprint', 'tackle', 'slide', 'switch', 'skill', 'pause'];

export const ACTION_LABELS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  shoot: 'Shoot (hold / release)', pass: 'Pass', through: 'Through ball', lob: 'Lob / lofted pass',
  sprint: 'Sprint', tackle: 'Standing tackle', slide: 'Slide tackle', switch: 'Switch player',
  skill: 'Skill move', pause: 'Pause',
};

export const DEFAULT_BINDS = Object.freeze({
  p1: Object.freeze({
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    shoot: 'Space', pass: 'KeyJ', through: 'KeyE', lob: 'KeyQ', sprint: 'ShiftLeft',
    tackle: 'KeyF', slide: 'KeyC', switch: 'Tab', skill: 'KeyR', pause: 'Escape',
  }),
  p2: Object.freeze({
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    shoot: 'Numpad0', pass: 'Numpad1', through: 'Numpad2', lob: 'Numpad3', sprint: 'ShiftRight',
    tackle: 'Numpad4', slide: 'Numpad5', switch: 'Numpad6', skill: 'Numpad7', pause: 'NumpadAdd',
  }),
});

export const STORAGE_KEY = 'touchline.keybinds.v1';

export function cloneBinds(b) {
  return { p1: { ...b.p1 }, p2: { ...b.p2 } };
}

export function defaultBinds() { return cloneBinds(DEFAULT_BINDS); }

/** Find which (player, action) currently uses a code, ignoring one slot. */
export function findBinding(binds, code, ignorePlayer, ignoreAction) {
  for (const pl of ['p1', 'p2']) {
    for (const a of ACTIONS) {
      if (pl === ignorePlayer && a === ignoreAction) continue;
      if (binds[pl][a] === code) return { player: pl, action: a };
    }
  }
  return null;
}

/**
 * Assign `code` to player/action. If another action already uses the code the two
 * bindings are swapped (the other action receives the old key). Returns new binds.
 */
export function setBind(binds, player, action, code) {
  const nb = cloneBinds(binds);
  const old = nb[player][action];
  const conflict = findBinding(nb, code, player, action);
  if (conflict) nb[conflict.player][conflict.action] = old;
  nb[player][action] = code;
  return { binds: nb, conflict, swapped: !!conflict };
}

/** Merge stored data with defaults, dropping anything invalid. */
export function sanitizeBinds(data) {
  const out = defaultBinds();
  if (!data || typeof data !== 'object') return out;
  for (const pl of ['p1', 'p2']) {
    if (!data[pl] || typeof data[pl] !== 'object') continue;
    for (const a of ACTIONS) {
      const c = data[pl][a];
      if (typeof c === 'string' && c.length > 0 && c.length < 32) out[pl][a] = c;
    }
  }
  return out;
}

export function loadBinds(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return defaultBinds();
    return sanitizeBinds(JSON.parse(raw));
  } catch (e) {
    return defaultBinds();
  }
}

export function saveBinds(storage, binds) {
  try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(binds)); return true; } catch (e) { return false; }
}

/** Human readable label for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return '—';
  const map = {
    Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', NumpadAdd: 'Num +', NumpadEnter: 'Num Enter',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
