// Continuous camera/effect choreography. No DOM, timers or account side effects.
const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));
export const VINSON_CINEMATIC_DURATION = { transition: 28, finale: 26 };
export function sampleVinsonCinematic(kind, time, { reducedMotion = false } = {}) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const shot = { time: t, black: 0, white: 0, zoom: 1, focusX: 640, focusY: 425,
    hero: 'patel', villain: 'world', heroAlpha: 1, villainAlpha: 1, beams: 0,
    star: 0, shield: 0, sword: 0, text: '', speaker: '', letterbox: 1, done: false };
  if (kind === 'transition') {
    shot.villainAlpha = 1 - ramp(t, 0, 2.5);
    shot.black = ramp(t, 2.3, 3.5) * (1 - ramp(t, 5.5, 7));
    if (t >= 5.5) { shot.villain = 'phonk'; shot.villainAlpha = ramp(t, 5.5, 8); }
    if (t >= 7 && t < 10) { shot.speaker = 'PHONK MODE VINSON'; shot.text = 'Your victory was only the beginning.'; }
    if(t>=9&&t<11){shot.speaker='ISRAELI PATEL';shot.text="Then I'll face you myself.";}
    if(t>=11&&t<14){shot.speaker='PHONK MODE VINSON';shot.text='Your light ends here.';}
    shot.beams = ramp(t, 10, 11.5) * (1 - ramp(t, 15, 16));
    shot.heroAlpha = 1 - ramp(t, 13.7, 16);
    shot.white = .5 * ramp(t, 13.5, 14) * (1 - ramp(t, 14, 15));
    shot.black = Math.max(shot.black, ramp(t, 16, 17) * (1 - ramp(t, 19, 20.5)));
    if (t >= 19) { shot.hero = 'captain'; shot.heroAlpha = ramp(t, 19, 21); }
    if (t >= 20.5 && t < 24) { shot.speaker = 'CAPTAIN ISRAEL'; shot.text = 'Have no fear. Captain Israel is here.'; }
    if (t >= 24) { shot.speaker = 'PHONK MODE VINSON'; shot.text = "I'll teach you the ways of manga."; }
    shot.zoom = 1 + .12 * ramp(t, 8, 12) - .12 * ramp(t, 16, 20);
    shot.done = t >= 28;
  } else {
    shot.hero = 'captain'; shot.villain = 'phonk';
    shot.beams = ramp(t, 0, 1.5) * (1 - ramp(t, 9, 10));
    shot.star = ramp(t, 1.5, 8.8);
    shot.zoom = 1 + .45 * ramp(t, 2, 9);
    shot.white = ramp(t, 8.8, 9.4) * (1 - ramp(t, 10.5, 11.5));
    shot.black = ramp(t, 11, 12) * (1 - ramp(t, 15, 17));
    if (t >= 11) { shot.heroAlpha = 0; shot.villainAlpha = 0; shot.beams = 0; shot.star = 0; }
    shot.shield = ramp(t, 15, 17);
    shot.sword = ramp(t, 17.5, 20);
    if (t >= 21) shot.text = "The world has been saved from Evil Vinson's doings.";
    shot.zoom = 1 + .45 * ramp(t, 2, 9) - .3 * ramp(t, 15, 20);
    shot.done = t >= 26;
  }
  if (reducedMotion) { shot.zoom = 1; shot.white = 0; }
  return shot;
}
