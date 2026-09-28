// Pitchside 3D — interface style bootstrap + the two motion effects CSS alone cannot do.
// Classic script (no modules), loaded from <head> so the choice is applied before first paint (no flash).
// Everything here is inert unless <html data-ui="stadium"> is set; the styling lives in css/theme-stadium.css.
(function () {
  var root = document.documentElement;
  try {
    var s = JSON.parse(localStorage.getItem('pitchside.settings') || 'null');
    if (s && s.ui === 'stadium') root.setAttribute('data-ui', 'stadium');
  } catch (e) { /* storage blocked: stay on Classic */ }

  var on = function () { return root.getAttribute('data-ui') === 'stadium'; };
  var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ---- 1. sliding tab indicator -------------------------------------------------------------------------
  // Tab bars are rebuilt on every navigation, so the last indicator position is remembered per bar type and
  // the new bar starts from it, then slides to its own active tab.
  var BARS = [['.pm-uttabs', '.pm-uttab'], ['.mm-tabs', '.mm-tab'], ['.settings-tabs', '.tab'], ['.tabs', '.tab'], ['.pm-tabs', '.pm-tab'], ['.seg', 'button']];
  var last = {};
  function place(bar, tabSel, key) {
    var t = bar.querySelector(tabSel + '.on, ' + tabSel + '[aria-current="page"], ' + tabSel + '[aria-selected="true"]');
    if (!t || !t.offsetWidth) return;
    var fresh = !bar.hasAttribute('data-st-ind');
    bar.setAttribute('data-st-ind', '');  // first: the CSS makes the bar the offset parent, so measure after this
    var x = t.offsetLeft, w = t.offsetWidth;
    // an option row that wrapped onto several lines keeps the plain per-option underline
    if (bar.firstElementChild && bar.lastElementChild.offsetTop !== bar.firstElementChild.offsetTop) { bar.removeAttribute('data-st-ind'); return; }
    var prev = last[key];
    if (fresh) {
      // a scrolling tab bar (phone) opens with its active tab in view
      if (bar.scrollWidth > bar.clientWidth + 2) bar.scrollLeft = Math.max(0, x - (bar.clientWidth - w) / 2);
      if (prev && !calm.matches) {
        bar.style.setProperty('--st-x', prev.x + 'px');
        bar.style.setProperty('--st-w', prev.w + 'px');
        void bar.offsetWidth; // commit the start position, then move
      }
    }
    bar.style.setProperty('--st-x', x + 'px');
    bar.style.setProperty('--st-w', w + 'px');
    last[key] = { x: x, w: w };
  }
  var queued = false;
  function sweep() {
    queued = false;
    if (!on()) return;
    for (var i = 0; i < BARS.length; i++) {
      var bars = document.querySelectorAll(BARS[i][0]);
      for (var j = 0; j < bars.length; j++) place(bars[j], BARS[i][1], bars[j].className);
    }
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(sweep); } }
  function start() {
    var mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-current', 'aria-selected', 'hidden'] });
    window.addEventListener('resize', queue);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    queue();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // switching back to Classic: drop the leftovers so nothing stale is inline
  new MutationObserver(function () {
    if (on()) { queue(); return; }
    var bars = document.querySelectorAll('[data-st-ind]');
    for (var i = 0; i < bars.length; i++) { bars[i].removeAttribute('data-st-ind'); bars[i].style.removeProperty('--st-x'); bars[i].style.removeProperty('--st-w'); }
  }).observe(root, { attributes: true, attributeFilter: ['data-ui'] });

  // ---- 2. card tilt on hover (mouse only) ---------------------------------------------------------------
  // The card lifts and leans toward the pointer. Not applied inside the pack-opening
  // and walkout scenes, which have their own choreography.
  var CARD = '.pm-card';
  var SKIP = '.pm-po, .pm-wo, .pm-walkout, .pm-reveal';
  var cur = null;
  function release() {
    if (!cur) return;
    cur.classList.remove('st-tilt');
    cur.style.removeProperty('--st-rx'); cur.style.removeProperty('--st-ry');
    cur = null;
  }
  document.addEventListener('pointermove', function (e) {
    if (!on() || calm.matches || e.pointerType !== 'mouse') { if (cur) release(); return; }
    var c = e.target && e.target.closest ? e.target.closest(CARD) : null;
    if (c && c.closest(SKIP)) c = null;
    if (c !== cur) { release(); cur = c; if (cur) cur.classList.add('st-tilt'); }
    if (!cur) return;
    var r = cur.getBoundingClientRect();
    if (!r.width) return;
    var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    cur.style.setProperty('--st-ry', ((px - 0.5) * 14).toFixed(2) + 'deg');
    cur.style.setProperty('--st-rx', ((0.5 - py) * 12).toFixed(2) + 'deg');
  }, { passive: true });
  document.addEventListener('pointerleave', release, true);
  window.addEventListener('blur', release);
})();
