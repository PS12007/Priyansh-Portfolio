/* Small shared helpers. Everything hangs off a single global namespace so the
   site runs as plain scripts with no bundler and no module/CORS constraints. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  PF.util = {
    /** True when the visitor has asked the OS to limit animation. */
    reducedMotion: function () {
      return reducedMotionQuery.matches;
    },

    onReducedMotionChange: function (fn) {
      if (reducedMotionQuery.addEventListener) {
        reducedMotionQuery.addEventListener('change', fn);
      } else if (reducedMotionQuery.addListener) {
        reducedMotionQuery.addListener(fn);
      }
    },

    /** Coarse capability check used to size canvas buffers and frame rates. */
    lowPower: function () {
      var cores = navigator.hardwareConcurrency || 4;
      var narrow = window.matchMedia('(max-width: 760px)').matches;
      var coarse = window.matchMedia('(pointer: coarse)').matches;
      return narrow || coarse || cores <= 4;
    },

    clamp: function (v, min, max) {
      return v < min ? min : v > max ? max : v;
    },

    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    /** Smooth Hermite interpolation between two edges. */
    smoothstep: function (edge0, edge1, x) {
      var t = PF.util.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    },

    /** Frame-rate independent easing factor for exponential smoothing. */
    damp: function (rate, dt) {
      return 1 - Math.exp(-rate * dt);
    },

    /** Trailing-edge debounce. */
    debounce: function (fn, wait) {
      var timer = null;
      return function () {
        var args = arguments;
        var self = this;
        clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(self, args);
        }, wait);
      };
    },

    /** Minimal DOM builder: el('a.link', { href: '#' }, 'text'). */
    el: function (spec, attrs, children) {
      var parts = spec.split('.');
      var node = document.createElement(parts.shift() || 'div');
      if (parts.length) node.className = parts.join(' ');

      if (attrs) {
        for (var key in attrs) {
          if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
          var value = attrs[key];
          if (value === null || value === undefined || value === false) continue;
          if (key === 'text') node.textContent = value;
          else if (key === 'html') node.innerHTML = value;
          else node.setAttribute(key, value === true ? '' : value);
        }
      }

      if (children === null || children === undefined) return node;
      var list = Array.isArray(children) ? children : [children];
      for (var i = 0; i < list.length; i++) {
        var child = list[i];
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
      return node;
    },

    /* Per-tab storage: survives a reload, not a new visit. */
    session: {
      get: function (key) {
        try {
          return sessionStorage.getItem(key);
        } catch (e) {
          return null;
        }
      },
      set: function (key, value) {
        try {
          sessionStorage.setItem(key, value);
        } catch (e) {
          /* Private mode or blocked storage — the site works without it. */
        }
      },
    },
  };
})(window.PF);
