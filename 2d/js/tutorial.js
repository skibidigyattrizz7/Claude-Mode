// Interactive tutorial: step-by-step prompts that advance when the action is performed.
import { PITCH, CY } from './constants.js';
import { placeBall } from './physics.js';
import { beginSetPiece } from './setpieces.js';
import { keyLabel } from './keybinds.js';

export class Tutorial {
  constructor(m, binds, touch) {
    this.m = m; this.touch = touch; this.b = binds.p1;
    this.i = 0; this.t = 0; this.acc = 0; this.doneT = -1; this.finished = false;
    m.passive[1] = true;
    this.steps = this.buildSteps();
    this.enter();
  }

  k(a) { return this.touch ? { up: 'joystick', shoot: 'SHOOT', pass: 'PASS', through: 'THRU', lob: 'LOB', sprint: 'SPRINT', tackle: 'TACKLE', slide: 'SLIDE', skill: 'SKILL', switch: 'SWITCH', jockey: 'JOCKEY' }[a] || a : keyLabel(this.b[a]); }

  buildSteps() {
    const k = (a) => this.k(a);
    const move = this.touch ? 'Drag the joystick on the left' : `Use ${k('up')} ${k('left')} ${k('down')} ${k('right')}`;
    return [
      { id: 'move', text: `${move} to move your player (cyan ring).` },
      { id: 'sprint', text: `Hold ${k('sprint')} while moving to sprint. Sprinting drains the stamina bar under your player.` },
      { id: 'pass', text: `Press ${k('pass')}${this.touch ? '' : ' (or left-click)'} to pass to the teammate you are aiming at${this.touch ? '' : ' (aim with the mouse or your movement)'}. Control switches to the receiver.` },
      { id: 'through', text: `Press ${k('through')} to play a through ball into space ahead of a running teammate.` },
      { id: 'lob', text: `Press ${k('lob')} for a lofted pass over the defence.` },
      { id: 'shoot', text: `Hold ${k('shoot')} to fill the power bar, release to shoot. The dashed line and reticle show where the shot is going (green = on target).` },
      { id: 'skill', text: `Press ${k('skill')} while dribbling for a skill move (no direction = step-over, sideways = roulette, backwards = drag-back, sprinting = heel flick).` },
      { id: 'tackle', text: `Defending! Get in front of the opponent and press ${k('tackle')} for a standing tackle. Win the ball first = clean tackle.` },
      { id: 'slide', text: `Press ${k('slide')} for a slide tackle — longer reach, but it commits you. Never slide in from behind (yellow card!).` },
      { id: 'corner', text: this.touch ? 'Set pieces: move the reticle with the joystick, hold SHOOT for power and release. LOB / THRU add curve.' : `Set pieces: aim the corner with the mouse, hold ${k('shoot')} for power and release. ${k('lob')} / ${k('through')} add curve, ${k('pass')} plays it short.` },
      { id: 'done', text: 'Tutorial complete! You know the basics — now try a Quick Match or the World Cup.' },
    ];
  }

  get step() { return this.steps[this.i]; }

