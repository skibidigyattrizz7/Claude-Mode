// App bootstrap: canvas sizing, fixed-timestep loop, scene management and mode flow.
import { PHYS, PITCH, CY } from './constants.js';
import { TEAMS, teamByCode } from './data.js';
import { Match } from './match.js';
import { KickScene } from './kickscene.js';
import { Tutorial } from './tutorial.js';
import { drawMatch, drawHUD, makeCamera, updateCamera, s2w } from './render.js';
import { input, initInput, clearEdges, mouseAimActive, releaseAll } from './input.js';
import { initTouch, setTouchMode, isTouchDevice } from './touch.js';
import { initAudio, sfx, setMuted, crowdAmbience } from './audio.js';
import { settings } from './settings.js';
import { store } from './storage.js';
import * as UI from './ui.js';
import { newTournament, nextUserFixture, recordUserResult, WC_KEY } from './tournament.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 1, H = 1, DPR = 1;

function resize() {
  const vv = window.visualViewport;
  W = Math.round(vv ? vv.width : window.innerWidth);
  H = Math.round(vv ? vv.height : window.innerHeight);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const rot = document.getElementById('rotate');
  const portrait = H > W && (input.touchMode || isTouchDevice());
  rot.classList.toggle('hidden', !(portrait && app.scene && !app.rotateDismissed));
}

// ---------- scenes ----------
/** Top-down match (quick, world cup, 2P, tutorial, and the menu background demo). */
class MatchScene {
  constructor(opts) {
    this.opts = opts;
    this.m = new Match({ ...opts, settings, ctrls: input.ctrls, minutes: opts.minutes || settings.matchMinutes, difficulty: settings.difficulty });
    this.cam = makeCamera();
    this.kick = null;
    this.demo = !!opts.demo;
    this.tut = opts.tutorial ? new Tutorial(this.m, input.binds, input.touchMode || isTouchDevice()) : null;
    this.ftShown = false;
    this.paused = false;
    this.snapCam = true;
    if (this.tut) { this.m.noClock = true; }
  }
  update(dt) {
    if (this.paused) return;
    const m = this.m;
    if (this.kick) { this.kick.update(dt); return; }
    if (!this.demo) {
      m.aimWorld[0] = mouseAimActive() ? s2w(this.cam, input.mouse.x, input.mouse.y) : null;
      m.mouseClick = input.mouse.pressed && !input.touchMode;
      if (input.anyPressed || input.mouse.pressed) m.skipRequest = true;
    }
    m.update(dt);
    for (const e of m.events) {
      if (!this.demo) handleSound(e);
      if (this.tut) this.tut.onEvent(e);
    }
    m.events.length = 0;
    if (this.tut) {
      this.tut.update(dt, input);
      updateTutorialBox(this.tut);
      if (this.tut.finished && (input.raw.has('Enter') || input.mouse.pressed || input.anyPressed) && this.tut.t > 1.2) { app.toMenu(); return; }
    }
    if (m.kickRequest && !this.kick && !this.demo) this.openKick(m.kickRequest);
    if (this.demo && (m.state === 'fulltime')) { app.startDemo(); return; }
    if (m.state === 'fulltime' && !this.ftShown && m.stateT > 2.2 && !this.demo) { this.ftShown = true; this.opts.onFulltime && this.opts.onFulltime(m); }
  }
  openKick(r) {
    const m = this.m;
    const mirror = r.side === 0;
    const ball = mirror ? { x: PITCH.L - r.x, y: PITCH.W - r.y } : { x: r.x, y: r.y };
    const def = 1 - r.team;
    this.kick = new KickScene({
      mode: r.kind, att: m.teams[r.team], def: m.teams[def],
      attKit: m.kits[r.team], defKit: m.kits[def], defGk: m.gkKits[def],
      shooter: r.shooter, keeper: r.keeper, humanShooter: r.humanShooter, humanKeeper: r.humanKeeper, ball,
      onDone: (res) => {
        const k = this.kick; this.kick = null; k.destroy();
        if (mirror && res.y != null) res.y = PITCH.W - res.y;
        m.resumeFromKick(res);
        setTouchMode('match');
      },
    });
    setTouchMode('kick');
  }
  render(ctx, w, h, dt) {
    if (this.kick) { this.kick.render(ctx, w, h); return; }
    const m = this.m;
    let target = { x: m.ball.x + m.ball.vx * 0.3, y: m.ball.y + m.ball.vy * 0.3 };
    let zoom = this.demo ? 0.8 : settings.zoom * (input.touchMode ? 0.85 : 1);
    if (m.state === 'setpiece' && m.sp && m.sp.aim && m.sp.human) {
      // frame both the taker and the target; pull the camera back for long deliveries
      const long = m.sp.type !== 'throw';
      const f = long ? 0.5 : 0.38;
      target = { x: m.ball.x * (1 - f) + m.sp.aim.x * f, y: m.ball.y * (1 - f) + m.sp.aim.y * f };
      if (long) zoom *= 0.72;
    }
    updateCamera(this.cam, target, dt, w, h, zoom, this.snapCam);
    this.snapCam = false;
    drawHUD.binds = input.binds;
    drawMatch(ctx, m, this.cam, settings);
  }
  destroy() { if (this.kick) this.kick.destroy(); hideTutorialBox(); }
}

