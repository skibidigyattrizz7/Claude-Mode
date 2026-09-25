// Gameplay assist settings shared by the settings UI (main.js) and the engine.
// Persisted in localStorage 'pitchside.gameplay'. Passed to createMatch as opts.gameplay
// (per side: opts.gameplay.home / opts.gameplay.away, so each human keeps their own).
export const GAMEPLAY_DEFAULTS = {
  passAssist: 'assisted',      // 'assisted' | 'semi' | 'manual'   (ground passes)
  throughAssist: 'assisted',   // 'assisted' | 'semi' | 'manual'
  lobAssist: 'assisted',       // 'assisted' | 'semi' | 'manual'   (lobs + crosses)
  shotAssist: 'assisted',      // 'assisted' | 'precision' | 'manual'
  timedFinishing: false,       // tap shoot again at contact for bonus accuracy
  autoSwitch: 'auto',          // 'auto' | 'airballs' | 'manual'
  autoSwitchAssist: 'high',    // 'none' | 'low' | 'high'  (move help right after a switch)
  aiDefending: 'assisted',     // 'assisted' (teammates contain/press/cover for you) | 'tactical' (you do the work)
  autoMarking: true,           // AI teammates track runners automatically
  autoTackle: false,           // controlled player auto-pokes when ball is in reach while defending
  jockeyAssist: true,          // hold sprint-less contain key auto-faces the ball carrier
  passReceiverLock: 'earlyRelease', // 'off' | 'earlyRelease' | 'lateRelease'
  switchOnPass: 'instant',     // 'instant' (on strike) | 'release' (ball halfway) | 'receive' (on reception)
  autoShots: false,            // auto-shoot on first-time chances (arcade)
  autoClearances: true,        // defenders clear danger automatically when not controlled
  shotError: false,            // extra error for off-balance/pressured shots (sim realism)
  nextPlayerIndicator: true,   // show who Q will switch to
  cameraShake: true,
  showAimLine: true,
};

const KEY = 'pitchside.gameplay';
export function loadGameplay() {
  try { return { ...GAMEPLAY_DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || 'null') || {}) }; }
  catch { return { ...GAMEPLAY_DEFAULTS }; }
}
export function saveGameplay(g) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* ignore */ } }
