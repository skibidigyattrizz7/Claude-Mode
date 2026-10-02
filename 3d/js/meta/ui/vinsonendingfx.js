// Quiet, self-contained sunset finale layer. The caller owns dialogue and timing.
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));
const mix = (a, b, p) => a + (b - a) * p;
const easeOut = p => 1 - Math.pow(1 - clamp(p), 3);

function hill(ctx, points, fill) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], 720);
  ctx.lineTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
  ctx.lineTo(1280, 720);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawShield(ctx, drawStar) {
  ctx.save();
  ctx.translate(590, 501);
  ctx.rotate(-0.035);
  // Captain's round, weathered steel shield with the familiar red and blue bands.
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2);
  ctx.fillStyle = '#384b50'; ctx.fill(); ctx.strokeStyle = '#b4b8a9'; ctx.lineWidth = 7; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 53, 0, Math.PI * 2); ctx.fillStyle = '#a13737'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 39, 0, Math.PI * 2); ctx.fillStyle = '#344f68'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fillStyle = '#a13737'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fillStyle = '#344f68'; ctx.fill();
  ctx.strokeStyle = '#bec1b0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 57, -2.5, 2.45); ctx.stroke();
  if (typeof drawStar === 'function') drawStar(ctx, 0, 0, 23, 0, 0.98);
  // Scuffs keep the steel worn and quiet; avoid a shiny, floating-reward glint.
  ctx.strokeStyle = '#263536'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-40, 40); ctx.lineTo(-32, 34); ctx.moveTo(43, 35); ctx.lineTo(48, 27); ctx.stroke();
  ctx.restore();
}

