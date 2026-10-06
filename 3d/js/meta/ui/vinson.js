// EVIL VINSON presentation and lifecycle. This is global (not tied to a UT view), so a timer continues when
// the player changes screens. Server status is polled while active; the saved absolute deadline survives reload.
import { loadUT, saveUT } from '../core/ut.js';
import { beginDoom, release, advance, reconcileServer, squadChanged, enforceLock, isOwner, cursedPack, hasDoomEffects, BAN_MESSAGE, MATCH_MESSAGE } from '../core/vinson.js';
import { HELL_CARD_ID } from '../core/secretcard.js';
import { forfeitVinsonSquad } from '../core/vinsonforfeit.js';
import { fractureElement } from './vinsonfracture.js';
import { applyVinsonRewardClaim, hasPendingVinsonRewards } from '../core/vinsonrewards.js';

const asset = (name) => new URL(`../../../assets/cards/${name}`, import.meta.url).href;
const warning = asset('vinson-warning.png');
const planet = asset('vinson-planet.png');
const stamp = (s) => `pitchside.vinson.shown.${s}`;
const seconds = (ms) => String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0');
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const OMENS = ["DON'T DO IT", "IT'S OVER", "YOU'RE DONE", "SHE'S COMING", 'LOOK BEHIND YOU', 'THE CLOCK IS LYING'];

