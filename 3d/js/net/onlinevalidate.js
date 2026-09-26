// Pitchside 3D — sanitisers for the migration-003 services (config, presence, gifts, messages, squads).
// Everything coming from the server (or another player) is bounded and re-built as plain objects.
import { cleanStr } from './protocol.js';
import { UUID_RE, FRIEND_CODE_RE, cleanJson } from './validate.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export const PACK_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const JPEG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMAGE_CHARS = 204860; // 150 KB of JPEG as base64 + prefix
export const CONFIG_KEYS = ['promos', 'packs', 'rewards', 'market', 'features'];
export const CONFIG_TTL_MS = 60 * 1000;

/** One config value (same rules as pitchside__config_error). -> clean object | null */
export function sanitizeConfigValue(key, v) {
  if (!isObj(v)) return null;
  const ent = Object.entries(v).slice(0, 200);
  const out = {};
  if (key === 'promos') {
    for (const [k, x] of ent) { if (!KEY_RE.test(k) || typeof x !== 'boolean') return null; out[k] = x; }
  } else if (key === 'features') {
    for (const [k, x] of ent) { if (!KEY_RE.test(k) || !(typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e12))) return null; out[k] = x; }
  } else if (key === 'packs') {
    for (const [k, x] of ent) {
      if (!KEY_RE.test(k) || !isObj(x)) return null;
      const p = {};
      for (const [f, y] of Object.entries(x)) {
        if (f === 'enabled' && typeof y === 'boolean') p.enabled = y;
        else if (f === 'price' && Number.isInteger(y) && y >= 0 && y <= 10000000) p.price = y;
        else return null;
      }
      out[k] = p;
    }
  } else if (key === 'rewards') {
    for (const [f, y] of ent) {
      if (typeof y !== 'number' || !Number.isFinite(y)) return null;
      if (f === 'multiplier' && y >= 0 && y <= 10) out.multiplier = y;
      else if (f === 'packChance' && y >= 0 && y <= 1) out.packChance = y;
      else return null;
    }
  } else if (key === 'market') {
    for (const [f, y] of ent) { if (f !== 'tax' || typeof y !== 'number' || !(y >= 0 && y <= 0.5)) return null; out.tax = y; }
  } else return null;
  return out;
}
/** Whole config from the server: unknown keys / bad values are dropped (never trusted blindly). */
export function sanitizeConfig(c) {
  const out = {};
  if (!isObj(c)) return out;
  for (const k of CONFIG_KEYS) { if (k in c) { const v = sanitizeConfigValue(k, c[k]); if (v) out[k] = v; } }
  return out;
}

