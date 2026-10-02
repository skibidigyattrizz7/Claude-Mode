// Small, bounded source-image crops for Vinson's animated photo pieces.
const MAX_SIDE = 512;

function canvasFactory(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return null;
}

function boundsOf(piece, sourceWidth, sourceHeight) {
  if (piece.radius) {
    // trace() expresses the radius in source-width pixels, so translate that
    // same pixel radius back into normalized Y units for non-square photos.
    const [x, y] = piece.anchor, rx = piece.radius, ry = piece.radius*sourceWidth/sourceHeight;
    return { x: x-rx, y: y-ry, width: rx*2, height: ry*2 };
  }
  const xs = piece.points.map(p => p[0]), ys = piece.points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs)-x, height: Math.max(...ys)-y };
}

function trace(ctx, piece, w, h) {
  if (piece.radius) {
    ctx.arc(piece.anchor[0]*w, piece.anchor[1]*h, piece.radius*w, 0, Math.PI*2);
    return;
  }
  piece.points.forEach(([x,y],i) => i ? ctx.lineTo(x*w,y*h) : ctx.moveTo(x*w,y*h));
  ctx.closePath();
}

export class VinsonRenderCache {
  constructor(createCanvas = canvasFactory, maxSide = MAX_SIDE) {
    this.createCanvas = createCanvas;
    this.maxSide = maxSide;
    this.images = new WeakMap();
  }
  get(image, key, piece) {
    if (!image || !piece || !Number.isFinite(image.naturalWidth) || image.naturalWidth <= 0) return null;
    let byKey = this.images.get(image);
    if (!byKey) { byKey = new Map(); this.images.set(image, byKey); }
    if (byKey.has(key)) return byKey.get(key);
    const sw = image.naturalWidth, sh = image.naturalHeight, bounds = boundsOf(piece,sw,sh);
    const px = bounds.x*sw, py = bounds.y*sh, pw = bounds.width*sw, ph = bounds.height*sh;
    const factor = Math.min(1, this.maxSide/Math.max(pw,ph));
    const width = Math.max(1, Math.ceil(pw*factor)), height = Math.max(1, Math.ceil(ph*factor));
    const canvas = this.createCanvas(width,height);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.scale(width/pw,height/ph); ctx.translate(-px,-py);
    ctx.beginPath(); trace(ctx,piece,sw,sh); ctx.clip(); ctx.drawImage(image,0,0,sw,sh); ctx.restore();
    const cached = {
      canvas, width, height, factor,
      anchorX: (piece.anchor[0]*sw-px)*(width/pw),
      anchorY: (piece.anchor[1]*sh-py)*(height/ph)
    };
    byKey.set(key,cached);
    return cached;
  }
}

export const vinsonRenderCache = new VinsonRenderCache();
