// Pack opening entry point. Two interchangeable animations, chosen by the `packAnim` setting
// (pitchside.meta.settings.packAnim: 'new' | 'classic', default 'new'; switchable on the pack screen):
//   new     -> packopen_fut.js      FUT-style rip, light column, banners reveal, figure at the very end
//   classic -> packopen_classic.js  the previous 3D tunnel cinematic (lazy-loaded, it pulls in three.js)
// Both end in the same item grid (packopen_common.js makeGrid).
import { runFut } from './packopen_fut.js';
import { readPackAnim, writePackAnim, ensureCss, pinOverlay, pinSkip, lockScroll, fallbackReveal, makeGrid } from './packopen_common.js';

// Request the pack stage stylesheet as soon as Ultimate Team loads, not on the first pack (see packopen_common.js).
if (typeof document !== 'undefined') ensureCss();

export { packArt, positionName, readPackAnim, writePackAnim } from './packopen_common.js';

/**
 * root: container to append the overlay into
 * opts: { pack, items:[{pid, dup}], getPlayer, sellValue(p), onSend(pid), onSell(pid)->coins, onDone(summary),
 *         userKit?:{primary,secondary,shorts?,socks?} — user's club colours for the 3D walkout kit,
 *         settings?/saveSettings? — the app's live settings object (packAnim is read/written there when given),
 *         anim?: 'new'|'classic' — force one animation (tests) }
 * returns { destroy(), skip() }
 */
export function runPackOpening(root, opts) {
  let handle = null, dead = false;
  const run = (mode) => {
    const runOpts = { ...opts, onSwitchAnim: (m) => { writePackAnim(opts, m); if (handle) handle.destroy(); handle = null; run(m); } };
    if (mode === 'classic') {
      import('./packopen_classic.js')
        .then((m) => { if (!dead) handle = m.runClassic(root, runOpts); })
        .catch((err) => { console.warn('Classic pack animation unavailable; using the new one.', err); if (!dead) handle = runFut(root, runOpts); });
    } else {
      try { handle = runFut(root, runOpts); } catch (err) { console.warn('Pack animation failed to build; showing the 2D reveal.', err); handle = runPlain(root, runOpts); }
    }
  };
  run(opts.anim || readPackAnim(opts));
  return {
    destroy() { dead = true; if (handle) handle.destroy(); },
    skip() { if (handle) handle.skip(); },
    get current() { return handle; },
  };
}

/** Last-resort opening with no cinematic at all: self-styled 2D reveal -> the item grid. Never needs packs.css/WebGL. */
function runPlain(root, opts) {
  const { pack, items, getPlayer } = opts;
  const players = items.map((it) => ({ ...it, p: getPlayer(it.pid), state: 'new' }));
  const best = players[0].p;
  const unlock = lockScroll();
  const ov = pinOverlay(document.createElement('div'));
  ov.className = 'pm-po is-plain'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  const stage = document.createElement('div'); stage.className = 'pm-po-stage';
  root.appendChild(ov);
  let dead = false;
  const toGrid = () => {
    if (dead || ov.classList.contains('is-grid')) return;
    ov.replaceChildren(stage); ov.classList.add('is-grid', 'is-flare'); ov.style.overflowY = 'auto';
    grid.render();
  };
  const skip = pinSkip(document.createElement('button'));
  skip.className = 'pm-po-skip pm-btn pm-btn--ghost'; skip.textContent = 'Skip ›'; skip.onclick = toGrid;
  function destroy() { dead = true; unlock(); ov.remove(); }
  const grid = makeGrid(stage, pack, players, opts, destroy);
  fallbackReveal(ov, pack, best, toGrid);
  ov.appendChild(skip);
  return { destroy, skip: toGrid };
}
