// Robust loading helpers for locked-down devices (school Chromebooks, filtering proxies).
// DOM-only, no Three.js import, so it still works when the 3D files are the thing that's blocked:
//   webglStatus()            -> 'ok' | 'unavailable' | 'error'   (cheap probe, context released)
//   isModuleLoadError(err)   -> true for a failed/blocked download of a JS module
//   explainLoadError(err, what) -> Error with a message a student / teacher can act on
//   lowGraphics() / setLowGraphics(on)  -> persisted "low graphics" preference
//   showLoadError(parent, { title, text, detail, actions: [{ label, primary, onClick }] }) -> panel

const LOW_KEY = 'pitchside.lowGfx';

export function webglStatus() {
  try {
    if (typeof document === 'undefined') return 'error';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return 'unavailable';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext(); // don't hold one of the browser's few contexts
    return 'ok';
  } catch {
    return 'error';
  }
}

const MODULE_ERR = /dynamically imported module|importing a module script failed|error loading dynamically imported|failed to fetch|networkerror|load failed|mime type|module script|unexpected token '<'|is not a valid javascript mime/i;
export function isModuleLoadError(err) {
  const m = String((err && (err.message || err)) || '');
  return MODULE_ERR.test(m) || (err && err.name === 'TypeError' && /import/i.test(m));
}

export function explainLoadError(err, what = 'the 3D engine') {
  if (!isModuleLoadError(err)) return err instanceof Error ? err : new Error(String(err));
  const e = new Error(`Couldn't download ${what}. A school web filter, proxy or ad-blocker may be blocking the game's script files `
    + '(for example vendor/three.module.min.js). Reload the page; if it keeps happening, ask your network admin to allow this site, or try another network.'
    + ` (${String((err && err.message) || err).slice(0, 160)})`);
  e.cause = err;
  e.blocked = true;
  return e;
}

export function lowGraphics() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(LOW_KEY) === '1'; } catch { return false; }
}
export function setLowGraphics(on) {
  try { if (on) localStorage.setItem(LOW_KEY, '1'); else localStorage.removeItem(LOW_KEY); } catch { /* private mode */ }
}

// Advice for "no WebGL": the usual causes on school machines, in plain words.
export const WEBGL_HELP = '3D graphics (WebGL) are turned off or blocked on this device. Try: reload the page; '
  + 'turn on "Use graphics acceleration when available" in the browser settings; update Chrome / ChromeOS; '
  + 'or ask your school IT to allow WebGL. You can also try "Low graphics" below.';

export function showLoadError(parent, { title, text, detail = '', actions = [] }) {
  const el = document.createElement('div');
  el.className = 'ps3d-fatal-error';
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;'
    + 'padding:24px;background:#05070d;color:#cfd8ea;font:14px/1.5 system-ui,sans-serif;text-align:center';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:520px';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin:0 0 10px;font-size:20px;color:#fff;letter-spacing:.5px';
  const p = document.createElement('p');
  p.textContent = text;
  p.style.margin = '0 0 12px';
  box.append(h, p);
  if (detail) {
    const c = document.createElement('code');
    c.textContent = String(detail).slice(0, 240);
    c.style.cssText = 'display:block;margin:0 0 14px;padding:6px 8px;border-radius:6px;background:#111a2e;color:#9fb6de;font-size:12px;word-break:break-word';
    box.append(c);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.style.cssText = `font:700 14px system-ui,sans-serif;padding:10px 18px;border-radius:8px;cursor:pointer;border:1px solid #2b3656;${a.primary ? 'background:#19f5a4;color:#03140d;border-color:#19f5a4' : 'background:#111a2e;color:#cfd8ea'}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
    row.append(b);
  }
  box.append(row);
  el.append(box);
  parent.appendChild(el);
  const first = row.querySelector('button');
  if (first) { try { first.focus({ preventScroll: true }); } catch { /* ignore */ } }
  return el;
}
