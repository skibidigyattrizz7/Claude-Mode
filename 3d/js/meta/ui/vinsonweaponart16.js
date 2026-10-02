// Prototype 16 weapon impact art. Canvas-only and deterministic: geometry is derived
// from the supplied impact record and time, so drawing never advances gameplay state.
const BLUE = '#0038b8';
const WHITE = '#ffffff';
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function triangle(ctx, radius, rotation) {
  for (let i = 0; i < 3; i++) {
    const a = rotation - Math.PI / 2 + i * TAU / 3;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function starPath(ctx, radius, rotation) {
  ctx.beginPath();
  triangle(ctx, radius, rotation);
  triangle(ctx, radius, rotation + Math.PI);
}

/** Draws a crisp six-point flag star with two crossing triangles and blue bands. */
export function drawFlagStar(ctx, x, y, r, rotation = 0, alpha = 1) {
  if (!ctx || typeof ctx.save !== 'function') return;
  const radius = Math.max(0, finite(r));
  if (!radius) return;
  ctx.save();
  ctx.translate(finite(x), finite(y));
  ctx.globalAlpha *= clamp(finite(alpha, 1));

  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'round';
  // Hollow flag-blue bands on a thin white rim, as requested in Claude's P11 notes.
  // Both triangle paths must survive: beginPath belongs outside triangle().
  starPath(ctx, radius * .9, finite(rotation));
  ctx.strokeStyle = WHITE; ctx.lineWidth = Math.max(3, radius * .17); ctx.stroke();
  starPath(ctx, radius * .9, finite(rotation));
  ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.7, radius * .11); ctx.stroke();
  ctx.restore();
}

function weaponStyle(weapon) {
  const key = String(weapon ?? '').toLowerCase();
  if (key.includes('eye') || key.includes('gaze')) return 'eyes';
  if (key.includes('six') || key.includes('constellation') || key.includes('lattice')) return 'sixfold';
  if (key.includes('nova') || key.includes('domain') || key.includes('ultimate')) return 'nova';
  if (key.includes('explosive') || key.includes('burst') || key.includes('shotgun') || key.includes('scatter')) return 'burst';
  return 'spin';
}

function drawShard(ctx, x, y, angle, length, width, alpha, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length, -width * .28);
  ctx.lineTo(length * .68, 0);
  ctx.lineTo(length, width * .28);
  ctx.closePath();
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = Math.max(1, width * .12);
  ctx.stroke();
  drawFlagStar(ctx, length * .77, 0, Math.max(3, width * .46), rotation, .9);
  ctx.restore();
}

/**
 * Draw a tiered weapon impact from {x,y,age,life,tier,weapon,stage}.
 * Tier 1 is an imprint, tier 2 adds a six-shard expansion, tier 3 adds a nova
 * shockwave and six satellite stars. Returns a small description of the render.
 */
export function drawStarImpact(ctx, impact, t, reducedMotion = false) {
  if (!ctx || typeof ctx.save !== 'function' || !impact) return { drawn: false, tier: 0, style: 'spin' };
  const life = Math.max(.001, finite(impact.life, 1));
  const age = clamp(finite(impact.age) / life);
  const rawTier = impact.tier;
  const tier = clamp(Math.round(typeof rawTier === 'string' ? Number(rawTier.replace(/[^0-9]/g, '')) : finite(rawTier, 1)), 1, 3);
  const style = weaponStyle(impact.weapon);
  const x = finite(impact.x), y = finite(impact.y);
  const progress = reducedMotion ? .42 : age;
  const fade = (1 - age) ** .72;
  const stage = String(impact.stage ?? '').toLowerCase();
  const stageBoost = stage.includes('impact') || stage.includes('hit') ? 1.08 : 1;
  const base = (tier === 1 ? 15 : tier === 2 ? 21 : 29) * stageBoost;
  const elapsed = Math.max(0, finite(t));
  const spinRate = style === 'sixfold' ? .55 : style === 'burst' ? .35 : style === 'nova' ? .45 : .7;
  const spin = reducedMotion ? 0 : elapsed * spinRate * (style === 'spin' ? 1 : -1);
  const swell = reducedMotion ? 1 : .84 + .16 * Math.sin(Math.PI * Math.min(1, progress));

  ctx.save();
  ctx.globalAlpha *= fade;
  if (tier >= 3) {
    const ringR = base * (1.65 + progress * (style === 'nova' ? 3.4 : 2.55));
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, TAU);
    ctx.strokeStyle = style === 'nova' ? WHITE : BLUE;
    ctx.globalAlpha *= style === 'nova' ? .46 : .3;
    ctx.lineWidth = style === 'nova' ? 3 : 2;
    ctx.stroke();
    ctx.globalAlpha = fade * (style === 'nova' ? .6 : .44);
  } else if (tier === 2) {
    ctx.beginPath();
    ctx.arc(x, y, base * (1.2 + progress * 1.35), 0, TAU);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 2;
    ctx.globalAlpha *= .5;
    ctx.stroke();
    ctx.globalAlpha = fade;
  }

  if (tier >= 2) {
    const count = 6;
    const burst = style === 'burst' ? 1.2 : style === 'nova' ? 1.12 : 1;
    const distance = base * burst * (.92 + progress * 1.55);
    for (let i = 0; i < count; i++) {
      const a = spin + i * TAU / count + (style === 'sixfold' ? Math.PI / 6 : 0);
      drawShard(ctx, x + Math.cos(a) * distance * .48, y + Math.sin(a) * distance * .48,
        a, base * (.82 + (i % 2) * .12), base * .26, fade * (1 - progress * .28), spin);
    }
  }

  const starRadius = base * swell * (1 + progress * (tier === 1 ? .1 : .2));
  drawFlagStar(ctx, x, y, starRadius, spin, fade);
  drawFlagStar(ctx, x, y, starRadius * .46, style === 'sixfold' ? -spin * .7 : spin * .55, fade * .9);

  if (style === 'eyes') {
    const eyeY = starRadius * .04, eyeX = starRadius * .27, eyeR = Math.max(1.5, starRadius * .09);
    ctx.fillStyle = BLUE;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(x + side * eyeX, y + eyeY, eyeR, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + side * eyeX, y + eyeY, eyeR * .4, 0, TAU);
      ctx.fillStyle = WHITE; ctx.fill(); ctx.fillStyle = BLUE;
    }
  }

  if (tier >= 3) {
    for (let i = 0; i < 6; i++) {
      const a = spin * (style === 'nova' ? .4 : 1) + i * TAU / 6;
      const orbit = base * (2.1 + progress * 2.15);
      const sx = x + Math.cos(a) * orbit, sy = y + Math.sin(a) * orbit;
      const satelliteR = base * (.19 + (i % 2) * .035);
      drawFlagStar(ctx, sx, sy, satelliteR, -spin + a * .25, fade * .88);
    }
  }
  ctx.restore();
  return { drawn: true, tier, style, progress: age };
}