export function startVinsonExperience(online, { initialState = loadUT(), ephemeral = false } = {}) {
  if (globalThis.__pitchsideVinson) return globalThis.__pitchsideVinson;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('../../../css/vinson.css?v=vinson14', import.meta.url).href;
  document.head.appendChild(css);
  const host = document.createElement('div'); host.id = 'vinson-experience'; document.body.appendChild(host);
  let app = null, localState = initialState, boundId = online?.identityId?.() || null;
  let busy = false, current = '', cinematic = false, interval = null, remoteInterval = null, lastOmen = -1, falling = false;
  const broken = new Map();
  let soundContext = null, battleExperience = null, battleOpening = false, experienceClosed = false;
  const damagedKeys = new Set();
  const controlSelector = 'button, [role="tab"], a, input, select, textarea, .pc-card, .pm-slot';
  // Semantic surfaces break individually; piece containers are a fallback only for an empty background click.
  const pieceSelector = '.pm-tile, .pm-storeitem, .pm-packitem, .pm-coins, .pm-crest';
  const surfaceSelector = 'img, svg, canvas, h1, h2, h3, h4, p, label, span, small, strong, b, em, i, .pm-pack, .pm-price, .pm-coin';
  const controlKey = (el) => {
    if (el.dataset.uttab) return `tab:${el.dataset.uttab}`;
    const address = [];
    for (let node = el; node && node !== root(); node = node.parentNode) {
      const parent = node.parentNode;
      address.unshift(`${node.tagName}:${parent ? [...parent.children].indexOf(node) : 0}`);
    }
    return `${address.join('/')}:${el.getAttribute('aria-label') || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 90) || el.id}`;
  };
  const state = () => app?.ut || localState;
  const persist = (s) => { if (app?.ut === s) app.saveUT(); else if (s) saveUT(s); };
  const remember = (key) => { if (ephemeral) return null; try { return sessionStorage.getItem(key); } catch { return null; } };
  const mark = (key) => { if (ephemeral) return; try { sessionStorage.setItem(key, '1'); } catch { /* private mode */ } };
  const make = (tag, cls, txt) => { const el = document.createElement(tag); el.className = cls; if (txt) el.textContent = txt; return el; };
  const bloodTitle = (target, text) => {
    target.replaceChildren();
    target.setAttribute('aria-label', text);
    target.setAttribute('role', 'heading'); target.setAttribute('aria-level', '2');
    text.split(' ').forEach((word, wordIndex) => {
      const group = make('span', 'vinson-blood-word'); group.setAttribute('aria-hidden', 'true');
      [...word].forEach((letter, i) => {
        const glyph = make('span', 'vinson-blood-letter', letter);
        glyph.style.setProperty('--blood-length', `${.14 + ((i * 7 + wordIndex * 3) % 9) * .035}em`);
        glyph.style.setProperty('--blood-delay', `${(i % 4) * -.27}s`);
        group.append(glyph);
      });
      target.append(group, document.createTextNode(' '));
    });
  };
  const infected = (phase) => hasDoomEffects(phase) || phase === 'locked';
  const root = () => app?.root?.isConnected ? app.root : document.querySelector('.pm-root');
  function repairUi() {
    for (const [el, wasInert] of broken) { el.classList.remove('vinson-control-broken', 'vinson-tab-falling'); el.inert = wasInert; }
    broken.clear(); root()?.classList.remove('vinson-ui-falling');
    damagedKeys.clear();
    root()?.querySelectorAll('.vinson-control-gone').forEach((el) => { el.classList.remove('vinson-control-gone'); el.inert = false; });
    document.querySelectorAll('.vinson-fracture').forEach((el) => el.remove());
    falling = false;
  }
  function breakControl(target, cls = 'vinson-control-broken') {
    if (broken.has(target)) return;
    broken.set(target, target.inert);
    damagedKeys.add(controlKey(target));
    target.classList.add(cls);
    // Let its first click finish (including removing Vinson during a warning), then the broken control is gone.
    queueMicrotask(() => { if (broken.has(target)) target.inert = true; });
    if (target.matches('.pm-slot')) setTimeout(() => {
      if (['warn', 'consequence'].includes(state()?.vinson?.phase) && broken.has(target)) {
        target.inert = broken.get(target); target.classList.remove('vinson-control-broken'); broken.delete(target);
        damagedKeys.delete(controlKey(target));
      }
    }, 1300);
    for (const el of broken.keys()) if (!el.isConnected) broken.delete(el);
  }
  function onInfectedClick(event) {
    if (!infected(state()?.vinson?.phase) || isOwner(online)) return;
    const frame = root();
    if (!frame?.contains(event.target)) return;
    // The original pull still needs to finish assigning/selling its items and close.
    // Cursed aftermath grids have their own capture handler and cannot award coins.
    if (event.target.closest?.('.pm-po, .pm-po-stage, .pm-po-gridwrap, .pm-po-fallback')) return;
    const control = event.target.closest?.(controlSelector);
    const surface = event.target.closest?.(surfaceSelector);
    const piece = event.target.closest?.(pieceSelector);
    const target = control || surface || (piece?.children.length === 0 ? piece : null);
    if (target && root()?.contains(target)) {
      if (target.matches('[data-uttab="home"], .pm-tile--ut')) return;
      if (target.matches('.pm-back') && app?.stack?.some((view) => view.utHome)) {
        event.preventDefault(); event.stopImmediatePropagation();
        app.popTo((view) => view.utHome); app.refresh(); return;
      }
      if (broken.has(target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const label = (target.textContent || '').trim();
      const dialog = target.closest('.pm-modal');
      // Escape routes must remain available even if a stale dialog was open when the curse began.
      if (dialog && (target.matches('.pm-x') || /^(cancel|close|back)$/i.test(label))) return;
      const lockedPack = cursedPack(state());
      const packEntry = lockedPack && (
        (!!target.closest('.pm-storeitem, .pm-show-info') && /^buy & open$/i.test(label)) ||
        (!!target.closest('.pm-packitem') && /^open$/i.test(label)) ||
        (dialog && /pack/i.test(dialog.getAttribute('aria-label') || '') && !/manager/i.test(dialog.getAttribute('aria-label') || '') && /^buy & open$/i.test(label))
      );
      const packScene = lockedPack && !!target.closest('.pm-po, .pm-po-stage, .pm-po-gridwrap, .pm-po-fallback');
      const matchScene = lockedPack && /^(play|start match|play rivals|play squad battles|kick off)$/i.test(label);
      const curseRoute = lockedPack && target.matches('.pm-uttab, .pm-hx');
      const squadWarning = ['warn', 'consequence'].includes(state()?.vinson?.phase) && !!target.closest('.pm-sq');
      fractureElement(target, { x: event.clientX, y: event.clientY });
      // Result screens own their coordinated button collapse and exit timer.
      if (!packScene) breakControl(target);
      if (!packEntry && !packScene && !matchScene && !squadWarning && !curseRoute) {
        event.preventDefault(); event.stopImmediatePropagation();
        // Close blocked dialogs through their normal close callback so pending confirmations resolve false.
        if (dialog) setTimeout(() => dialog.querySelector('.pm-x')?.click(), 1150);
      }
    }
  }
  document.addEventListener('click', onInfectedClick, true);
  const damageObserver = new MutationObserver(() => {
    if (!infected(state()?.vinson?.phase) || isOwner(online) || !damagedKeys.size) return;
    root()?.querySelectorAll(`${controlSelector}, ${surfaceSelector}`).forEach((el) => {
      if (!broken.has(el) && damagedKeys.has(controlKey(el))) {
        if (['warn', 'consequence'].includes(state()?.vinson?.phase) && el.matches('.pm-slot')) return;
        el.classList.add('vinson-control-gone'); el.inert = true;
      }
    });
  });
  damageObserver.observe(document.body, { childList: true, subtree: true });
  function collapseUi(done) {
    const frame = root();
    const pieces = frame && [...frame.querySelectorAll('.pm-top, .pm-uttab, .pm-main > section, .pm-main > .pm-section, .pm-main > .pm-panel')]
      .filter((el) => el.getBoundingClientRect().height > 8).slice(0, 14);
    if (!pieces?.length || reduce()) { done(); return; }
    const curtain = make('div', 'vinson-collapse');
    curtain.append(make('div', 'vinson-collapse-blood'));
    pieces.forEach((el, i) => {
      const r = el.getBoundingClientRect(), shard = make('div', 'vinson-collapse-piece');
      shard.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--delay:${i < 4 ? i * .22 : 1.02 + (i % 3) * .07}s`;
      shard.append(el.cloneNode(true)); curtain.append(shard);
    });
    document.body.append(curtain);
    setTimeout(() => { curtain.remove(); done(); }, 2300);
  }
  function sound(kind) {
    try {
      const settings = JSON.parse(localStorage.getItem('meta.settings') || '{}');
      const volume = Math.min(1, Math.max(0, Number(settings.volume ?? 70) / 100));
      if (!volume || document.hidden) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      soundContext ||= new Context();
      if (soundContext.state !== 'running') { void soundContext.resume(); return; }
      const now = soundContext.currentTime;
      const notes = kind === 'impact' ? [[43, .75], [57, 1.25], [36, 1.8]]
        : kind === 'warning' ? [[62, .24], [49, .34]] : [[56, .42], [41, .65]];
      for (const [frequency, length] of notes) {
        const oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
        oscillator.type = kind === 'impact' ? 'sawtooth' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(27, frequency * .65), now + length);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume * (kind === 'impact' ? .045 : .025), now + .035);
        gain.gain.exponentialRampToValueAtTime(.0001, now + length);
        oscillator.connect(gain).connect(soundContext.destination);
        oscillator.start(now); oscillator.stop(now + length + .02);
      }
    } catch { /* audio is optional */ }
  }

  function draw() {
    const s = state(); if (!s || isOwner(online)) { repairUi(); host.replaceChildren(); document.body.classList.remove('vinson-infected', 'vinson-critical', 'vinson-aftermath'); current = ''; return; }
    const v = s.vinson; const phase = v?.phase || '';
    if (!infected(phase) && phase !== 'banned' &&
      (infected(current) || current === 'banned' || broken.size || damagedKeys.size || falling)) repairUi();
    document.body.classList.toggle('vinson-infected', infected(phase));
    document.body.classList.toggle('vinson-critical', phase === 'doom' && v.doomUntil - Date.now() <= 10000);
    document.body.classList.toggle('vinson-aftermath', phase === 'warn' || phase === 'consequence');
    if (!phase || phase === 'lifted') {
      repairUi(); cinematic = false;
      const pendingRewards = hasPendingVinsonRewards(s);
      if (current !== phase || pendingRewards !== !!host.querySelector('.vb-fight-button')) {
        host.replaceChildren(); current = phase;
        if (pendingRewards) {
          const claim = make('button', 'vb-fight-button', 'COLLECT VICTORY REWARDS');
          claim.onclick = () => { void controller.openBattle(); }; host.append(claim);
        }
      }
      return;
    }
    if (phase === 'freed') { if(current!==phase){host.replaceChildren(fightButton(true));current=phase;} cinematic = false; return; }
    if (phase === 'doom' && v.doomUntil - Date.now() <= 10000) {
      const left = Math.max(0, v.doomUntil - Date.now());
      const tabs = [...(root()?.querySelectorAll('.pm-uttab') || [])].filter(tab => tab.dataset.uttab !== 'home');
      const n = Math.min(tabs.length, Math.floor((10000 - left) / 850));
      for (let i = 0; i < n; i++) breakControl(tabs[i], 'vinson-tab-falling');
      if (left <= 3000 && !falling) { falling = true; root()?.classList.add('vinson-ui-falling'); }
      if (!host.querySelector('.vinson-countdown-blood')) host.append(make('div', 'vinson-countdown-blood'));
    }
    if (phase === 'banned') {
      const key = stamp(`${online?.identityId?.() || 'guest'}.${v.doomUntil}`);
      if (current !== 'banned') { host.replaceChildren(); current = 'banned'; cinematic = false; }
      if (!cinematic) {
        cinematic = true;
        if (remember(key) || reduce()) finalScene();
        else if (falling) playCinematic(key);
        else collapseUi(() => { if (current === 'banned') playCinematic(key); });
      }
      const final = host.querySelector('.vinson-final');
      const cycle = Math.floor(Date.now() / 7000);
      if (final && final.dataset.hauntCycle !== String(cycle)) {
        final.dataset.hauntCycle = String(cycle);
        [...final.querySelectorAll('.vinson-final-word, .vinson-final-ghosts img')].forEach((el, i) => {
          const rand = (n) => (Math.sin((cycle + i * 17) * n) * 1437.71 % 1 + 1) % 1;
          const width = Math.min(el.getBoundingClientRect().width, innerWidth * .52);
          const height = Math.min(el.getBoundingClientRect().height, innerHeight * .3);
          el.style.left = `${Math.max(16, rand(13) * (innerWidth - width - 40))}px`;
          el.style.top = `${Math.max(32, rand(31) * (innerHeight - height - 70))}px`;
          el.style.right = 'auto'; el.style.bottom = 'auto';
        });
      }
      return;
    }
    if (phase === 'locked') {
      if (current !== phase) { host.replaceChildren(fightButton(true)); current = phase; }
      return;
    }
    if (current !== phase) {
      host.replaceChildren(); current = phase;
      const box = make('div', `vinson-notice vinson-${phase}`);
      box.setAttribute('role', 'alert');
      const titleText = phase === 'doom' ? 'DOOM HAS BEEN BROUGHT UPON YOU'
        : phase === 'warn' ? "IT'S NOT WORTH IT" : phase === 'consequence' ? 'THIS ACTION WILL HAVE CONSEQUENCES' : "YOU'VE BEEN CURSED BY VINSON";
      const title = make('strong', 'vinson-notice-title');
      bloodTitle(title, titleText);
      box.append(title);
      if (phase !== 'locked') box.append(make('span', 'vinson-timer'));
      if (phase === 'doom') box.append(glitchSlices());
      host.append(box);
      if (['warn','consequence'].includes(phase))host.append(fightButton(true));
      if (phase === 'doom') {
        const omens = make('div', 'vinson-omens'); omens.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 8; i++) omens.append(make('span', `vinson-omen vinson-omen-${i % 4}`, OMENS[i % OMENS.length]));
        host.append(make('div', 'vinson-edge'), omens, make('div', 'vinson-whisper'));
      }
    }
    const t = host.querySelector('.vinson-timer');
    if (t) {
      const left = phase === 'doom' ? v.doomUntil - Date.now() : v.phaseUntil - Date.now();
      t.textContent = phase === 'doom' ? `${Math.floor(Math.max(0, left) / 60000)}:${seconds(left % 60000)}` : `${seconds(left)} seconds`;
    }
    const whisper = host.querySelector('.vinson-whisper');
    if (whisper) {
      const index = Math.floor(Date.now() / 4500);
      if (index !== lastOmen) {
        lastOmen = index; whisper.textContent = OMENS[index % OMENS.length];
        whisper.style.left = `${5 + (index * 31) % 58}%`;
        whisper.style.top = `${21 + (index * 19) % 52}%`;
        whisper.style.setProperty('--tilt', `${(index % 2 ? 1 : -1) * (4 + index % 7)}deg`);
      }
    }
  }

  function fightButton(floating=false) {
    const fight = make('button', floating ? 'vinson-fight-link vinson-fight-floating' : 'vinson-fight-link', 'Fight Suppression');
    fight.onclick = async () => {
      fight.disabled = true; fight.textContent = 'Opening fight…';
      try {
        const opened = await controller.openBattle();
        fight.textContent = opened ? 'Fight Suppression' : 'Fight unavailable. Try again';
      } catch { fight.textContent = 'Could not load fight. Try again'; }
      finally { fight.disabled = false; }
    };
    return fight;
  }

  function finalScene() {
    host.replaceChildren();
    const screen = make('div', 'vinson-screen vinson-final'); screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-label', BAN_MESSAGE);
    const art = make('div', 'vinson-planet-art');
    const bg = document.createElement('img'); bg.src = planet; bg.alt = 'Vinson holding the Earth';
    const orb = make('div', 'vinson-spinning-earth'); const crop = document.createElement('img'); crop.src = planet; crop.alt = '';
    orb.append(crop); art.append(bg, orb);
    const ghosts = make('div', 'vinson-final-ghosts'); ghosts.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 6; i++) { const img = document.createElement('img'); img.src = warning; img.alt = ''; ghosts.append(img); }
    screen.append(glitchSlices(), ghosts, make('div', 'vinson-final-embers'), make('span', 'vinson-final-kicker', 'THE END OF YOUR SQUAD'), art,
      make('strong', 'vinson-final-title', BAN_MESSAGE));
    const words = make('div', 'vinson-final-words'); words.setAttribute('aria-hidden', 'true');
    OMENS.forEach((omen, i) => words.append(make('span', `vinson-final-word vinson-final-word-${i}`, omen)));
    screen.append(words);
    const check = make('button', 'vinson-check', 'ESCAPE THE WRATH OF VINSON'); check.onclick = () => location.reload(); screen.append(check);
    const fight=fightButton();
    screen.append(fight);
    host.append(screen);
    sound('impact');
  }

  function playCinematic(key) {
    host.replaceChildren();
    const screen = make('div', 'vinson-screen vinson-cinematic'); screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-label', "IT'S NOT WORTH IT");
    const prologue = make('div', 'vinson-prologue');
    const warningTitle = make('strong', 'vinson-blood-heading'); bloodTitle(warningTitle, 'YOU WERE WARNED'); prologue.append(warningTitle);
    const tile = make('div', 'vinson-tiles');
    const intertitle = make('strong', 'vinson-intertitle');
    screen.append(tile, glitchSlices(), prologue, intertitle); host.append(screen);
    let count = 0;
    const addTile = (i) => {
      const cell = make('div', 'vinson-tile');
      const image = document.createElement('img'); image.src = warning; image.alt = '';
      cell.append(image);
      if (i < 4) cell.classList.add(`corner-${i}`);
      else {
        // Seeded placement makes this event stable across a repaint, without a rigid grid.
        const rand = (n) => ((Math.sin((i + 1) * n * 93.17) * 43758.5453) % 1 + 1) % 1;
        const width = Math.min(innerWidth * (.12 + rand(31) * .19), innerHeight * .29);
        const height = width * 594 / 477;
        cell.style.left = `${rand(13) * Math.max(0, innerWidth - width - 20)}px`;
        cell.style.top = `${rand(29) * Math.max(0, innerHeight - height - 20)}px`;
        cell.style.width = `${width}px`; cell.style.setProperty('--tilt', `${(rand(7) - .5) * 10}deg`);
      }
      tile.append(cell);
    };
    const batch = () => {
      if (current !== 'banned' || !host.contains(screen)) return;
      addTile(count++);
      if (count === 12 || count === 32 || count === 54) {
        bloodTitle(intertitle, count === 12 ? 'SHE IS HERE' : count === 32 ? 'THERE IS NO ESCAPE' : "IT'S NOT WORTH IT");
        intertitle.classList.remove('vinson-intertitle-show');
        void intertitle.offsetWidth;
        intertitle.classList.add('vinson-intertitle-show');
        sound('warning');
      }
      if (count < 70) setTimeout(batch, Math.max(35, 1100 - count * 19));
      else {
        // Fill uncovered areas behind the random foreground portraits. Overlap and jitter hide the coverage lattice.
        const width = Math.min(innerWidth * .28, innerHeight * .34);
        const height = width * 594 / 477, stepX = width * .72, stepY = height * .72;
        const fills = [];
        for (let y = -height * .15; y < innerHeight; y += stepY) for (let x = -width * .15; x < innerWidth; x += stepX) {
          fills.push({x, y});
        }
        const fill = (i) => {
          if (current !== 'banned' || !host.contains(screen)) return;
          const cell = make('div', 'vinson-tile');
          const image = document.createElement('img'); image.src = warning; image.alt = '';
          cell.append(image);
          const jitter = Math.sin(i * 29.7);
          cell.style.cssText = `left:${fills[i].x + jitter * width * .04}px;top:${fills[i].y - jitter * height * .04}px;width:${width}px;max-width:none;--tilt:${jitter * 4}deg`;
          tile.prepend(cell);
          if (i + 1 < fills.length) setTimeout(() => fill(i + 1), Math.max(18, 90 - i * 3));
          else {
            screen.classList.add('vinson-filled');
            setTimeout(() => {
            setTimeout(() => {
              screen.classList.add('vinson-blackout'); sound('impact');
              setTimeout(() => { if (current === 'banned' && host.contains(screen)) finalScene(); }, 6500);
            }, 1000);
          }, 800);
          }
        };
        fill(0);
      }
    };
    mark(key); sound('impact');
    setTimeout(() => {
      if (current !== 'banned' || !host.contains(screen)) return;
      prologue.classList.add('vinson-prologue-out');
      for (let i = 0; i < 4; i++) addTile(count++);
      setTimeout(batch, 1100);
    }, 1600);
  }

  function glitchSlices() {
    const layer = make('div', 'vinson-glitch-slices');
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) {
      const slice = make('span', `vinson-glitch-slice vinson-glitch-slice-${i}`);
      layer.append(slice);
    }
    return layer;
  }

  async function poll() {
    if (busy || !online?.vinson || isOwner(online)) return;
    let s = state(); if (!s) return;
    const identity = online?.identityId?.();
    busy = true;
    try {
      let remote = await online.vinson.status();
      if (experienceClosed || online?.identityId?.() !== identity || !state()) return;
      s = state();
      // A pull made while offline still has a local deadline. Register it with the server when connectivity
      // returns; the server then owns the deadline and ban across devices.
      if (remote.ok && !remote.phase && ['doom', 'banned'].includes(s.vinson?.phase)) {
        const pulled = await online.vinson.pull();
        if (pulled.ok) remote = pulled;
      }
      // Owner reset (migration 023): the server has no Vinson record any more, so a finished local curse (lifted /
      // immune / squad lock / warnings) is dropped and the next pull curses again. doom / banned keep the
      // offline-pull path above.
      else if (remote.ok && !remote.phase && !remote.immune && s.vinson && !['doom', 'banned'].includes(s.vinson.phase)) {
        delete s.vinson; persist(s); if (app && !app.destroyed) app.refresh(); draw(); // restrictions come back through presence, not from here
      }
      if (remote.ok && remote.phase === 'released' && s.vinson?.phase === 'locked') {
        const locked = await online.vinson.lock();
        if (locked.ok) remote = { ...remote, phase: 'locked' };
      }
      if (experienceClosed || online?.identityId?.() !== identity || !state()) return;
      s = state();
      if (remote.ok) {
        const old = s.vinson?.phase, before = JSON.stringify(s.vinson);
        reconcileServer(s, remote);
        if (old === 'banned' && remote.phase === 'released') squadChanged(s);
        if (JSON.stringify(s.vinson) !== before) { persist(s); if (app && !app.destroyed) app.refresh(); }
        if (s.vinson?.phase === 'locked') app?.applyRestrictions?.(remote.restrictions || { admin: true, codes: true });
        draw();
      }
    } finally { busy = false; }
  }

  function tick() {
    const s = state(); if (!s || isOwner(online)) { draw(); return; }
    const old = s.vinson?.phase;
    // Preserve the repair result before squadChanged performs its own lock enforcement.
    const repaired = s.vinson?.phase === 'locked' && enforceLock(s);
    squadChanged(s);
    if (old !== s.vinson?.phase || repaired) {
      persist(s);
      if (s.vinson?.phase === 'locked') { void online?.vinson?.lock?.(); app?.applyRestrictions?.({ admin: true, codes: true }); }
      if (s.vinson?.phase === 'banned') void poll();
      if (s.vinson?.phase === 'consequence') sound('warning');
      if (app && !app.destroyed) app.refresh();
    }
    draw();
  }

  const controller = {
    breakDoomControl(target) {
      if (!target || !infected(state()?.vinson?.phase) || isOwner(online) || target.dataset.uttab === 'home') return false;
      if (!broken.has(target)) { fractureElement(target); breakControl(target); }
      return true;
    },
    async openBattle() {
      if (experienceClosed || battleExperience || battleOpening || isOwner(online)) return false;
      const s = state(), identity = online?.identityId?.();
      const resumeRewards = hasPendingVinsonRewards(s);
      if (!s || (!['banned','freed','warn','consequence','locked'].includes(s.vinson?.phase) && !resumeRewards)) return false;
      battleOpening = true;
      try {
        // owner (Oct 5): the ban screen opens the new boss fight (Prototype 13). ?oldfight=1 keeps the previous one.
        const oldFight = new URLSearchParams(location.search).get('oldfight') === '1';
        const launch = oldFight ? (await import('./vinsonbattle.js?v=vinson35')).launchVinsonBattle : (await import('./eclipsebattle.js?v=2')).launchEclipseBattle;
        if (experienceClosed || battleExperience || online?.identityId?.() !== identity || !state()) return false;
        battleExperience = launch({ online, resumeRewards,
          seed: `${identity || 'guest'}:${s.vinson.doomUntil || 0}`,
          onWin: async ({ nonce }) => {
            if (experienceClosed || online?.identityId?.() !== identity || !state()) return { ok: false };
            const result = await online?.vinson?.battleWin?.({ nonce });
            if (result?.ok && result.immune && !experienceClosed && online?.identityId?.() === identity && state()) {
              const target = state();
              reconcileServer(target, result);
              target.vinson.immune = true; target.vinson.battleWon = true;
              persist(target); draw(); app?.refresh();
            }
            return result;
          },
          onClaim: async () => {
            if (experienceClosed || online?.identityId?.() !== identity || !state()) return { ok: false };
            const result = await online?.vinson?.claimBattleRewards?.();
            if (experienceClosed || online?.identityId?.() !== identity || !state()) return { ok: false };
            if (result?.ok && !applyVinsonRewardClaim(state(), result)) return { ok: false };
            if (result?.ok) { persist(state()); draw(); app?.refresh(); }
            return result;
          },
          onClose: () => { battleExperience = null; draw(); },
        });
        return !!battleExperience;
      } finally { battleOpening = false; }
    },
    attach(next) { app = next; localState = next.ut; tick(); void poll(); },
    detach(next) { if (app === next) { localState = next.ut; app = null; } },
    reload() { if (!app) { boundId = online?.identityId?.() || null; localState = loadUT(); tick(); void poll(); } },
    onSquadChange() {
      const s = state(); if (!s || isOwner(online)) return;
      const before = s.vinson?.phase;
      squadChanged(s);
      if (s.vinson?.phase !== before) persist(s);
      draw();
    },
    async onPull() {
      const s = state(); if (!s || isOwner(online)) return;
      if (['doom', 'banned', 'locked', 'lifted'].includes(s.vinson?.phase)) return;
      beginDoom(s); persist(s); draw();
      sound('warning');
      let remote;
      try { remote = await online?.vinson?.pull?.(); }
      catch { return; } // Local doom is already saved; polling retries when the network recovers.
      if (remote?.exempt) { release(s); persist(s); draw(); return; }
      if (remote?.ok && remote.deadline) { reconcileServer(s, remote); persist(s); draw(); }
    },
    async matchSabotage(layer) {
      const s = state();
      if (!layer || !cursedPack(s) || s.vinson?.immune || isOwner(online)) return;
      forfeitVinsonSquad(s, HELL_CARD_ID, { owner: isOwner(online) });
      persist(s);
      const screen = make('div', 'vinson-match-screen vinson-match-splatter');
      screen.setAttribute('role', 'alert');
      const blood = make('div', 'vinson-match-blood'); blood.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 18; i++) {
        const drop = make('i', 'vinson-blood-impact');
        drop.style.setProperty('--x', `${12 + (i * 37 % 79)}%`);
        drop.style.setProperty('--y', `${9 + (i * 23 % 83)}%`);
        drop.style.setProperty('--size', `${8 + i % 5 * 4}vmax`);
        drop.style.setProperty('--delay', `${i % 6 * 35}ms`);
        drop.style.setProperty('--angle', `${i * 41}deg`);
        blood.append(drop);
      }
      screen.append(blood, make('strong', 'vinson-match-message', MATCH_MESSAGE));
      layer.append(screen);
      sound('impact');
      await new Promise((resolve) => setTimeout(resolve, reduce() ? 2400 : 3600));
      screen.remove();
    },
    tick, poll,
    destroy() { experienceClosed = true; battleExperience?.close(); battleExperience = null; repairUi(); current = ''; damageObserver.disconnect(); clearInterval(interval); clearInterval(remoteInterval); document.removeEventListener('click', onInfectedClick, true); document.body.classList.remove('vinson-infected', 'vinson-critical', 'vinson-aftermath'); host.remove(); css.remove(); void soundContext?.close(); if (globalThis.__pitchsideVinson === controller) globalThis.__pitchsideVinson = null; },
  };
  globalThis.__pitchsideVinson = controller;
  interval = setInterval(tick, 250);
  remoteInterval = setInterval(() => { const v = state()?.vinson; if (v?.phase && (v.phase !== 'lifted' || hasPendingVinsonRewards(state()))) void poll(); }, 12000);
  online?.account?.onChange?.(() => {
    const id = online?.identityId?.() || null;
    if (id !== boundId) { boundId = id; if (!app) { localState = null; host.replaceChildren(); current = ''; } }
    void poll();
  });
  tick(); void poll();
  return controller;
}