/** Standalone kick scene (shootout / free-kick practice). */
class KickOnlyScene {
  constructor(opts) { this.opts = opts; this.k = new KickScene(opts); this.paused = false; }
  update(dt) { if (!this.paused) this.k.update(dt); }
  render(ctx, w, h) { this.k.render(ctx, w, h); }
  destroy() { this.k.destroy(); }
}

function handleSound(e) {
  switch (e.type) {
    case 'kick': sfx('kick', e.strength); break;
    case 'whistle': sfx('whistle'); break;
    case 'whistleLong': sfx('whistleLong'); break;
    case 'whistleEnd': sfx('whistleEnd'); break;
    case 'goal': sfx('net'); sfx('roar'); break;
    case 'post': case 'bar': sfx('post'); break;
    case 'save': sfx('save'); break;
    case 'saveConfirmed': case 'miss': sfx('ooh'); break;
    case 'tackleWon': case 'foul': case 'deflect': sfx('tackle'); break;
    default: break;
  }
}

function updateTutorialBox(t) {
  const el = document.getElementById('tut');
  const s = t.step; if (!s) return;
  el.classList.remove('hidden');
  const html = `<div class="tstep">TUTORIAL ${Math.min(t.i + 1, t.steps.length)}/${t.steps.length}${t.doneT >= 0 ? ' <b class="ok">✓ Nice!</b>' : ''}</div><div class="ttext">${s.text}</div>${s.id === 'done' ? '<div class="tskip">Press any key / tap to return to the menu</div>' : '<div class="tskip">Enter = skip step</div>'}`;
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
}
function hideTutorialBox() { const el = document.getElementById('tut'); el.classList.add('hidden'); el.dataset.h = ''; }

