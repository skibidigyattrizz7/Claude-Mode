// Rating-based match simulation producing a contract-shaped match result. DOM-free.
import { Rng, clamp } from './rng.js';

const SCORE_W = { ST: 5, CF: 4.5, LW: 3, RW: 3, CAM: 2.4, LM: 1.6, RM: 1.6, CM: 1.1, CDM: 0.5, LWB: 0.5, RWB: 0.5, LB: 0.35, RB: 0.35, CB: 0.45, GK: 0 };

export function teamStrength(team) {
  const ps = team.players;
  const avg = ps.reduce((s, p) => s + p.ovr, 0) / ps.length;
  const chem = team.chemistry ?? 60;
  return avg * (1 + (chem - 60) / 1500);
}

/** Expected goals for both sides given two strengths. */
export function expectedGoals(sH, sA, neutral = false) {
  const diff = sH - sA;
  const lh = 1.3 * Math.exp(0.068 * diff) * (neutral ? 1.03 : 1.12);
  const la = 1.3 * Math.exp(-0.068 * diff) * (neutral ? 1.03 : 0.9);
  return [clamp(lh, 0.15, 5), clamp(la, 0.15, 5)];
}

function pickScorer(rng, team) {
  return rng.weighted(team.players.map((p) => [p, (SCORE_W[p.pos] ?? 1) * Math.max(0.2, (p.attrs.sho - 20) / 60)]));
}

/**
 * Simulate a match between two contract Teams.
 * @returns result: {homeGoals, awayGoals, scorers, stats, playerRatings, simulated:true}
 */
export function simulateMatch(home, away, { rng = new Rng(), neutral = false } = {}) {
  const sH = teamStrength(home), sA = teamStrength(away);
  const [lh, la] = expectedGoals(sH, sA, neutral);
  const hg = rng.poisson(lh), ag = rng.poisson(la);
  const scorers = [];
  const minutes = () => {
    const m = rng.int(1, 94);
    return m > 90 ? 90 : m;
  };
  for (let i = 0; i < hg; i++) scorers.push({ playerId: pickScorer(rng, home).id, team: 'home', minute: minutes() });
  for (let i = 0; i < ag; i++) scorers.push({ playerId: pickScorer(rng, away).id, team: 'away', minute: minutes() });
  scorers.sort((a, b) => a.minute - b.minute);

  const possH = clamp(Math.round(50 + (sH - sA) * 0.9 + rng.normal(0, 4)), 28, 72);
  const shotsH = hg + rng.poisson(lh * 4.2 + 3), shotsA = ag + rng.poisson(la * 4.2 + 3);
  const sotH = Math.min(shotsH, hg + rng.poisson(lh * 1.3 + 1)), sotA = Math.min(shotsA, ag + rng.poisson(la * 1.3 + 1));
  const passesH = Math.round(possH * 9 + rng.normal(0, 25)), passesA = Math.round((100 - possH) * 9 + rng.normal(0, 25));

  const playerRatings = {};
  const rateSide = (team, gf, ga, side) => {
    const res = gf > ga ? 0.45 : gf < ga ? -0.35 : 0.05;
    for (const p of team.players) {
      let r = 6.3 + res + rng.normal(0, 0.45) + (p.ovr - 75) * 0.02;
      const goals = scorers.filter((s) => s.team === side && s.playerId === p.id).length;
      r += goals * 0.9;
      const defensive = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'].includes(p.pos);
      if (defensive && ga === 0) r += 0.6;
      if (defensive && ga >= 3) r -= 0.5;
      playerRatings[p.id] = Math.round(clamp(r, 4, 10) * 10) / 10;
    }
  };
  rateSide(home, hg, ag, 'home');
  rateSide(away, ag, hg, 'away');

  return {
    homeGoals: hg, awayGoals: ag, scorers,
    stats: { possession: [possH, 100 - possH], shots: [shotsH, shotsA], shotsOnTarget: [sotH, sotA], passes: [Math.max(80, passesH), Math.max(80, passesA)] },
    playerRatings, simulated: true,
  };
}

/** Decide a penalty shoot-out winner for a drawn knockout tie. */
export function penaltyShootout(home, away, rng = new Rng()) {
  const sH = teamStrength(home), sA = teamStrength(away);
  let h = 0, a = 0;
  for (let i = 0; i < 5; i++) { if (rng.chance(0.74 + (sH - sA) * 0.004)) h++; if (rng.chance(0.74 - (sH - sA) * 0.004)) a++; }
  while (h === a) { if (rng.chance(0.72)) h++; if (rng.chance(0.72)) a++; }
  return { home: h, away: a, winner: h > a ? 'home' : 'away' };
}
