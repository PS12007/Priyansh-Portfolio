/* The background switcher.
   One small control in the bottom-right corner: where the live mode sits in
   the cycle, its name, and a B keycap pinned to the corner. Clicking it
   steps forward, Shift+click steps back, and B / Shift+B do the same from
   anywhere on the page. Pointing at it says what the mode is, just above; the caption also
   appears for a moment after each change, then gets out of the way. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var el = PF.util.el;
  var CAPTION_HOLD_MS = 3200;

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  PF.initSwitcher = function (mount) {
    var modes = PF.bg.list();
    if (modes.length < 2) return;

    var caption = el('span.switcher-caption', { 'aria-hidden': 'true' });
    var key = el('kbd.switcher-key', { 'aria-hidden': 'true' }, 'B');
    var name = el('span.switcher-name');
    var count = el('span.switcher-count', { 'aria-hidden': 'true' });

    var button = el(
      'button.switcher-button',
      { type: 'button', 'aria-keyshortcuts': 'B Shift+B' },
      [count, name, key]
    );

    var live = el('span.visually-hidden', { role: 'status', 'aria-live': 'polite' });
    var node = el('div.switcher', null, [caption, button, live]);
    mount.appendChild(node);

    var holdTimer = null;
    var first = true;

    function showCaption(hold) {
      node.classList.add('is-showing');
      clearTimeout(holdTimer);
      if (hold) {
        holdTimer = setTimeout(function () {
          if (!node.matches(':hover') && !node.contains(document.activeElement)) {
            node.classList.remove('is-showing');
          }
        }, CAPTION_HOLD_MS);
      }
    }

    function sync(spec) {
      var at = -1;
      for (var i = 0; i < modes.length; i++) if (modes[i].id === spec.id) at = i;

      // The name swaps with a short fade rather than jumping.
      if (!first) {
        name.classList.remove('is-changing');
        void name.offsetWidth;
        name.classList.add('is-changing');
      }
      first = false;

      name.textContent = spec.label;
      count.textContent = pad(at + 1) + '/' + pad(modes.length);
      caption.textContent = spec.caption || '';
      button.setAttribute('aria-label', 'Background: ' + spec.label + '. Next background');
      live.textContent = 'Background: ' + spec.label + (spec.caption ? '. ' + spec.caption : '');
    }

    button.addEventListener('click', function (e) {
      PF.bg.cycle(e.shiftKey ? -1 : 1);
    });

    node.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'touch') showCaption(false);
    });
    node.addEventListener('pointerleave', function () {
      if (!node.contains(document.activeElement)) node.classList.remove('is-showing');
    });
    button.addEventListener('focus', function () {
      showCaption(false);
    });
    button.addEventListener('blur', function () {
      node.classList.remove('is-showing');
    });

    PF.bg.onChange(function (spec) {
      sync(spec);
      showCaption(true);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      // Never hijack the key while someone is typing.
      var t = e.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;

      e.preventDefault();
      key.classList.remove('is-pressed');
      void key.offsetWidth;
      key.classList.add('is-pressed');
      PF.bg.cycle(e.shiftKey ? -1 : 1);
    });

    var active = PF.bg.current();
    if (active) {
      sync(active);
      // Introduce the opening background once, a moment after the page has
      // settled, so a first-time visitor learns what they are looking at.
      // Not on a phone, where the caption would sit over the text.
      if (!window.matchMedia('(max-width: 640px)').matches) {
        setTimeout(function () {
          showCaption(true);
        }, 1400);
      }
    }
  };
})(window.PF);