// ---------- app controller ----------
const app = {
  scene: null,
  paused: false,
  rotateDismissed: false,
  setScene(s, active = true) {
    if (this.scene && this.scene.destroy) this.scene.destroy();
    this.scene = s;
    this.paused = false;
    input.gameActive = active;
    releaseAll();
    resize();
  },
  startDemo() {
    const pool = TEAMS.slice(0, 12);
    const a = pool[(Math.random() * pool.length) | 0];
    let b = pool[(Math.random() * pool.length) | 0]; if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
    this.setScene(new MatchScene({ home: a, away: b, humans: [], demo: true, minutes: 30 }), false);
    setTouchMode('none');
    crowdAmbience(false);
  },
  toMenu() {
    this.startDemo();
    UI.showMenu(menuHandlers);
  },
  startMatch(opts) {
    UI.hideUI();
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
    this.lastMatch = opts;
    this.setScene(new MatchScene(opts));
    setTouchMode('match');
  },
  startKickOnly(opts) {
    UI.hideUI();
    initAudio(); setMuted(!settings.sound); crowdAmbience(true);
    this.lastKick = opts;
    this.setScene(new KickOnlyScene(opts));
    setTouchMode('kick');
  },
  pause() {
    if (!this.scene || !input.gameActive || this.paused) return;
    this.paused = true;
    this.scene.paused = true;
    if (this.scene.k) this.scene.k.paused = true;
    if (this.scene.kick) this.scene.kick.paused = true;
    releaseAll();
    const restart = this.scene instanceof MatchScene && !this.scene.demo ? () => this.startMatch(this.lastMatch) : this.scene instanceof KickOnlyScene ? () => this.startKickOnly(this.lastKick) : null;
    const showP = () => UI.showPause({
      resume: () => this.resume(),
      restart,
      settings: () => UI.showSettings(showP, true),
      quit: () => { crowdAmbience(false); this.toMenu(); },
    });
    showP();
  },
  resume() {
    UI.hideUI();
    this.paused = false;
    this.scene.paused = false;
    if (this.scene.k) this.scene.k.paused = false;
    if (this.scene.kick) this.scene.kick.paused = false;
    setMuted(!settings.sound);
    releaseAll();
  },
};

// ---------- mode flows ----------
function quickMatch() {
  UI.showTeamSelect('quick', ({ home, away }) => {
    const opts = { home, away, humans: [{ ctrl: 0, team: 0 }], mode: 'quick', onFulltime: (m) => UI.showFulltime(m, { rematch: () => app.startMatch(opts), menu: () => app.toMenu() }) };
    app.startMatch(opts);
  }, () => app.toMenu());
}

function versus() {
  UI.showTeamSelect('versus', ({ home, away, coop }) => {
    const humans = coop ? [{ ctrl: 0, team: 0 }, { ctrl: 1, team: 0 }] : [{ ctrl: 0, team: 0 }, { ctrl: 1, team: 1 }];
    const opts = { home, away, humans, mode: coop ? 'coop' : 'versus', onFulltime: (m) => UI.showFulltime(m, { rematch: () => app.startMatch(opts), menu: () => app.toMenu() }) };
    app.startMatch(opts);
  }, () => app.toMenu());
}

function tutorial() {
  app.startMatch({ home: teamByCode('BRA'), away: teamByCode('GHA'), humans: [{ ctrl: 0, team: 0 }], mode: 'tutorial', tutorial: true });
}

function shootout() {
  UI.showTeamSelect('shootout', ({ home, away }) => {
    const opts = {
      mode: 'shootout', teams: [home, away], humanTeam: 0, firstTeam: 0,
      onDone: (r) => UI.showMessage('Shootout over', `${home.name} ${r.score[0]} – ${r.score[1]} ${away.name}. ${r.winner === 0 ? 'You win!' : 'You lose.'}`,
        [{ label: 'Play again', fn: () => app.startKickOnly(opts) }, { label: 'Main menu', fn: () => app.toMenu() }]),
    };
    app.startKickOnly(opts);
  }, () => app.toMenu());
}

function fkPractice() {
  UI.showTeamSelect('fkpractice', ({ home }) => {
    const opp = TEAMS.find((t) => t !== home && t.code === 'GER') || TEAMS.find((t) => t !== home);
    app.startKickOnly({ mode: 'fkpractice', att: home, def: opp, home, away: opp, humanShooter: 0, onDone: () => app.toMenu() });
  }, () => app.toMenu());
}

// World Cup
function loadWC() { const t = store.get(WC_KEY, null); return t && t.v === 1 && t.groups ? t : null; }
function saveWC(t) { store.set(WC_KEY, t); }

