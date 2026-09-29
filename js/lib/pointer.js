/* One shared, smoothed pointer. Backgrounds read from it rather than each
   attaching their own listeners, so cursor influence stays consistent and
   cheap. Values are normalised 0..1 across the viewport. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var pointer = {
    // Raw target, updated on input.
    tx: 0.5,
    ty: 0.5,
    // Smoothed values the backgrounds actually sample.
    x: 0.5,
    y: 0.5,
    // 0 when idle, eases to 1 while the pointer is active. Backgrounds
    // multiply their cursor response by this so nothing snaps on entry.
    strength: 0,
    active: false,
  };

  var targetStrength = 0;
  var idleTimer = null;

  function setTarget(clientX, clientY) {
    pointer.tx = util.clamp(clientX / window.innerWidth, 0, 1);
    pointer.ty = util.clamp(clientY / window.innerHeight, 0, 1);
    pointer.active = true;
    targetStrength = 1;

    // Let the influence fade back out if the pointer stops moving for a while.
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      targetStrength = 0;
      pointer.active = false;
    }, 2600);
  }

  window.addEventListener(
    'pointermove',
    function (e) {
      if (e.pointerType === 'touch') return; // Touch drags the page, not the field.
      setTarget(e.clientX, e.clientY);
    },
    { passive: true }
  );

  window.addEventListener('pointerleave', function () {
    targetStrength = 0;
    pointer.active = false;
  });

  window.addEventListener('blur', function () {
    targetStrength = 0;
    pointer.active = false;
  });

  /** Called once per frame by the background manager. */
  pointer.update = function (dt) {
    if (util.reducedMotion()) {
      pointer.x = 0.5;
      pointer.y = 0.5;
      pointer.strength = 0;
      return;
    }
    // Deliberately slow: cursor influence should read as drift, not tracking.
    var k = util.damp(2.2, dt);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    pointer.strength += (targetStrength - pointer.strength) * util.damp(1.4, dt);
  };

  /* Clicks that land on the page itself rather than on something in it.
     Links, buttons and the switcher keep their clicks, and so does the end
     of a text selection. Backgrounds subscribe with onTap and get the point
     in viewport pixels; the return value unsubscribes. */
  var INTERACTIVE = 'a, button, input, textarea, select, summary, label, [role="button"], .switcher';
  var tapListeners = [];

  window.addEventListener('click', function (e) {
    if (!tapListeners.length || e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest(INTERACTIVE)) return;
    var selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed) return;
    for (var i = 0; i < tapListeners.length; i++) tapListeners[i](e.clientX, e.clientY);
  });

  pointer.onTap = function (fn) {
    tapListeners.push(fn);
    return function () {
      var at = tapListeners.indexOf(fn);
      if (at >= 0) tapListeners.splice(at, 1);
    };
  };

  PF.pointer = pointer;
})(window.PF);
