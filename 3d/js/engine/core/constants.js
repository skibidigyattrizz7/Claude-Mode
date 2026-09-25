// Pure constants shared by simulation, rendering and tests. DOM-free.
// World frame: x along the pitch length (-52.5..52.5), z across (-34..34), y up (metres).
export const PITCH = { L: 105, W: 68, HL: 52.5, HW: 34 };
export const GOAL = { HW: 3.66, H: 2.44, DEPTH: 2.0, POST_R: 0.06 };
export const BOX = { DEPTH: 16.5, HW: 20.16 };
export const SIX = { DEPTH: 5.5, HW: 9.16 };
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;
export const BALL_R = 0.11;
export const G = 9.81;
export const SIM_HZ = 120;
export const DT = 1 / SIM_HZ;

// Animation codes (sim -> renderer, also encoded in snapshots)
export const ANIM = {
  RUN: 0, KICK: 1, WINDUP: 2, SLIDE: 3, HEAD: 4, DIVE: 5, CELEB: 6, THROW: 7,
  FALL: 8, HOLD: 9, TACKLE: 10, SKILL: 11, WALL: 12, CHEST: 13, GKREADY: 14, SENTOFF: 15,
};

export const PHASE = {
  KICKOFF: 0, PLAY: 1, STOP: 2, SETPIECE: 3, GOAL: 4, REPLAY: 5, HALFTIME: 6, FULLTIME: 7,
};
export const SP = { KICKOFF: 0, THROW: 1, CORNER: 2, GOALKICK: 3, FREEKICK: 4, PENALTY: 5 };
export const SP_NAMES = ['Kick-off', 'Throw-in', 'Corner', 'Goal kick', 'Free kick', 'Penalty'];

export const DIFFICULTY = {
  amateur:   { level: 0, err: 1.55, react: 0.42, think: 0.55, press: 0.55, noise: 0.35, gk: 0.85 },
  pro:       { level: 1, err: 1.2,  react: 0.3,  think: 0.42, press: 0.75, noise: 0.22, gk: 0.95 },
  world:     { level: 2, err: 0.95, react: 0.2,  think: 0.3,  press: 0.9,  noise: 0.12, gk: 1.0 },
  legendary: { level: 3, err: 0.78, react: 0.13, think: 0.22, press: 1.0,  noise: 0.06, gk: 1.06 },
};
