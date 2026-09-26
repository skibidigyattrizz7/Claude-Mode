// Corner practice: an endless series of attacking corners against a live defence.
// Aim the delivery (reticle + predicted flight), add curve, then attack the ball in the box
// (hold Shoot as it arrives for a header / volley). Tracks corners, goals and shots.
import { PITCH } from './constants.js';
import { beginSetPiece } from './setpieces.js';
import { store } from './storage.js';

const BEST_KEY = 'touchline.cornerbest.v1';

export class CornerPractice {
  constructor(m) {
    this.m = m;
    m.noClock = true;
    m.noReplay = true;
    this.corners = 0; this.goals = 0; this.shots = 0; this.streak = 0;
    this.best = store.get(BEST_KEY, 0) || 0;
    this.side = 0;            // alternate between the two corner flags
    this.live = false;        // ball in play after the delivery
    this.t = 0; this.wait = 0.6;
    this.last = '';
    this.shotThis = false;
  }

  next() {
    const m = this.m;
    const dir = m.attackDir(0);
    const gx = m.attackSide(0) === 1 ? PITCH.L : 0;
    this.side = 1 - this.side;
    m.noReplay = true;
    beginSetPiece(m, { type: 'corner', team: 0, x: gx - dir * 0.4, y: this.side ? PITCH.W - 0.4 : 0.4 });
    this.live = false; this.t = 0; this.wait = -1; this.shotThis = false;
  }

  finish(text, goal) {
    if (this.wait >= 0) return;
    this.last = text;
    if (goal) { this.goals++; this.streak++; if (this.streak > this.best) { this.best = this.streak; store.set(BEST_KEY, this.best); } }
    else this.streak = 0;
    this.live = false; this.wait = goal ? 2.2 : 1.1;
  }

  onEvent(e) {
    if (e.type === 'setpieceTaken') { this.corners++; this.live = true; this.t = 0; }
    else if (e.type === 'shot' && e.p && e.p.team === 0 && this.live) { this.shots++; this.shotThis = true; }
    else if (e.type === 'goal' && this.live) this.finish(e.og ? 'GOAL (own goal)!' : 'GOAL!', e.team === 0);
  }

  update(dt) {
    const m = this.m;
    this.t += dt;
    if (this.wait >= 0) {
      this.wait -= dt;
      // freeze the kick-off / restart the engine would otherwise start
      if (this.wait < 0) this.next();
      return;
    }
    if (!this.live) {
      if (m.state !== 'setpiece') this.next();   // first call / anything unexpected
      return;
    }
    if (m.state === 'out' || m.state === 'foul') this.finish(this.shotThis ? 'Off target' : 'Out of play', false);
    else if (m.state === 'kickoff') this.finish('', false);
    else if (m.state === 'play' && m.owner && m.owner.team === 1) this.finish(m.owner.role === 'GK' ? 'Keeper claims it' : 'Cleared', false);
    else if (this.t > 7) this.finish('Attack broke down', false);
  }

  html() {
    return `<div class="tstep">CORNER PRACTICE</div>
      <div class="ttext">Corners <b>${this.corners}</b> · Goals <b>${this.goals}</b> · Shots <b>${this.shots}</b> · Streak <b>${this.streak}</b> · Best <b>${this.best}</b>${this.last ? ` <span class="ok">${this.last}</span>` : ''}</div>
      <div class="tskip">Hold Shoot as the cross arrives for a header / volley · Esc: pause / quit</div>`;
  }
}