function worldCup() {
  const t = loadWC();
  if (t) {
    UI.showMessage('World Cup', `Saved tournament found (${teamByCode(t.user).name}).`, [
      { label: 'Continue', fn: () => wcHub(t) },
      { label: 'New tournament', fn: () => wcNew() },
      { label: 'Back', fn: () => app.toMenu() },
    ]);
  } else wcNew();
}

function wcNew() {
  UI.showTeamSelect('worldcup', ({ home }) => { const t = newTournament(home.code); saveWC(t); wcHub(t); }, () => app.toMenu());
}

function wcHub(t) {
  if (!(app.scene instanceof MatchScene && app.scene.demo)) app.startDemo();
  const nf = nextUserFixture(t);
  UI.showWorldCup(t, {
    nextFixture: nf,
    play: () => wcPlay(t, nf),
    sim: () => { recordUserResult(t, null); saveWC(t); wcHub(t); },
    menu: () => app.toMenu(),
    abandon: () => { store.del(WC_KEY); app.toMenu(); },
  });
}

function wcPlay(t, nf) {
  const home = teamByCode(nf.home), away = teamByCode(nf.away);
  const userTeam = nf.home === t.user ? 0 : 1;
  const opts = {
    home, away, humans: [{ ctrl: 0, team: userTeam }], mode: 'worldcup', knockout: nf.knockout,
    onFulltime: (m) => {
      const gf = m.score[userTeam], ga = m.score[1 - userTeam];
      const finish = (pensWin) => {
        recordUserResult(t, { gf, ga, pensWin }); saveWC(t);
        crowdAmbience(false);
        wcHub(t);
      };
      if (nf.knockout && gf === ga) {
        UI.showFulltime(m, {
          extra: 'Level after 90 minutes — penalties!', contLabel: 'Penalty shootout',
          cont: () => app.startKickOnly({
            mode: 'shootout', teams: [home, away], humanTeam: userTeam, firstTeam: 0,
            onDone: (r) => finish(r.winner === userTeam),
          }),
          menu: () => app.toMenu(),
        });
      } else UI.showFulltime(m, { cont: () => finish(false), contLabel: 'Back to World Cup', menu: () => app.toMenu() });
    },
  };
  app.startMatch(opts);
}

const menuHandlers = {
  quick: quickMatch, worldcup: worldCup, shootout, fkpractice: fkPractice, versus, tutorial,
  howto: () => UI.showHowTo(() => app.toMenu()),
  settings: () => UI.showSettings(() => app.toMenu()),
};

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  // pause toggling
  if ((input.ctrls[0].wasPressed('pause') || input.ctrls[1].wasPressed('pause')) && input.gameActive) {
    if (app.paused) app.resume(); else app.pause();
    clearEdges();
  }
  let steps = 0;
  while (acc >= PHYS.DT && steps < 12) {
    if (app.scene) app.scene.update(PHYS.DT);
    acc -= PHYS.DT; steps++;
    clearEdges();
  }
  if (steps === 12) acc = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (app.scene) app.scene.render(ctx, W, H, dt);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
function boot() {
  initInput(canvas);
  initTouch(() => { if (app.paused) app.resume(); else app.pause(); });
  if (isTouchDevice()) input.touchMode = true;
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  document.getElementById('rotate').querySelector('button').addEventListener('click', () => { app.rotateDismissed = true; resize(); });
  // prevent pinch zoom / scrolling during play
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (input.gameActive) e.preventDefault(); }, { passive: false });
  const unlock = () => { initAudio(); setMuted(!settings.sound); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  resize();
  app.toMenu();
  requestAnimationFrame(frame);
  // test / debug hook
  window.__touchline = { app, input, settings, get match() { return app.scene && app.scene.m; }, get kick() { return app.scene && (app.scene.k || app.scene.kick); } };
}

boot();
