// Pitchside 3D live test mode (owner, Oct 1): open the game with ?livetest=1.
//   - Starts logged out as a brand-new guest. Every save (Ultimate Team, career, settings, account, identity) lives in
//     its own section of this browser's storage ("pitchside.livetest::..."), so the real club on this laptop is never
//     read or changed. Unlike ?test=1 it survives reloads, so aftermath screens (bans, curses, reload checks) work.
//   - Uses the REAL online server: the test guest is a real player that the owner can find and target with admin
//     commands from another account. No Owner Access is given here.
//   - The banner's Reset starts a new guest (the old test player stays on the server; delete it from Admin).
// Classic script, loaded first in <head> so nothing reads real storage before the swap. Inert without ?livetest=1.
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('livetest') !== '1' || q.get('test') === '1') return;
  var NS = 'pitchside.livetest::';

  function Section(real) { this._r = real; }
  Section.prototype = {
    _keys: function () {
      var out = [];
      for (var i = 0; i < this._r.length; i++) { var k = this._r.key(i); if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length)); }
      return out;
    },
    get length() { return this._keys().length; },
    key: function (i) { var k = this._keys(); return i >= 0 && i < k.length ? k[i] : null; },
    getItem: function (k) { return this._r.getItem(NS + String(k)); },
    setItem: function (k, v) { this._r.setItem(NS + String(k), String(v)); },
    removeItem: function (k) { this._r.removeItem(NS + String(k)); },
    clear: function () { var self = this; this._keys().forEach(function (k) { self._r.removeItem(NS + k); }); },
  };
  var realLocal, realSession;
  try { realLocal = window.localStorage; realSession = window.sessionStorage; realLocal.length; } catch (e) { realLocal = null; }
  if (!realLocal) { alert('Live test mode needs browser storage.'); return; }
  var local = new Section(realLocal), session = new Section(realSession);
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } });
  } catch (e) {
    // could not swap storage: refuse to run on top of the real saves
    alert('Live test mode is not supported in this browser.'); q.delete('livetest'); location.search = q.toString(); return;
  }
  window.PITCHSIDE_LIVETEST = true;
  document.documentElement.setAttribute('data-livetest', '1');

  function banner() {
    var b = document.createElement('div');
    b.id = 'ps-livetest';
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;display:flex;align-items:center;gap:8px;'
      + 'background:#ffcc00;color:#111;font:700 12px/1 system-ui,sans-serif;letter-spacing:.04em;padding:5px 6px 5px 12px;'
      + 'border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap';
    var t = document.createElement('span'); t.textContent = 'LIVE TEST · test guest · real server'; b.appendChild(t);
    function btn(label, fn) {
      var x = document.createElement('button'); x.type = 'button'; x.textContent = label; x.onclick = fn;
      x.style.cssText = 'cursor:pointer;border:0;border-radius:999px;background:#111;color:#ffcc00;font:700 11px/1 system-ui,sans-serif;padding:5px 9px';
      b.appendChild(x);
    }
    btn('Reset', function () {
      if (!confirm('Start again as a new test guest? Your real club is not affected.')) return;
      local.clear(); session.clear(); location.reload();
    });
    btn('Exit', function () { q.delete('livetest'); var s = q.toString(); location.href = location.pathname + (s ? '?' + s : '') + location.hash; });
    document.body.appendChild(b);
  }
  if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
})();