export function sanitizeEpochs(r) {
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return isObj(r) ? { coins: n(r.coins), progress: n(r.progress), club: n(r.club) } : { coins: 0, progress: 0, club: 0 };
}
export function sanitizeBroadcast(b) {
  if (!isObj(b) || !Number.isInteger(b.id) || b.id <= 0) return null;
  const text = cleanStr(b.text, 200, '');
  return text ? { id: b.id, text, at: iso(b.at), until: iso(b.until) } : null;
}
export function sanitizePresence(d) {
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    online: Number.isInteger(d.online) && d.online >= 0 ? d.online : null,
    coins: typeof d.coins === 'number' ? nonNeg(d.coins) : null,
    infinite: d.infinite === true,
    broadcasts: Array.isArray(d.broadcasts) ? d.broadcasts.slice(0, 5).map(sanitizeBroadcast).filter(Boolean) : [],
    gifts: n(d.gifts), unread: n(d.unread), invites: n(d.invites), requests: n(d.requests),
    resets: sanitizeEpochs(d.resets),
    configVersion: Number.isFinite(d.configVersion) ? d.configVersion : null,
    role: ['player', 'mod', 'owner'].includes(d.role) ? d.role : null,
    resetEpoch: Number.isInteger(d.resetEpoch) && d.resetEpoch > 0 ? d.resetEpoch : 0,
    resetDue: Number.isInteger(d.resetDue) && d.resetDue > 0 ? d.resetDue : null,
    createdAt: iso(d.createdAt),
  };
}
/** A gift card: bounded JSON, tradable forced (the server forces it too). OVR up to 999 (admin cards). */
export function sanitizeGiftCard(c) {
  const v = cleanJson(c);
  if (!isObj(v) || typeof v.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(v.id) || typeof v.name !== 'string' || !Number.isInteger(v.ovr) || v.ovr < 1 || v.ovr > 999) return null;
  delete v.untradable;
  return { ...v, name: cleanStr(v.name, 32, 'Player'), tradable: true };
}
export function sanitizeGift(g) {
  if (!isObj(g) || typeof g.id !== 'string' || !UUID_RE.test(g.id) || !['coins', 'pack', 'card'].includes(g.kind)) return null;
  const out = { id: g.id, kind: g.kind, coins: nonNeg(g.coins), packId: null, count: 0, card: null, message: typeof g.message === 'string' ? cleanStr(g.message, 200, '') : '', all: g.all === true, at: iso(g.at), until: iso(g.until) };
  if (g.kind === 'pack') {
    if (typeof g.packId !== 'string' || !PACK_RE.test(g.packId)) return null;
    out.packId = g.packId; out.count = Number.isInteger(g.count) && g.count >= 1 && g.count <= 50 ? g.count : 1;
  } else if (g.kind === 'card') {
    out.card = sanitizeGiftCard(g.card);
    if (!out.card) return null;
  }
  return out;
}
export function sanitizePublicPlayer(p) {
  if (!isObj(p) || typeof p.id !== 'string' || !UUID_RE.test(p.id)) return null;
  return {
    id: p.id, username: typeof p.username === 'string' ? cleanStr(p.username, 16, '') || null : null, name: cleanStr(p.name, 16, 'Player'),
    friendCode: typeof p.friendCode === 'string' && FRIEND_CODE_RE.test(p.friendCode) ? p.friendCode : null, online: p.online === true,
  };
}
export function sanitizeConversation(c) {
  if (!isObj(c)) return null;
  const w = sanitizePublicPlayer(c.with);
  if (!w) return null;
  return { with: w, lastText: typeof c.lastText === 'string' ? cleanStr(c.lastText, 300, '') : '', lastImage: c.lastImage === true, lastMine: c.lastMine === true, at: iso(c.at), unread: Number.isInteger(c.unread) && c.unread > 0 ? c.unread : 0 };
}
export function sanitizeMessage(m) {
  if (!isObj(m) || !Number.isInteger(m.id)) return null;
  const image = typeof m.image === 'string' && m.image.length <= MAX_IMAGE_CHARS && JPEG_RE.test(m.image) ? m.image : null;
  const text = typeof m.text === 'string' ? cleanStr(m.text, 300, '') : '';
  if (!text && !image) return null;
  return { id: m.id, mine: m.mine === true, text, image, at: iso(m.at), read: m.read === true };
}
/** Bounded deep copy (like cleanJson, with custom limits). */
export function boundedJson(v, { depth = 5, arr = 40, keys = 48, str = 64 } = {}, d = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return cleanStr(v, str, '');
  if (d >= depth) return null;
  if (Array.isArray(v)) return v.slice(0, arr).map((x) => boundedJson(x, { depth, arr, keys, str }, d + 1));
  if (isObj(v)) {
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (n >= keys) break;
      if (!/^[A-Za-z0-9_]{1,24}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = boundedJson(v[k], { depth, arr, keys, str }, d + 1);
      n++;
    }
    return out;
  }
  return null;
}
/** Squad snapshot: bounded JSON object (depth 5, arrays <= 40, strings <= 64). */
export function cleanSquad(s) {
  const v = boundedJson(s);
  return isObj(v) ? v : null;
}

/**
 * Compress a picked image File/Blob to a JPEG data URL <= 150 KB (max 640 px side, quality steps down).
 * Browser only. -> Promise<{ ok, dataUrl, bytes } | { ok:false, error:'bad_image' }>
 */
export async function compressImage(file, { maxSide = 640, maxBytes = 150 * 1024 } = {}) {
  try {
    if (!file || typeof document === 'undefined' || !/^image\//.test(file.type || '')) return { ok: false, error: 'bad_image' };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url; });
      let side = maxSide;
      for (let attempt = 0; attempt < 6; attempt++) {
        const k = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        for (const q of [0.82, 0.7, 0.58, 0.46]) {
          const d = c.toDataURL('image/jpeg', q);
          const bytes = Math.floor((d.length - 23) * 3 / 4);
          if (bytes <= maxBytes && JPEG_RE.test(d)) return { ok: true, dataUrl: d, bytes };
        }
        side = Math.round(side * 0.75);
      }
      return { ok: false, error: 'bad_image' };
    } finally { URL.revokeObjectURL(url); }
  } catch { return { ok: false, error: 'bad_image' }; }
}
