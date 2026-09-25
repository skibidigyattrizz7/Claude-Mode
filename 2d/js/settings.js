// Persistent game settings.
import { store } from './storage.js';

const KEY = 'touchline.settings.v1';

export const DEFAULT_SETTINGS = {
  matchMinutes: 4,          // real minutes for a full 90' match
  difficulty: 'Normal',
  assist: 'Assisted',       // Assisted | Precision | Manual
  sound: true,
  aimLine: true,
  zoom: 1.0,
  penaltyPower: 'hold',     // hold | slider (both always work; this chooses the default hint)
};

export const settings = { ...DEFAULT_SETTINGS, ...(store.get(KEY, {}) || {}) };

export function saveSettings() { store.set(KEY, settings); }