  /** Prepare the pitch for the current step. */
  enter() {
    const m = this.m, s = this.step;
    this.t = 0; this.acc = 0; this.doneT = -1;
    const h = m.humans[0];
    const mine = m.mates(0), theirs = m.mates(1);
    const dir = m.attackDir(0);
    const giveMe = (x, y) => {
      const p = mine.find((q) => q.role === 'MF') || mine[1];
      p.x = x; p.y = y; p.vx = p.vy = 0; p.state = 'run';
      placeBall(m.ball, x + dir * 0.5, y);
      m.state = 'play'; m.sp = null;
      m.setOwner(p, true); m.setHumanPlayer(h, p);
    };
    if (s.id === 'shoot' || s.id === 'skill') {
      giveMe(dir > 0 ? PITCH.L - 24 : 24, CY + 4);
    } else if (s.id === 'tackle' || s.id === 'slide') {
      const opp = theirs.find((q) => q.role === 'MF') || theirs[1];
      const me = mine.find((q) => q.role === 'DF') || mine[1];
      opp.x = PITCH.L / 2; opp.y = CY; opp.vx = opp.vy = 0; opp.state = 'run';
      me.x = PITCH.L / 2 - dir * 8; me.y = CY + 2; me.state = 'run';
      placeBall(m.ball, opp.x, opp.y);
      m.state = 'play'; m.sp = null;
      m.setOwner(opp, true); m.setHumanPlayer(h, me);
      this.opp = opp;
    } else if (s.id === 'corner') {
      beginSetPiece(m, { type: 'corner', team: 0, x: dir > 0 ? PITCH.L - 0.4 : 0.4, y: 0.4 });
    } else if (s.id === 'pass' || s.id === 'through' || s.id === 'lob') {
      // start every passing drill on the ball in midfield
      if (!m.owner || m.owner.team !== 0 || m.state !== 'play') giveMe(PITCH.L / 2 - dir * 10, CY);
      else m.setHumanPlayer(h, m.owner);
    } else if (s.id === 'move' && m.owner && m.owner.team !== 0) giveMe(PITCH.L / 2 - dir * 10, CY);
  }

  onEvent(e) {
    const s = this.step; if (!s || this.doneT >= 0) return;
    const mineEv = e.p ? e.p.team === 0 : true;
    let ok = false;
    switch (s.id) {
      case 'pass': ok = e.type === 'passDone' && mineEv; break;
      case 'through': ok = e.type === 'pass' && e.kind === 'through' && mineEv; break;
      case 'lob': ok = e.type === 'pass' && e.kind === 'lob' && mineEv; break;
      case 'shoot': ok = e.type === 'shot' && mineEv; break;
      case 'skill': ok = e.type === 'skill' && mineEv; break;
      case 'tackle': ok = e.type === 'tackleWon' && mineEv; break;
      case 'slide': ok = e.type === 'tackleStart' && e.kind === 'slide' && mineEv; break;
      case 'corner': ok = e.type === 'setpieceTaken'; break;
      default: break;
    }
    if (ok) this.doneT = 0;
  }

  update(dt, input) {
    const m = this.m, s = this.step;
    if (!s) return;
    this.t += dt;
    if (s.id === 'done') { this.finished = true; return; }
    const h = m.humans[0], p = h.player;
    if (this.doneT >= 0) {
      this.doneT += dt;
      if (this.doneT > 1.1) { this.i++; this.enter(); }
      return;
    }
    if (s.id === 'move' && p) { this.acc += Math.hypot(p.vx, p.vy) * dt; if (this.acc > 8) this.doneT = 0; }
    if (s.id === 'sprint' && p) { if (p.sprint && Math.hypot(p.vx, p.vy) > 6) this.acc += dt; if (this.acc > 1.0) this.doneT = 0; }
    // keep the defending drills going: the attacker walks at you
    if ((s.id === 'tackle' || s.id === 'slide') && this.opp && m.owner !== this.opp && this.t > 1 && m.owner && m.owner.team === 1) this.enter();
    if ((s.id === 'tackle' || s.id === 'slide') && m.state === 'play' && !m.owner && this.t > 4 && this.doneT < 0) this.enter();
    // after a goal or set piece in the attacking drills, reset
    if (['pass', 'through', 'lob', 'shoot', 'skill'].includes(s.id) && m.state === 'play' && m.owner && m.owner.team === 1) this.enter();
    // the ball ran dead (out of play / stopped far away): hand it back so the drill can continue
    if (['pass', 'through', 'lob', 'shoot', 'skill'].includes(s.id) && this.t > 2 && (m.state !== 'play' || (!m.owner && Math.hypot(m.ball.vx, m.ball.vy) < 0.3))) this.enter();
    if (input.raw.has('Enter') && this.t > 0.3) { this.i++; this.enter(); }
  }
}
