// EVIL VINSON presentation and lifecycle. This is global (not tied to a UT view), so a timer continues when
// the player changes screens. Server status is polled while active; the saved absolute deadline survives reload.
import { loadUT, saveUT } from '../core/ut.js';
import { beginDoom, release, advance, reconcileServer, squadChanged, enforceLock, isOwner, BAN_MESSAGE, MATCH_MESSAGE } from '../core/vinson.js';

const asset = (name) => new URL(`../../../assets/cards/${name}`, import.meta.url).href;
const warning = asset('vinson-warning.png');
const planet = asset('vinson-planet.png');
const stamp = (s) => `pitchside.vinson.shown.${s}`;
const seconds = (ms) => String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0');
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const OMENS = ["DON'T DO IT", "IT'S OVER", "YOU'RE DONE", "SHE'S COMING", 'LOOK BEHIND YOU', 'THE CLOCK IS LYING'];

export function startVinsonExperience(online, { initialState = loadUT(), ephemeral = false } = {}) {
  if (globalThis.__pitchsideVinson) return globalThis.__pitchsideVinson;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('../../../css/vinson.css', import.meta.url).href;
  document.head.appendChild(css);
  const host = document.createElement('div'); host.id = 'vinson-experience'; document.body.appendChild(host);
  let app = null, localState = initialState, boundId = online?.identityId?.() || null;
  let busy = false, current = '', cinematic = false, interval = null, remoteInterval = null, lastOmen = -1, falling = false;
  const broken = new Map();
  let soundContext = null;
  const damagedKeys = new Set();
  const controlSelector = 'button, [role="tab"], a, input, select, .pc-card';
  const controlKey = (el) => el.dataset.uttab ? `tab:${el.dataset.uttab}` : `${el.tagName}:${el.getAttribute('aria-label') || el.querySelector('h2')?.textContent || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 90) || el.getAttribute('name') || el.id}`;
  const state = () => app?.ut || localState;
  const persist = (s) => { if (app?.ut === s) app.saveUT(); else if (s) saveUT(s); };
  const remember = (key) => { if (ephemeral) return null; try { return sessionStorage.getItem(key); } catch { return null; } };
  const mark = (key) => { if (ephemeral) return; try { sessionStorage.setItem(key, '1'); } catch { /* private mode */ } };
  const make = (tag, cls, txt) => { const el = document.createElement(tag); el.className = cls; if (txt) el.textContent = txt; return el; };
  const infected = (phase) => ['doom', 'freed', 'warn', 'consequence', 'locked'].includes(phase);
  const root = () => app?.root?.isConnected ? app.root : document.querySelector('.pm-root');
  function repairUi() {
    for (const [el, wasInert] of broken) { el.classList.remove('vinson-control-broken', 'vinson-tab-falling'); el.inert = wasInert; }
    broken.clear(); root()?.classList.remove('vinson-ui-falling');
    damagedKeys.clear();
    root()?.querySelectorAll('.vinson-control-gone').forEach((el) => { el.classList.remove('vinson-control-gone'); el.inert = false; });
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
  function fracture(target) {
    if (!target || reduce()) return;
    const bounds = target.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const effect = make('div', 'vinson-fracture');
    effect.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`;
    const caption = (target.textContent || '').trim().slice(0, 34);
    for (let i = 0; i < 3; i++) effect.append(make('span', `vinson-shard vinson-shard-${i}`, caption));
    document.body.append(effect);
    setTimeout(() => effect.remove(), 1300);
  }
  function onInfectedClick(event) {
    if (!infected(state()?.vinson?.phase) || isOwner(online)) return;
    const target = event.target.closest?.('.pm-root button, .pm-root [role="tab"], .pm-root a, .pm-root input, .pm-root select, .pm-root .pc-card');
    if (target && root()?.contains(target)) {
      if (broken.has(target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      fracture(target); breakControl(target);
      const label = (target.textContent || '').trim();
      const navigating = target.matches('.pm-uttab, .pm-tab, .pm-tile, [role="tab"]');
      const curseScene = /\b(open|play|start|match|rivals|battle)\b/i.test(label) || !!target.closest('.pm-po-gridwrap');
      const squadWarning = ['warn', 'consequence'].includes(state()?.vinson?.phase) && !!target.closest('.pm-sq');
      if (!navigating && !curseScene && !squadWarning) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
  }
  document.addEventListener('click', onInfectedClick, true);
  const damageObserver = new MutationObserver(() => {
    if (!infected(state()?.vinson?.phase) || isOwner(online) || !damagedKeys.size) return;
    root()?.querySelectorAll(controlSelector).forEach((el) => {
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
    const s = state(); if (!s || isOwner(online)) { repairUi(); host.replaceChildren(); document.body.classList.remove('vinson-infected', 'vinson-critical'); current = ''; return; }
    const v = s.vinson; const phase = v?.phase || '';
    if (current === 'banned' && phase !== 'banned') repairUi();
    document.body.classList.toggle('vinson-infected', infected(phase));
    document.body.classList.toggle('vinson-critical', phase === 'doom' && v.doomUntil - Date.now() <= 10000);
    if (!phase || phase === 'lifted') { repairUi(); host.replaceChildren(); current = phase; cinematic = false; return; }
    if (phase === 'freed') { host.replaceChildren(); current = phase; cinematic = false; return; }
    if (phase === 'doom' && v.doomUntil - Date.now() <= 10000) {
      const left = Math.max(0, v.doomUntil - Date.now());
      const tabs = [...(root()?.querySelectorAll('.pm-uttab') || [])];
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
    if (phase === 'locked') { host.replaceChildren(); current = phase; return; }
    if (current !== phase) {
      host.replaceChildren(); current = phase;
      const box = make('div', `vinson-notice vinson-${phase}`);
      box.setAttribute('role', 'alert');
      box.append(make('strong', 'vinson-notice-title', phase === 'doom' ? 'DOOM HAS BEEN BROUGHT UPON YOU'
        : phase === 'warn' ? "IT'S NOT WORTH IT" : phase === 'consequence' ? 'THIS ACTION WILL HAVE CONSEQUENCES' : "YOU'VE BEEN CURSED BY VINSON"));
      if (phase !== 'locked') box.append(make('span', 'vinson-timer'));
      host.append(box);
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
    screen.append(ghosts, make('div', 'vinson-final-embers'), make('span', 'vinson-final-kicker', 'THE END OF YOUR SQUAD'), art,
      make('strong', 'vinson-final-title', BAN_MESSAGE));
    const words = make('div', 'vinson-final-words'); words.setAttribute('aria-hidden', 'true');
    OMENS.forEach((omen, i) => words.append(make('span', `vinson-final-word vinson-final-word-${i}`, omen)));
    screen.append(words);
    const check = make('button', 'vinson-check', 'ESCAPE THE WRATH OF VINSON'); check.onclick = () => location.reload(); screen.append(check);
    host.append(screen);
    sound('impact');
  }

  function playCinematic(key) {
    host.replaceChildren();
    const screen = make('div', 'vinson-screen vinson-cinematic'); screen.setAttribute('role', 'alertdialog');
    screen.setAttribute('aria-label', "IT'S NOT WORTH IT");
    const prologue = make('div', 'vinson-prologue', 'YOU WERE WARNED');
    const tile = make('div', 'vinson-tiles');
    const intertitle = make('strong', 'vinson-intertitle');
    screen.append(prologue, tile, intertitle); host.append(screen);
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
        intertitle.textContent = count === 12 ? 'SHE IS HERE' : count === 32 ? 'THERE IS NO ESCAPE' : "IT'S NOT WORTH IT";
        intertitle.classList.remove('vinson-intertitle-show');
        void intertitle.offsetWidth;
        intertitle.classList.add('vinson-intertitle-show');
        sound('warning');
      }
      if (count < 55) setTimeout(batch, Math.max(100, 1100 - count * 19));
      else setTimeout(() => { screen.classList.add('vinson-blackout'); sound('impact'); setTimeout(() => { if (current === 'banned' && host.contains(screen)) finalScene(); }, 1400); }, 2200);
    };
    mark(key); sound('impact');
    setTimeout(() => {
      if (current !== 'banned' || !host.contains(screen)) return;
      prologue.classList.add('vinson-prologue-out');
      for (let i = 0; i < 4; i++) addTile(count++);
      setTimeout(batch, 1100);
    }, 1600);
  }

  async function poll() {
    if (busy || !online?.vinson || isOwner(online)) return;
    const s = state(); if (!s) return;
    busy = true;
    try {
      let remote = await online.vinson.status();
      // A pull made while offline still has a local deadline. Register it with the server when connectivity
      // returns; the server then owns the deadline and ban across devices.
      if (remote.ok && !remote.phase && ['doom', 'banned'].includes(s.vinson?.phase)) {
        const pulled = await online.vinson.pull();
        if (pulled.ok) remote = pulled;
      }
      if (remote.ok && remote.phase === 'released' && s.vinson?.phase === 'locked') {
        const locked = await online.vinson.lock();
        if (locked.ok) remote = { ...remote, phase: 'locked' };
      }
      if (remote.ok) {
        const old = s.vinson?.phase;
        reconcileServer(s, remote);
        if (old === 'banned' && remote.phase === 'released') squadChanged(s);
        if (s.vinson?.phase !== old) { persist(s); if (app && !app.destroyed) app.refresh(); }
        if (s.vinson?.phase === 'locked') app?.applyRestrictions?.(remote.restrictions || { admin: true, codes: true });
        draw();
      }
    } finally { busy = false; }
  }

  function tick() {
    const s = state(); if (!s || isOwner(online)) { draw(); return; }
    const old = s.vinson?.phase;
    squadChanged(s);
    const repaired = s.vinson?.phase === 'locked' && enforceLock(s);
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
      const remote = await online?.vinson?.pull?.();
      if (remote?.exempt) { release(s); persist(s); draw(); return; }
      if (remote?.ok && remote.deadline) { reconcileServer(s, remote); persist(s); draw(); }
    },
    async matchSabotage(layer) {
      if (!layer) return;
      const screen = make('div', 'vinson-match-screen');
      screen.setAttribute('role', 'alert');
      screen.append(make('strong', '', MATCH_MESSAGE));
      layer.append(screen);
      await new Promise((resolve) => setTimeout(resolve, reduce() ? 1800 : 2800));
      screen.remove();
    },
    tick, poll,
    destroy() { repairUi(); current = ''; damageObserver.disconnect(); clearInterval(interval); clearInterval(remoteInterval); document.removeEventListener('click', onInfectedClick, true); document.body.classList.remove('vinson-infected', 'vinson-critical'); host.remove(); css.remove(); void soundContext?.close(); if (globalThis.__pitchsideVinson === controller) globalThis.__pitchsideVinson = null; },
  };
  globalThis.__pitchsideVinson = controller;
  interval = setInterval(tick, 250);
  remoteInterval = setInterval(() => { const phase = state()?.vinson?.phase; if (phase && phase !== 'freed' && phase !== 'lifted') void poll(); }, 12000);
  online?.account?.onChange?.(() => {
    const id = online?.identityId?.() || null;
    if (id !== boundId) { boundId = id; if (!app) { localState = null; host.replaceChildren(); current = ''; } }
    void poll();
  });
  tick(); void poll();
  return controller;
}
