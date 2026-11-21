// Pure replay cameras. Call path(frames, timeSeconds, { scorerIndex, goalSign }).
// Frames must be time-ordered: {time, ball:{x,y,z}, players:[{x,y,z}]}.
// Engine snapshots {t, b:[x,y,z,...], p:Float32Array(22*7)} also work.
// Returns {position:{x,y,z}, target:{x,y,z}}; never writes recorded data.
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const timeOf = f => finite(f?.time, finite(f?.t));
const point = p => ({ x: finite(p?.x, finite(p?.[0])), y: finite(p?.y, finite(p?.[1])), z: finite(p?.z, finite(p?.[2])) });
function player(frame, i) {
  if (frame?.players?.[i]) return point(frame.players[i]);
  if (frame?.p?.length >= (i + 1) * 7) return { x: finite(frame.p[i * 7]), y: 0, z: finite(frame.p[i * 7 + 1]) };
  return null;
}
const interpolate = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

export function sampleReplay(frames, time, scorerIndex = 0) {
  if (!frames?.length) return { ball: { x: 0, y: 0.2, z: 0 }, scorer: { x: 0, y: 0, z: 0 }, progress: 0 };
  time = finite(time, timeOf(frames[0]));
  let low = 0, high = frames.length - 1;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (timeOf(frames[mid]) <= time) low = mid; else high = mid - 1; }
  const a = frames[low], b = frames[Math.min(low + 1, frames.length - 1)];
  const span = timeOf(b) - timeOf(a);
  const t = span > 0 ? Math.max(0, Math.min(1, (time - timeOf(a)) / span)) : 0;
  const ball = interpolate(point(a.ball || a.b), point(b.ball || b.b), t);
  const pa = player(a, scorerIndex) || ball, pb = player(b, scorerIndex) || pa;
  const duration = timeOf(frames[frames.length - 1]) - timeOf(frames[0]);
  return { ball, scorer: interpolate(pa, pb, t), progress: duration > 0 ? Math.max(0, Math.min(1, (time - timeOf(frames[0])) / duration)) : 0 };
}

export function broadcastReplay(frames, time, options = {}) {
  const { ball } = sampleReplay(frames, time, options.scorerIndex);
  return { position: { x: ball.x * 0.65, y: 15, z: 27 }, target: { x: ball.x, y: Math.max(0.5, ball.y), z: ball.z } };
}

export function scorerOrbitReplay(frames, time, options = {}) {
  const { ball, scorer, progress } = sampleReplay(frames, time, options.scorerIndex);
  const eased = progress * progress * (3 - 2 * progress), angle = -0.45 + eased * 0.8;
  const sign = options.goalSign === -1 ? -1 : 1;
  return { position: { x: scorer.x - sign * Math.cos(angle) * 7, y: 2.7 + eased * 0.6, z: scorer.z + Math.sin(angle) * 7 },
    target: { x: mix(scorer.x, ball.x, 0.3), y: Math.max(1, ball.y * 0.4), z: mix(scorer.z, ball.z, 0.3) } };
}

export function goalLineReplay(frames, time, options = {}) {
  const { ball, progress } = sampleReplay(frames, time, options.scorerIndex);
  const sign = options.goalSign === -1 ? -1 : 1;
  return { position: { x: sign * 56, y: mix(3.8, 3.2, progress), z: mix(10, 8, progress) },
    target: { x: ball.x, y: Math.max(0.45, ball.y), z: ball.z } };
}

export const REPLAY_CAMERAS = Object.freeze({ broadcast: broadcastReplay, scorerOrbit: scorerOrbitReplay, goalLine: goalLineReplay });
