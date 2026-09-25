// Pitchside 3D — meta layer public API (Career Mode + Pitchside Ultimate Team).
// See docs/3D_CONTRACT.md. No DOM access happens at import time.
import { MetaApp } from './ui/app.js';
import { getNationalTeams as buildNationalTeams } from './core/teams.js';
import { loadUT, utTeam } from './core/ut.js';

/**
 * Mount the meta UI inside `container`.
 * @param {HTMLElement} container
 * @param {{ startMatch:(home, away, opts) => Promise<object>, onExit?: () => void }} options
 *   startMatch opts passed: { halfMinutes, difficulty, userSide: 'home'|'away', mode: 'ut'|'career', knockout? }
 *   onExit (optional, non-contract extra): when given, a Back button on the root screen calls it.
 * @returns {{ showCareer(): void, showUltimateTeam(): void, destroy(): void }}
 */
export function mountMeta(container, { startMatch, onExit } = {}) {
  const app = new MetaApp(container, { startMatch, onExit });
  return {
    showCareer: () => app.showCareer(),
    showUltimateTeam: () => app.showUltimateTeam(),
    destroy: () => app.destroy(),
  };
}

/** ≥ 24 national teams (real kit colours, fictional generated players). Returns fresh copies. */
export function getNationalTeams() {
  return buildNationalTeams();
}

/** The user's saved Ultimate Team squad as a contract Team, or null (no club / incomplete XI). */
export function getSavedUltimateTeam() {
  try {
    const st = loadUT();
    return st ? utTeam(st) : null;
  } catch {
    return null;
  }
}
