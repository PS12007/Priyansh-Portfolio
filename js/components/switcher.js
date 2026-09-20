/* The background switcher.
   A small, quiet control in the bottom-right corner: a swatch, the current
   mode's name and its place in the cycle, with arrows either side. At rest
   it sits back at part opacity; hovering brings it forward, along with a
   line saying what the background actually is. Clicking the name opens the
   full list, each mode with its own swatch, and pointing at one previews
   its description before you commit. B and Shift+B cycle from anywhere. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var el = PF.util.el;
  var CAPTION_HOLD_MS = 4200;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function chevron(dir) {
    return el('button.switcher-step.is-' + dir, {
      type: 'button',
      'aria-label': dir === 'prev' ? 'Previous background' : 'Next background',
    }, el('span.switcher-chevron', { 'aria-hidden': 'true' }));
  }

  PF.initSwitcher = function (mount) {
    var modes = PF.bg.list();
    if (modes.length < 2) return;

    var caption = el('p.switcher-caption', { 'aria-hidden': 'true' });
    var swatch = el('span.switcher-swatch', { 'aria-hidden': 'true' });
    var name = el('span.switcher-name');
    var count = el('span.switcher-count', { 'aria-hidden': 'true' });
    var current = el('button.switcher-current', {
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-controls': 'switcher-menu',
    }, [swatch, name, count]);
    var prev = chevron('prev');
    var next = chevron('next');

    var options = modes.map(function (mode, i) {
      var option = el('button.switcher-option', {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': 'false',
        'data-mode': mode.id,
        style: '--d: ' + (modes.length - 1 - i),
      }, [
        el('span.switcher-option-index', { 'aria-hidden': 'true', text: pad2(i + 1) }),
        el('span.switcher-option-name', { text: mode.label }),
        el('span.switcher-swatch', { 'aria-hidden': 'true', style: '--swatch: ' + (mode.swatch || 'currentColor') }),
      ]);
      option.addEventListener('click', function () {
        PF.bg.set(mode.id);
      });
      option.addEventListener('pointerenter', function () {
        preview(mode);
      });
      option.addEventListener('focus', function () {
        preview(mode);
      });
      return option;
    });

    // The shortcut is the real control; the buttons are for people who
    // never find it. Hidden where there is no keyboard.
    var hint = el('p.switcher-hint', { 'aria-hidden': 'true' }, [
      el('kbd.switcher-key', { text: 'B' }),
      el('span', { text: 'next' }),
      el('kbd.switcher-key', { text: '⇧B' }),
      el('span', { text: 'back' }),
    ]);

    var menu = el('div.switcher-menu', { id: 'switcher-menu', role: 'menu', 'aria-label': 'Backgrounds' }, options.concat([hint]));
    var bar = el('div.switcher-bar', null, [prev, current, next]);

    // Screen readers get the mode name and what it is; sighted users get the
    // label and the caption.
    var live = el('span.visually-hidden', { role: 'status', 'aria-live': 'polite' });

    var node = el('div.switcher', null, [menu, caption, bar, live]);
    mount.appendChild(node);

    var holdTimer = null;
    var hovering = false;
    var open = false;
    var active = PF.bg.current();

    function showCaption(temporary) {
      node.classList.add('is-showing');
      clearTimeout(holdTimer);
      if (temporary) {
        holdTimer = setTimeout(function () {
          if (!hovering && !open) node.classList.remove('is-showing');
        }, CAPTION_HOLD_MS);
      }
    }

    function preview(mode) {
      caption.textContent = mode.caption || '';
      showCaption(false);
    }

    function restoreCaption() {
      if (active) caption.textContent = active.caption || '';
    }

    function setOpen(value, focusActive) {
      open = value;
      // The caption moves up to sit above the list while it is open.
      if (open) node.style.setProperty('--menu-h', menu.offsetHeight + 'px');
      node.classList.toggle('is-open', open);
      document.documentElement.classList.toggle('is-choosing-background', open);
      current.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        showCaption(false);
        if (focusActive) {
          var on = menu.querySelector('[aria-checked="true"]') || options[0];
          on.focus();
        }
      } else {
        restoreCaption();
        showCaption(true);
      }
    }

    function sync(spec) {
      active = spec;
      var index = 0;
      for (var i = 0; i < modes.length; i++) if (modes[i].id === spec.id) index = i;
      name.textContent = spec.label;
      count.textContent = pad2(index + 1) + '/' + pad2(modes.length);
      swatch.style.setProperty('--swatch', modes[index].swatch || 'currentColor');
      caption.textContent = spec.caption || '';
      live.textContent = 'Background: ' + spec.label + (spec.caption ? '. ' + spec.caption : '');
      for (i = 0; i < options.length; i++) {
        options[i].setAttribute('aria-checked', options[i].getAttribute('data-mode') === spec.id ? 'true' : 'false');
      }
    }

    PF.bg.onChange(function (spec) {
      sync(spec);
      showCaption(true);
    });

    current.addEventListener('click', function (e) {
      // A keyboard press lands focus in the list; a click leaves it be.
      setOpen(!open, e.detail === 0);
    });
    prev.addEventListener('click', function () {
      PF.bg.cycle(-1);
    });
    next.addEventListener('click', function () {
      PF.bg.cycle(1);
    });

    menu.addEventListener('pointerleave', restoreCaption);
    menu.addEventListener('focusout', function (e) {
      if (!menu.contains(e.relatedTarget)) restoreCaption();
    });

    // Arrow keys walk the list; Escape closes it and hands focus back.
    menu.addEventListener('keydown', function (e) {
      var at = options.indexOf(document.activeElement);
      var to = -1;
      if (e.key === 'ArrowDown') to = (at + 1) % options.length;
      else if (e.key === 'ArrowUp') to = (at - 1 + options.length) % options.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = options.length - 1;
      if (to >= 0) {
        e.preventDefault();
        options[to].focus();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        current.focus();
      }
    });

    // Anywhere else on the page closes the list.
    document.addEventListener('pointerdown', function (e) {
      if (open && !node.contains(e.target)) setOpen(false);
    });

    node.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      hovering = true;
      showCaption(false);
    });
    node.addEventListener('pointerleave', function () {
      hovering = false;
      if (!open) showCaption(true);
    });
    node.addEventListener('focusin', function () {
      showCaption(false);
    });
    node.addEventListener('focusout', function (e) {
      if (!node.contains(e.relatedTarget)) {
        if (open) setOpen(false);
        showCaption(true);
      }
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
