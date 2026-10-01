// Continuous camera/effect choreography. No DOM, timers or account side effects.
const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));
export const VINSON_CINEMATIC_DURATION = { transition: 28, finale: 26 };
export function sampleVinsonCinematic(kind, time, { reducedMotion = false } = {}) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const shot = { time: t, black: 0, white: 0, zoom: 1, focusX: 640, focusY: 425,
    hero: 'patel', villain: 'world', heroAlpha: 1, villainAlpha: 1, beams: 0,
    star: 0, shield: 0, sword: 0, impact: 0, text: '', speaker: '', dialogueId: '', letterbox: 1, done: false,
    // Transition-only choreography: normalized struggle/impact strength, eye-ring world X,
    // whiteout strength, Captain's arrival/beam/star, and smooth star rotation in radians.
    clashProgress: 0, clashPower: 0, clashX: 640, explosion: 0, arrival: 0, skyBeam: 0, arrivalStar: 0, arrivalSpin: 0 };
  if (kind === 'transition') {
    // World fades after defeat; Phonk returns through a soft veil rather than a cut.
    shot.villainAlpha = 1 - ramp(t, 0, 2.2);
    shot.black = .78 * ramp(t, 2.2, 3.1) * (1 - ramp(t, 4.1, 5.1));
    if (t >= 4) { shot.villain = 'phonk'; shot.villainAlpha = ramp(t, 4, 5.8); }
    if (t >= 5.2 && t < 6.1) { shot.speaker = 'PHONK MODE VINSON'; shot.text = 'Your victory was only the beginning.'; shot.dialogueId='phonk-arrives'; }
    if (t >= 6.1 && t < 7) { shot.speaker='ISRAELI PATEL'; shot.text="Then I'll face you myself."; shot.dialogueId='patel-challenge'; }
    if (t >= 7 && t < 7.8) { shot.speaker='PHONK MODE VINSON'; shot.text='Your light ends here.'; shot.dialogueId='phonk-threat'; }

    // The eye clash holds an eight-second struggle. Its collision point starts at center,
    // then sweeps and oscillates toward each fighter while the ring and sparks intensify.
    const struggle = ramp(t, 7.8, 8.5) * (1 - ramp(t, 15.7, 16.2));
    const clashU = clamp((t - 8.5) / 7.2);
    shot.clashProgress = struggle * clashU;
    shot.clashPower = struggle * (.18 + .82 * smooth(clashU));
    const contested=640-Math.sin((t-8.5)*2.15)*285*clashU;
    shot.clashX = Math.max(350,Math.min(930,contested+(355-contested)*ramp(t,14.7,16.2)));
    shot.impact = shot.clashPower;
    shot.beams = struggle * (.2 + .8 * smooth(clashU));
    shot.zoom = 1 + .12 * struggle * smooth(clashU);

    // Patel loses in a full white explosion. Captain forms out of the descending light
    // column, with an orbiting Star of David that turns steadily as he appears.
    shot.explosion = ramp(t, 15.7, 16.15) * (1 - ramp(t, 17.25, 17.65));
    shot.white = shot.explosion;
    shot.heroAlpha = 1 - ramp(t, 15.7, 16.2);
    shot.skyBeam = ramp(t, 17.05, 17.8) * (1 - ramp(t, 21.2, 22.5));
    shot.arrival = ramp(t, 18.1, 21.6);
    shot.arrivalStar = ramp(t, 17.8, 20.1) * (1 - ramp(t, 22.5, 24));
    shot.arrivalSpin = (t - 17.8) * (reducedMotion ? .35 : 1.25);
    if (t >= 18.1) { shot.hero = 'captain'; shot.heroAlpha = shot.arrival; }
    shot.black = .22 * ramp(t, 21.6, 22.2) * (1 - ramp(t, 23.4, 24.2));
    if (t >= 22 && t < 24.1) { shot.speaker = 'CAPTAIN ISRAEL'; shot.text = 'Have no fear. Captain Israel is here.'; shot.dialogueId='captain-arrives'; }
    if (t >= 24.1) { shot.speaker = 'PHONK MODE VINSON'; shot.text = "I'll teach you the ways of mango."; shot.dialogueId='phonk-mango'; }
    if (shot.dialogueId) { const hero = shot.dialogueId === 'patel-challenge' || shot.dialogueId === 'captain-arrives'; shot.focusX = hero ? 300 : 980; shot.focusY = 335; }
    shot.zoom = Math.max(shot.zoom, 1 + .07 * ramp(t, 5.2, 5.9) * (1 - ramp(t, 24.1, 25)));
    shot.focusX = 640; // Both fighters stay in frame while the collision point struggles.
    shot.focusY = 425;
    if (shot.dialogueId) { const hero = shot.dialogueId === 'patel-challenge' || shot.dialogueId === 'captain-arrives'; shot.focusX = hero ? 300 : 980; shot.focusY = 335; }
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
    if (t >= 21) { shot.text = "The world has been saved from Evil Vinson's doings."; shot.dialogueId='captain-victory'; shot.speaker='CAPTAIN ISRAEL'; shot.focusX=640; shot.focusY=425; }
    shot.zoom = 1 + .45 * ramp(t, 2, 9) - .3 * ramp(t, 15, 20);
    shot.focusX=640;shot.focusY=435;
    shot.impact=ramp(t,8.65,8.9)*(1-ramp(t,10.3,11.1));
    shot.done = t >= 26;
  }
  if (reducedMotion) { shot.zoom = 1; shot.white = 0; shot.explosion = 0; }
  return shot;
}
