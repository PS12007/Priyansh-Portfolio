/* The background switcher.
   One rail of dots in the bottom-right corner, one per mode, each tinted
   with that mode's own colours; the live one stretches into a short bar.
   There is no panel and no open state — every mode is one click away at all
   times. Pointing at a dot names the mode and says what it is, just above
   the rail; the label fades back out on its own. B and Shift+B cycle from
   anywhere. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var el = PF.util.el;
  var LABEL_HOLD_MS = 3600;

  PF.initSwitcher = function (mount) {
    var modes = PF.bg.list();
    if (modes.length < 2) return;

    var name = el('span.switcher-name');
    var caption = el('span.switcher-caption');
    var label = el('div.switcher-label', { 'aria-hidden': 'true' }, [name, caption]);

    var rail = el('div.switcher-rail', { role: 'radiogroup', 'aria-label': 'Background' });
    var dots = modes.map(function (mode) {
      var dot = el('button.switcher-dot', {
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': mode.label,
        tabindex: '-1',
        'data-mode': mode.id,
        style: '--swatch: ' + (mode.swatch || 'currentColor'),
      });
      dot.addEventListener('click', function () {
        PF.bg.set(mode.id);
      });
      dot.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch') return;
        show(mode, false);
      });
      rail.appendChild(dot);
      return dot;
    });

    // Screen readers get the mode name and what it is; sighted users get the
    // label above the rail.
    var live = el('span.visually-hidden', { role: 'status', 'aria-live': 'polite' });

    var node = el('div.switcher', null, [label, rail, live]);
    mount.appendChild(node);

    var holdTimer = null;
    var hovering = false;
    var active = PF.bg.current();

    /* The label shows whichever mode is being pointed at, and falls back to
       the live one. `temporary` lets it retire itself after a change made
       from the keyboard, where there is no pointer to leave. */
    function show(mode, temporary) {
      name.textContent = mode.label;
      caption.textContent = mode.caption || '';
      node.classList.add('is-showing');
      clearTimeout(holdTimer);
      if (temporary) {
        holdTimer = setTimeout(function () {
          if (!hovering) node.classList.remove('is-showing');
        }, LABEL_HOLD_MS);
      }
    }

    function hide() {
      clearTimeout(holdTimer);
      node.classList.remove('is-showing');
    }

    /* Back to the live mode, or out of the way entirely once both the
       pointer and focus have left the corner. */
    function restore() {
      if (hovering || node.contains(document.activeElement)) {
        if (active) show(active, false);
      } else {
        hide();
      }
    }

    function sync(spec) {
      active = spec;
      for (var i = 0; i < dots.length; i++) {
        var on = dots[i].getAttribute('data-mode') === spec.id;
        dots[i].setAttribute('aria-checked', on ? 'true' : 'false');
        // Roving tabindex: the rail is one stop, and the live mode is it.
        dots[i].setAttribute('tabindex', on ? '0' : '-1');
      }
      live.textContent = 'Background: ' + spec.label + (spec.caption ? '. ' + spec.caption : '');
    }

    PF.bg.onChange(function (spec) {
      sync(spec);
      show(spec, true);
    });

    // Arrow keys walk the rail and switch as they go, the way a radio group
    // behaves; Home and End jump to the ends.
    rail.addEventListener('keydown', function (e) {
      var at = dots.indexOf(document.activeElement);
      if (at < 0) return;
      var to = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (at + 1) % dots.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (at - 1 + dots.length) % dots.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = dots.length - 1;
      if (to < 0) return;
      e.preventDefault();
      PF.bg.set(modes[to].id);
      dots[to].focus();
    });

    rail.addEventListener('focusin', function (e) {
      var at = dots.indexOf(e.target);
      if (at >= 0) show(modes[at], false);
    });

    // Off a dot but still in the corner: back to naming the live mode.
    rail.addEventListener('pointerleave', restore);

    node.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      hovering = true;
      restore();
    });
    node.addEventListener('pointerleave', function () {
      hovering = false;
      restore();
    });
    node.addEventListener('focusout', function (e) {
      if (!node.contains(e.relatedTarget)) restore();
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

    if (active) {
      sync(active);
      name.textContent = active.label;
      caption.textContent = active.caption || '';
      // Introduce the opening background once, a moment after the page has
      // settled, so a first-time visitor learns what they are looking at.
      // Not on a phone, where the corner it appears in is also the text.
      if (!window.matchMedia('(max-width: 640px)').matches) {
        setTimeout(function () {
          show(active, true);
        }, 1400);
      }
    }
  };
})(window.PF);