function drawSword(ctx, progress, landingAge, reducedMotion) {
  const p = clamp(progress);
  if (p <= 0) return;
  // Gravity accelerates the descent; clamp at impact so the planted pose stays fixed.
  const landed = p * p;
  const x = 710;
  const impactAge=Number.isFinite(landingAge)?landingAge:99;
  const wobble=!reducedMotion&&impactAge<.4?Math.sin(impactAge*42)*(1-impactAge/.4)*.018:0;
  const tipY = mix(-122, 630, landed);
  const angle = mix(-0.035, -0.10, landed);
  ctx.save();
  ctx.beginPath();ctx.rect(0,0,1280,571);ctx.clip();
  ctx.translate(x, tipY);
  ctx.rotate(angle+wobble);
  // The landing point is the blade tip; blade, guard, grip and pommel rise above it.
  ctx.beginPath(); ctx.moveTo(-10, -128); ctx.lineTo(10, -128); ctx.lineTo(7, -28); ctx.lineTo(0, 0); ctx.lineTo(-7, -28); ctx.closePath();
  ctx.fillStyle = '#bdc4b9'; ctx.fill();
  ctx.strokeStyle = '#eef0df'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -122); ctx.lineTo(0, -8); ctx.stroke();
  ctx.fillStyle = '#b79b58'; ctx.strokeStyle = '#57462e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-31, -137); ctx.quadraticCurveTo(0, -144, 31, -137); ctx.lineTo(28, -129); ctx.quadraticCurveTo(0, -134, -28, -129); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3f382d'; ctx.fillRect(-6, -184, 12, 45);
  ctx.strokeStyle = '#a99a75'; ctx.lineWidth = 2;
  for (let y = -178; y < -145; y += 9) { ctx.beginPath(); ctx.moveTo(-5, y); ctx.lineTo(5, y - 4); ctx.stroke(); }
  ctx.fillStyle = '#b79b58'; ctx.beginPath(); ctx.arc(0, -192, 8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawPeacefulEnding(ctx, shot, t, reducedMotion, drawStar) {
  const alpha = clamp(shot?.peace);
  if (!alpha) return;
  const time = Number.isFinite(t) ? t : 0;
  const breeze = reducedMotion ? 0 : Math.sin(time * 0.38) * 2;
  ctx.save();
  ctx.globalAlpha *= alpha;

  // Warm late-evening sky, with the brightest light low on the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, 720);
  sky.addColorStop(0, '#d98265'); sky.addColorStop(0.48, '#f0ae7d'); sky.addColorStop(1, '#f5d39a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1280, 720);
  const halo = ctx.createRadialGradient(912 + breeze * 0.15, 300, 5, 912 + breeze * 0.15, 300, 88);
  halo.addColorStop(0, 'rgba(255,248,211,.88)'); halo.addColorStop(.48, 'rgba(255,231,172,.32)'); halo.addColorStop(1, 'rgba(255,231,172,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(912 + breeze * 0.15, 300, 88, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff1bf'; ctx.beginPath(); ctx.arc(912 + breeze * 0.15, 300, 33, 0, Math.PI * 2); ctx.fill();
  ctx.save();ctx.globalAlpha=.10;ctx.fillStyle='#fff8d5';
  for(let i=0;i<5;i++){const a=.3+i*.32;ctx.beginPath();ctx.moveTo(912,300);ctx.lineTo(912+Math.cos(a)*480,300+Math.sin(a)*480);ctx.lineTo(912+Math.cos(a+.07)*480,300+Math.sin(a+.07)*480);ctx.closePath();ctx.fill();}
  ctx.globalAlpha=.15;for(let i=0;i<4;i++){const x=130+i*290+(reducedMotion?0:(time*3+i*17)%80);ctx.beginPath();ctx.ellipse(x,175+i%2*45,100,13,0,0,Math.PI*2);ctx.fill();}ctx.restore();

  hill(ctx, [[0, 437], [145, 377], [282, 427], [460, 350], [634, 421], [826, 362], [1015, 417], [1155, 367], [1280, 405]], '#b97864');
  hill(ctx, [[0, 471], [185, 422], [338, 460], [518, 397], [699, 454], [874, 410], [1058, 463], [1191, 416], [1280, 443]], '#7f7954');
  const haze = ctx.createLinearGradient(0, 300, 0, 500);
  haze.addColorStop(0, 'rgba(248,205,158,0)'); haze.addColorStop(.45, 'rgba(248,205,158,.08)'); haze.addColorStop(.8, 'rgba(248,205,158,.24)'); haze.addColorStop(1, 'rgba(248,205,158,0)');
  ctx.fillStyle = haze; ctx.fillRect(0, 300, 1280, 200);
  // Meadow layers leave the horizon open and hold a broad, quiet foreground.
  ctx.fillStyle = '#65744a'; ctx.beginPath(); ctx.moveTo(0, 461); ctx.quadraticCurveTo(330, 431, 635, 463); ctx.quadraticCurveTo(940, 438, 1280, 467); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4e603d'; ctx.beginPath(); ctx.moveTo(0, 540); ctx.quadraticCurveTo(310, 497, 650, 535); ctx.quadraticCurveTo(1010, 493, 1280, 534); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#394d35'; ctx.beginPath(); ctx.moveTo(0, 613); ctx.quadraticCurveTo(360, 560, 690, 602); ctx.quadraticCurveTo(1000, 563, 1280, 606); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill();

  // Fixed meadow strokes use a deterministic pattern, with a low, bounded breeze.
  const grassColors = ['#87915e', '#a19b63', '#6d8150', '#9b8c59'];
  for (let i = 0; i < 104; i++) {
    const x = (i * 131 + 29) % 1280;
    const y = 514 + ((i * 47 + Math.floor(i / 7) * 13) % 194);
    const height = 7 + ((i * 17) % 15), side = ((i * 11) % 9 - 4) * 0.42;
    const sway = reducedMotion ? 0 : breeze * (0.35 + (i % 4) * 0.13);
    ctx.strokeStyle = grassColors[i % grassColors.length]; ctx.lineWidth = i % 6 === 0 ? 2 : 1.35;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + side + sway * .35, y - height * .55, x + side + sway, y - height); ctx.stroke();
  }

  // A few restrained, fixed wildflowers give the foreground life without visual noise.
  for (const [x, y, color] of [[180, 626, '#d9b879'], [405, 600, '#d4a78b'], [1014, 621, '#d9b879'], [1177, 596, '#d7b98c']]) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + breeze * 0.35, y, 2.3, 0, Math.PI * 2); ctx.fill();
  }

  // Soft cast shadows anchor both keepsakes to the same soil plane.
  ctx.fillStyle = 'rgba(36,45,31,.24)'; ctx.beginPath(); ctx.ellipse(590, 558, 76, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(710, 560, 41, 9, 0, 0, Math.PI * 2); ctx.fill();
  // The shield and sword are quiet memorial objects; soil partly covers their lower edges.
  drawShield(ctx, drawStar);
  if(clamp(shot.sword)>.94){
    const age=Number.isFinite(shot.landingAge)?shot.landingAge:99,impact=clamp(1-age/.5);
    ctx.fillStyle='rgba(35,35,25,.34)';ctx.beginPath();ctx.ellipse(710,568,48,11,0,0,Math.PI*2);ctx.fill();
    if(impact>0){ctx.save();ctx.globalAlpha*=impact;ctx.strokeStyle='#b99a62';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(710,568,28+(1-impact)*52,7+(1-impact)*10,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }
  drawSword(ctx, shot.sword, shot.landingAge, reducedMotion);
  ctx.fillStyle = '#394a32'; ctx.beginPath(); ctx.ellipse(590, 571, 54, 11, 0, 0, Math.PI * 2); ctx.fill();
  // A low mound carries across both keepsakes and covers the shield's lower third.
  ctx.fillStyle = '#33432f'; ctx.beginPath();
  ctx.moveTo(505, 540); ctx.quadraticCurveTo(545, 512, 583, 522); ctx.quadraticCurveTo(610, 537, 636, 540);
  ctx.quadraticCurveTo(672, 530, 709, 541); ctx.quadraticCurveTo(741, 550, 775, 536);
  ctx.lineTo(785, 720); ctx.lineTo(488, 720); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#728052'; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(506, 543); ctx.quadraticCurveTo(548, 516, 583, 527); ctx.quadraticCurveTo(612, 542, 638, 545);
  ctx.quadraticCurveTo(678, 535, 711, 546); ctx.quadraticCurveTo(744, 554, 775, 541); ctx.stroke();
  ctx.fillStyle = '#85714b';
  for (const [x, y, r] of [[660,565,2.4],[678,571,1.8],[743,568,2.1],[757,562,1.6],[550,574,1.8],[624,574,2.0]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // A tiny deterministic soil kick fades only when the caller supplies landingAge.
  if (clamp(shot.sword) > .94 && Number.isFinite(shot.landingAge) && shot.landingAge >= 0 && shot.landingAge < .42) {
    const kick = 1 - shot.landingAge / .42;
    ctx.save(); ctx.globalAlpha *= kick; ctx.fillStyle = '#96784d';
    const flecks = [[-19,-5,2],[-11,-11,1.5],[-3,-8,1.8],[8,-12,1.5],[17,-6,2],[-24,-1,1.3],[23,-1,1.4],[-7,-15,1.1],[13,-16,1.2],[-16,-14,1.2],[4,-4,1.1],[27,-10,1.1]];
    for (const [dx, dy, r] of flecks) { ctx.beginPath(); ctx.arc(710 + dx, 565 + dy - kick * (4 + r), r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
}
