// Default keyboard bindings for the 3D match. Values are KeyboardEvent.code strings
// (or 'Mouse0'/'Mouse2' for mouse buttons). Player 2 is used for local 2-player matches.
export const DEFAULT_KEYBINDS = {
  p1: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    sprint: 'ShiftLeft', pass: 'KeyJ', through: 'KeyI', lob: 'KeyU',
    shoot: 'KeyK', finesse: 'KeyL', switchP: 'KeyQ', tackle: 'KeyE', skill: 'KeyR',
    pause: 'Escape',
  },
  p2: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    sprint: 'ShiftRight', pass: 'Numpad1', through: 'Numpad5', lob: 'Numpad4',
    shoot: 'Numpad2', finesse: 'Numpad3', switchP: 'Numpad0', tackle: 'NumpadDecimal', skill: 'Numpad6',
    pause: 'KeyP',
  },
};

const KEY = 'pitchside.keybinds';

export function loadKeybinds() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      return {
        p1: { ...DEFAULT_KEYBINDS.p1, ...(saved.p1 || {}) },
        p2: { ...DEFAULT_KEYBINDS.p2, ...(saved.p2 || {}) },
      };
    }
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_KEYBINDS);
}

export function saveKeybinds(binds) {
  try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch { /* ignore */ }
}

export function resetKeybinds() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return structuredClone(DEFAULT_KEYBINDS);
}
