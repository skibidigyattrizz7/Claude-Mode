// Pack opening entry point. Two interchangeable animations, chosen by the `packAnim` setting
// (pitchside.meta.settings.packAnim: 'new' | 'classic', default 'new'; switchable on the pack screen):
//   new     -> packopen_fut.js      FUT-style rip, light column, banners reveal, figure at the very end
//   classic -> packopen_classic.js  the previous 3D tunnel cinematic (lazy-loaded, it pulls in three.js)
// Both end in the same item grid (packopen_common.js makeGrid).
import { runFut } from './packopen_fut.js';
import { readPackAnim, writePackAnim } from './packopen_common.js';

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
    } else handle = runFut(root, runOpts);
  };
  run(opts.anim || readPackAnim(opts));
  return {
    destroy() { dead = true; if (handle) handle.destroy(); },
    skip() { if (handle) handle.skip(); },
    get current() { return handle; },
  };
}
