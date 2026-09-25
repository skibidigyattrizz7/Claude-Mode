// Pitchside 3D — meta layer public API (Career Mode + Pitchside Ultimate Team).
// See docs/3D_CONTRACT.md. No DOM access happens at import time.
import { MetaApp } from './ui/app.js';
import { getNationalTeams as buildNationalTeams } from './core/teams.js';
import { loadUT, utTeam } from './core/ut.js';
export { redeemAdminCode, getAdminLevel, lockRemainingMs as adminLockRemainingMs, adminInfo } from './core/admin.js';

/**
 * Mount the meta UI inside `container`.
 * @param {HTMLElement} container
 * @param {{ startMatch:(home, away, opts) => Promise<object>, startOnlineMatch?: (o:{mode:'ut', team}) => Promise<object>,
 *           online?: object, onExit?: () => void }} options
 *   startMatch opts passed: { halfMinutes, difficulty, userSide: 'home'|'away', mode: 'ut'|'career'|'draft'|'tournament', knockout? }
 *   startOnlineMatch (V2): runs matchmaking + an online UT match (main.js); `online` = net/services.js `online` object.
 *   Both are optional: without them the Player Market / Online Seasons / Admin show an "unavailable" state.
 *   onExit (optional): when given, a Back button on the root screen calls it.
 * @returns {{ showCareer(): void, showUltimateTeam(): void, showAdmin(): void, destroy(): void }}
 */
export function mountMeta(container, { startMatch, startOnlineMatch = null, online = null, onExit } = {}) {
  const app = new MetaApp(container, { startMatch, startOnlineMatch, online, onExit });
  return {
    showCareer: () => app.showCareer(),
    showUltimateTeam: () => app.showUltimateTeam(),
    showAdmin: () => app.showAdmin(),
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
