// Owner (Oct 5): "plug it into the football game from the ban screen". The ban screen's Fight Suppression button now
// opens the Pitchside boss fight (3d/pitchside-boss, ?embed=1: always HARD; the full game is 3d/prototypes/claude-13) in a full-screen frame. The account flow is
// the same one the old fight used (migrations 020/021): a battleStart nonce before the fight, battleWin on victory
// (lifts the ban, makes the account immune), then claimBattleRewards. The frame talks back with postMessage:
//   { type: 'p13-victory', tier }  the boss is beaten   { type: 'p13-close' }  the player chose Return to Pitchside
// Same contract as launchVinsonBattle({ online, onWin, onClaim, onClose, resumeRewards }).
const CSS = `
.eb-screen { position: fixed; inset: 0; z-index: 25000; background: #050607; isolation: isolate; }
.eb-screen iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #050607; }
.eb-panel { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(5,7,8,.82); z-index: 2; padding: 20px; }
.eb-panel[hidden] { display: none; }
.eb-box { width: min(520px, 92vw); background: #101823; border-top: 4px solid #ff6a1f; padding: 24px 26px; color: #eef3f9; font: 500 17px/1.4 'Barlow Condensed', system-ui, sans-serif; }
.eb-box h2 { margin: 0 0 8px; font: 700 34px/1 'Barlow Condensed', system-ui, sans-serif; letter-spacing: .04em; color: #ffd7a1; }
.eb-box p { margin: 0 0 18px; color: #c8d0d6; }
.eb-row { display: flex; flex-wrap: wrap; gap: 10px; }
.eb-row button { font: 700 19px 'Barlow Condensed', system-ui, sans-serif; letter-spacing: .06em; border: 0; padding: 11px 22px; cursor: pointer; background: #1f2d42; color: #eef3f9; outline: none; }
.eb-row button:first-child { background: #ff6a1f; color: #0a0f14; }
.eb-row button:focus { outline: 3px solid #fff; outline-offset: 2px; }
`;

export function launchEclipseBattle({ parent = document.body, online, onWin, onClaim, onClose, resumeRewards = false } = {}) {
  if (document.querySelector('.eb-screen, .vb-screen')) return null;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const screen = document.createElement('section'); screen.className = 'eb-screen';
  screen.setAttribute('role', 'dialog'); screen.setAttribute('aria-modal', 'true'); screen.setAttribute('aria-label', 'Boss fight');
  const frame = document.createElement('iframe');
  frame.src = new URL('../../../pitchside-boss/?embed=1', import.meta.url).href;
  frame.title = 'Boss fight'; frame.allow = 'autoplay; fullscreen';
  const panel = document.createElement('div'); panel.className = 'eb-panel'; panel.hidden = true;
  screen.append(frame, panel); parent.append(screen);
  const oldFocus = document.activeElement, oldOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  let nonce = null, busy = false, closed = false, confirmed = false;

  function show(title, text, actions) {
    const box = document.createElement('div'); box.className = 'eb-box';
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'eb-row';
    for (const [label, fn] of actions) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; row.append(b); }
    box.append(h, p, row); panel.replaceChildren(box); panel.hidden = !title;
    row.querySelector('button')?.focus();
  }
  const hide = () => { panel.hidden = true; panel.replaceChildren(); focusFight(); };
  const focusFight = () => { try { frame.focus(); frame.contentWindow?.focus(); } catch {} };
  frame.addEventListener('load', focusFight);

  // the fight needs a server nonce before it counts (the server also checks a minimum fight time)
  async function begin() {
    if (resumeRewards) { confirmed = true; show('Victory confirmed', 'Your curse is broken. Collect your three exclusive cards.', [['Collect rewards', claim], ['Return to Pitchside', close]]); return; }
    if (!online?.vinson?.battleStart) return; // offline preview: just play
    busy = true; show('Opening the fight', 'Getting your fight ready…', []);
    try {
      const r = await online.vinson.battleStart();
      if (closed) return;
      if (!r?.ok) { show('Unable to start', 'Your fight could not start. Try again shortly.', [['Retry', begin], ['Return to Pitchside', close]]); return; }
      nonce = r.nonce; hide();
    } catch { if (!closed) show('Connection interrupted', 'Try again when your connection returns.', [['Retry', begin], ['Return to Pitchside', close]]); }
    finally { busy = false; }
  }
  async function confirmVictory() {
    if (busy || closed) return;
    if (!online?.vinson?.battleWin) { show('Victory', 'You beat her. (Offline preview: nothing to unlock.)', [['Return to Pitchside', close], ['Keep playing', hide]]); return; }
    busy = true; show('Victory', 'Confirming your victory and curse protection…', []);
    try {
      const r = onWin ? await onWin({ nonce }) : await online.vinson.battleWin({ nonce });
      if (closed) return;
      if (!r?.ok || !r.immune) {
        const wait = r?.error === 'too_soon' ? `The server needs ${Math.max(1, Math.ceil(Number(r.retryAfter) || 60))} more seconds before confirming. Retry after that wait.` : 'Your victory could not be confirmed. Your curse is still active.';
        show('Victory', wait, [['Retry confirmation', () => { busy = false; confirmVictory(); }], ['Return to Pitchside', close]]); return;
      }
      confirmed = true;
      show('The curse is broken', 'Congratulations. Claim your three exclusive cards. Vinson can no longer curse this account.', [['Collect rewards', claim], ['Return to Pitchside', close]]);
    } catch { if (!closed) show('Victory', 'Connection interrupted. Retry to confirm your victory.', [['Retry confirmation', () => { busy = false; confirmVictory(); }], ['Return to Pitchside', close]]); }
    finally { busy = false; }
  }
  async function claim() {
    if (!confirmed || busy || closed) return;
    busy = true;
    try {
      const r = onClaim ? await onClaim() : await online?.vinson?.claimBattleRewards?.();
      if (closed) return;
      if (!r?.ok) { show('Rewards pending', 'Your victory is confirmed. Retry collecting your rewards.', [['Retry collection', claim], ['Return to Pitchside', close]]); return; }
      show('Congratulations', 'Your rewards are ready in your club.', [['Return to Pitchside', close]]);
    } catch { if (!closed) show('Rewards pending', 'Try again when your connection returns.', [['Retry collection', claim], ['Return to Pitchside', close]]); }
    finally { busy = false; }
  }
  function onMessage(e) {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const t = e.data && e.data.type;
    if (t === 'p13-close') close();
    else if (t === 'p13-victory') confirmVictory();
  }
  addEventListener('message', onMessage);
  function close() {
    if (closed) return; closed = true;
    removeEventListener('message', onMessage);
    screen.remove(); style.remove(); document.documentElement.style.overflow = oldOverflow;
    oldFocus?.focus?.(); onClose?.();
  }
  void begin();
  return { close };
}
