// Pitchside 3D test link (owner, Sep 29): open the game with ?test=1 for a throwaway session.
//   - Every save (localStorage + sessionStorage: settings, Ultimate Team, career, account, admin) lives in memory
//     only, so closing or reloading the tab starts again from a clean slate. Nothing is written to the browser.
//   - Online features use the built-in fake server (?mockOnline=1, js/net/mockbackend.js), itself stored in that
//     same memory, so test mode never touches the real database or real players.
//   - Owner Access (admin) is on so every feature can be tried.
// Classic script, loaded first in <head> so nothing reads real storage before the swap. Inert without ?test=1.
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('test') !== '1') return;

  function MemoryStorage() { this._d = Object.create(null); }
  MemoryStorage.prototype = {
    get length() { return Object.keys(this._d).length; },
    key: function (i) { var k = Object.keys(this._d); return i >= 0 && i < k.length ? k[i] : null; },
    getItem: function (k) { k = String(k); return k in this._d ? this._d[k] : null; },
    setItem: function (k, v) { this._d[String(k)] = String(v); },
    removeItem: function (k) { delete this._d[String(k)]; },
    clear: function () { this._d = Object.create(null); },
  };
  var local = new MemoryStorage(), session = new MemoryStorage();
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } });
  } catch (e) {
    // could not swap storage: refuse to run test mode on top of real saves
    alert('Test mode is not supported in this browser.'); location.search = ''; return;
  }
  window.PITCHSIDE_TEST = true;
  document.documentElement.setAttribute('data-test', '1');

  // fake online server (no real network, no real database)
  if (q.get('mockOnline') !== '1') { q.set('mockOnline', '1'); history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); }
  // Owner Access for testing (only ever inside this in-memory session)
  session.setItem('pitchside.admin.session', JSON.stringify({ level: 'super' }));

  function banner() {
    var b = document.createElement('div');
    b.id = 'ps-testmode';
    b.textContent = 'TEST MODE · nothing is saved · reload = clean slate';
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;pointer-events:none;opacity:.92;'
      + 'background:#ffcc00;color:#111;font:700 12px/1 system-ui,sans-serif;letter-spacing:.06em;padding:6px 12px;border-radius:999px;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap';
    document.body.appendChild(b);
  }
  if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
})();
