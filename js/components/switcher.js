/* The background switcher.
   A flat row in the corner: a tick per mode, the current mode's name, and the
   keyboard hint. Above it, a single line saying what the background actually
   is — shown for a few seconds after every change and whenever the control is
   hovered, so the idea behind each one is never more than a glance away. The
   ticks double as a position indicator, and clicking one jumps straight to
   that mode. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var el = PF.util.el;
  var CAPTION_HOLD_MS = 4200;

  PF.initSwitcher = function (mount) {
    var modes = PF.bg.list();
    if (modes.length < 2) return;

    var label = el('span.switcher-label');
    var caption = el('p.switcher-caption', { 'aria-hidden': 'true' });

    // One tick per mode, the active one raised.
    var ticks = modes.map(function (mode) {
      var tick = el('button.switcher-tick', {
        type: 'button',
        'data-mode': mode.id,
        'aria-label': 'Background: ' + mode.label,
      });
      tick.addEventListener('click', function (e) {
        e.stopPropagation();
        PF.bg.set(mode.id);
      });
      return tick;
    });

    var cycleButton = el('button.switcher-button', {
      type: 'button',
      'aria-label': 'Next background',
    }, label);

    // The shortcut is the real control; the buttons are for people who never
    // find it. Small, muted, and hidden where there is no keyboard.
    var hint = el('span.switcher-hint', { 'aria-hidden': 'true' }, [
      el('kbd.switcher-key', { text: 'B' }),
      el('span', { text: 'switch background' }),
    ]);

    // Screen readers get the mode name and what it is; sighted users get the
    // label and the caption.
    var live = el('span.visually-hidden', { role: 'status', 'aria-live': 'polite' });

    var row = el('div.switcher-row', null, [
      el('span.switcher-ticks', null, ticks),
      cycleButton,
      hint,
    ]);
    var node = el('div.switcher', null, [caption, row, live]);
    mount.appendChild(node);

    var holdTimer = null;
    var hovering = false;

    function showCaption(temporary) {
      node.classList.add('is-showing');
      clearTimeout(holdTimer);
      if (temporary) {
        holdTimer = setTimeout(function () {
          if (!hovering) node.classList.remove('is-showing');
        }, CAPTION_HOLD_MS);
      }
    }

    function sync(spec) {
      label.textContent = spec.label;
      caption.textContent = spec.caption || '';
      live.textContent = 'Background: ' + spec.label + (spec.caption ? '. ' + spec.caption : '');
      for (var i = 0; i < ticks.length; i++) {
        var active = ticks[i].getAttribute('data-mode') === spec.id;
        ticks[i].classList.toggle('is-active', active);
        ticks[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }

    PF.bg.onChange(function (spec) {
      sync(spec);
      showCaption(true);
    });

    cycleButton.addEventListener('click', function () {
      PF.bg.cycle(1);
    });

    node.addEventListener('pointerenter', function () {
      hovering = true;
      showCaption(false);
    });
    node.addEventListener('pointerleave', function () {
      hovering = false;
      showCaption(true);
    });
    node.addEventListener('focusin', function () {
      showCaption(false);
    });
    node.addEventListener('focusout', function () {
      showCaption(true);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Never hijack the key while someone is typing.
      var t = e.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;

      e.preventDefault();
      PF.bg.cycle(e.shiftKey ? -1 : 1);
    });

    var current = PF.bg.current();
    if (current) {
      sync(current);
      // Introduce the opening background once, a moment after the page has
      // settled, so a first-time visitor learns what they are looking at.
      // Not on a phone, where the corner it appears in is also the text.
      if (!window.matchMedia('(max-width: 640px)').matches) {
        setTimeout(function () {
          showCaption(true);
        }, 1400);
      }
    }
  };
})(window.PF);
