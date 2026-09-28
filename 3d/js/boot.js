// Pitchside 3D boot watchdog: if the game module never starts (old browser, file://, a blocked or broken script),
// show the #boot-fail message instead of a blank page. Kept in its own file (not inline in index.html) so the
// Content-Security-Policy can forbid inline scripts.
(function () {
  function fail() { var b = document.getElementById('boot-fail'); if (b) b.hidden = false; }
  // js/main.js (or one of its imports) failed to load: resource errors reach window in the capture phase
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t.tagName === 'SCRIPT' && /\/js\/main\.js(\?|$)/.test(t.src || '')) fail();
  }, true);
  setTimeout(function () {
    if (!document.documentElement.classList.contains('ready')) fail();
  }, 5000);
})();
