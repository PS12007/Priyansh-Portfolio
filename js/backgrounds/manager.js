/* Background manager.
   Owns which mode is live, crossfades between them, keeps the document's
   colour scheme in sync with the active mode, and remembers the choice for
   the rest of the visit.

   Adding a mode is two steps: create the file with a PF.Background subclass
   that registers itself on PF.backgrounds, then add its id to ORDER below. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  /* Cycle order. Light and dark alternate, so stepping through them reads as
     a deliberate sequence rather than a list; with one more light mode than
     dark, Ripples and Bloom meet as the only light pair where the loop comes
     back round to the start. */
  var ORDER = [
    'bloom', 'life', 'prism', 'snake', 'waves', 'horizon', 'starlings',
    'galaxies', 'turing', 'smoke', 'contours', 'petri', 'ripples',
  ];
  var DEFAULT_ID = 'bloom';
  /* Session storage, not local: a reload keeps whatever you switched to, but
     every new visit opens on the default. */
  var STORAGE_KEY = 'pf.background';
  var FADE_MS = 700;

  var root = null;
  var currentId = null;
  var currentLayer = null;
  var currentInstance = null;
  var listeners = [];

  function specFor(id) {
    var spec = PF.backgrounds[id];
    if (!spec) return null;
    if (spec.requires === 'webgl' && !PF.Background.webglAvailable()) return null;
    if (spec.requires === 'webgl-float' && !PF.Background.floatAvailable()) return null;
    return spec;
  }

  function available() {
    var ids = [];
    for (var i = 0; i < ORDER.length; i++) {
      if (specFor(ORDER[i])) ids.push(ORDER[i]);
    }
    return ids;
  }

  function list() {
    return available().map(function (id) {
      var spec = specFor(id);
      return { id: spec.id, label: spec.label, theme: spec.theme, caption: spec.caption };
    });
  }

  function applyTheme(spec) {
    var rootEl = document.documentElement;
    rootEl.dataset.theme = spec.theme;
    rootEl.dataset.bg = spec.id;
    rootEl.style.setProperty('--bg-base', spec.base);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', spec.theme === 'dark' ? '#07080d' : '#f7f4ee');
  }

  function set(id, options) {
    var spec = specFor(id);
    if (!spec) return false;
    if (id === currentId && !(options && options.force)) return false;

    var instant = (options && options.instant) || util.reducedMotion();

    var layer = document.createElement('div');
    layer.className = 'bg-layer';
    layer.style.backgroundColor = spec.base;
    if (!instant) layer.style.opacity = '0';
    root.appendChild(layer);

    var instance;
    try {
      instance = new spec.Ctor(layer, {});
      instance.start();
    } catch (err) {
      // A mode that cannot start (a shader the driver rejects, say) should
      // cost the visitor nothing: drop it and fall back rather than leaving a
      // blank page behind the text.
      if (instance) instance.destroy();
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      delete PF.backgrounds[id];
      if (window.console) console.warn('Background "' + id + '" failed to start:', err);
      return id === DEFAULT_ID ? false : set(DEFAULT_ID, options);
    }

    var outgoingLayer = currentLayer;
    var outgoingInstance = currentInstance;

    currentId = spec.id;
    currentLayer = layer;
    currentInstance = instance;

    applyTheme(spec);
    if (!options || options.persist !== false) util.session.set(STORAGE_KEY, spec.id);

    if (instant) {
      if (outgoingInstance) outgoingInstance.destroy();
      if (outgoingLayer && outgoingLayer.parentNode) outgoingLayer.parentNode.removeChild(outgoingLayer);
    } else {
      // Wait two frames so the incoming mode has painted before it is
      // revealed, otherwise the crossfade shows its flat base colour.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          layer.style.opacity = '1';
          if (outgoingLayer) outgoingLayer.style.opacity = '0';
          setTimeout(function () {
            if (outgoingInstance) outgoingInstance.destroy();
            if (outgoingLayer && outgoingLayer.parentNode) {
              outgoingLayer.parentNode.removeChild(outgoingLayer);
            }
          }, FADE_MS + 60);
        });
      });
    }

    for (var i = 0; i < listeners.length; i++) listeners[i](spec);
    return true;
  }

  function cycle(step) {
    var ids = available();
    var index = ids.indexOf(currentId);
    if (index < 0) index = 0;
    var next = ids[(index + (step || 1) + ids.length * 2) % ids.length];
    set(next);
    return next;
  }

  function init(mountEl) {
    root = mountEl;
    root.style.setProperty('--bg-fade', FADE_MS + 'ms');

    // ?bg=<id> previews a mode without overwriting the stored choice.
    // Handy while iterating on the visual system.
    var override = null;
    try {
      override = new URLSearchParams(window.location.search).get('bg');
    } catch (e) {}

    if (specFor(override)) {
      set(override, { instant: true, persist: false });
    } else {
      var stored = util.session.get(STORAGE_KEY);
      set(specFor(stored) ? stored : DEFAULT_ID, { instant: true });
    }

    // If the visitor flips the OS motion setting, rebuild in the other mode.
    util.onReducedMotionChange(function () {
      set(currentId, { force: true, instant: true });
    });
  }

  PF.bg = {
    init: init,
    set: set,
    cycle: cycle,
    list: list,
    current: function () {
      return specFor(currentId);
    },
    onChange: function (fn) {
      listeners.push(fn);
    },
  };
})(window.PF);
