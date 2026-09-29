/* CONTOURS — a topographic map of terrain that will not sit still.

   A height field (two octaves of simplex noise, drifting slowly through its
   third axis) is sampled on a coarse grid, and marching squares traces where
   it crosses each of a couple of dozen evenly spaced heights. Every fifth
   line is an index contour, drawn heavier, the way survey maps do it.

   The cursor is a hill: the lines gather into rings around it and let go as
   it leaves. A click pushes up a new peak that settles back into the ground
   over a few seconds. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE = 'rgb(242, 239, 231)';
  var MINOR = 'rgba(92, 72, 52, 0.26)';
  var INDEX = 'rgba(92, 72, 52, 0.55)';

  var STEP = 0.075;          // height between neighbouring contours
  var INDEX_EVERY = 5;
  var SCALE = 1 / 420;       // noise frequency, per CSS pixel
  var DRIFT = 0.022;         // how fast the terrain evolves

  var HILL_HEIGHT = 0.5;
  var HILL_RADIUS = 150;
  var PEAK_HEIGHT = 0.75;
  var PEAK_RADIUS = 110;
  var PEAK_LIFE = 6;         // seconds for a clicked peak to settle
  var MAX_PEAKS = 8;

  /* Marching squares: for each of the 16 corner cases, the pairs of cell
     edges the line joins. Edges are 0 top, 1 right, 2 bottom, 3 left.
     The two saddle cases (5 and 10) get two segments. */
  var SEGMENTS = [
    [], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0],
    [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], [],
  ];

  class Contours extends PF.Background {
    static options = {
      fps: 30,
      mode: 'dpr',
      dprCap: 2,
      smoothing: true,
      staticTime: 40,
      budget: 12,
    };

    init() {
      this.noise = PF.createNoise(7331);
      this.peaks = [];
      this.offTap = PF.pointer.onTap(this.raise.bind(this));
    }

    teardown() {
      if (this.offTap) this.offTap();
    }

    resized() {
      this.grid = this.cssW < 700 || util.lowPower() ? 14 : 11;
      this.cols = Math.ceil(this.cssW / this.grid) + 1;
      this.rows = Math.ceil(this.cssH / this.grid) + 1;
      this.field = new Float32Array(this.cols * this.rows);
    }

    raise(x, y) {
      if (this.peaks.length >= MAX_PEAKS) this.peaks.shift();
      this.peaks.push({ x: x, y: y, born: this.time });
      if (!this.running) this.frame(this.time, 0);
    }

    /** Sample the terrain, plus the cursor's hill and any clicked peaks. */
    sample(t) {
      var cols = this.cols;
      var rows = this.rows;
      var g = this.grid;
      var field = this.field;
      var noise = this.noise;
      var z = t * DRIFT;

      var pointer = PF.pointer;
      var hill = HILL_HEIGHT * pointer.strength;
      var hx = pointer.x * this.cssW;
      var hy = pointer.y * this.cssH;
      var hr = 1 / (2 * HILL_RADIUS * HILL_RADIUS);

      var bumps = [];
      if (hill > 0.01) bumps.push({ x: hx, y: hy, a: hill, k: hr });
      var live = [];
      for (var p = 0; p < this.peaks.length; p++) {
        var pk = this.peaks[p];
        var age = this.time - pk.born;
        if (age > PEAK_LIFE) continue;
        live.push(pk);
        // Rises quickly, then sinks back slowly.
        var rise = 1 - Math.pow(1 - util.clamp(age / 0.9, 0, 1), 3);
        var fall = 1 - util.smoothstep(0.25 * PEAK_LIFE, PEAK_LIFE, age);
        bumps.push({ x: pk.x, y: pk.y, a: PEAK_HEIGHT * rise * fall, k: 1 / (2 * PEAK_RADIUS * PEAK_RADIUS) });
      }
      this.peaks = live;

      var i = 0;
      for (var r = 0; r < rows; r++) {
        var y = r * g;
        for (var c = 0; c < cols; c++) {
          var x = c * g;
          var v =
            noise.noise3(x * SCALE, y * SCALE, z) * 0.72 +
            noise.noise3(x * SCALE * 2.3 + 17, y * SCALE * 2.3, z * 1.6) * 0.28;
          for (var b = 0; b < bumps.length; b++) {
            var dx = x - bumps[b].x;
            var dy = y - bumps[b].y;
            v += bumps[b].a * Math.exp(-(dx * dx + dy * dy) * bumps[b].k);
          }
          field[i++] = v;
        }
      }
    }

    frame(t) {
      this.sample(t);

      var ctx = this.ctx;
      var s = this.scale;
      this.clear(BASE);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var minor = new Path2D();
      var index = new Path2D();

      var cols = this.cols;
      var g = this.grid;
      var field = this.field;

      for (var r = 0; r < this.rows - 1; r++) {
        var y0 = r * g;
        for (var c = 0; c < cols - 1; c++) {
          var i = r * cols + c;
          var v0 = field[i];            // top left
          var v1 = field[i + 1];        // top right
          var v2 = field[i + cols + 1]; // bottom right
          var v3 = field[i + cols];     // bottom left

          var lo = Math.min(v0, v1, v2, v3);
          var hi = Math.max(v0, v1, v2, v3);
          var first = Math.ceil(lo / STEP);
          var last = Math.floor(hi / STEP);
          if (first > last) continue;

          var x0 = c * g;
          for (var n = first; n <= last; n++) {
            var L = n * STEP;
            var kase = (v0 > L ? 8 : 0) | (v1 > L ? 4 : 0) | (v2 > L ? 2 : 0) | (v3 > L ? 1 : 0);
            var seg = SEGMENTS[kase];
            if (!seg.length) continue;
            var path = n % INDEX_EVERY === 0 ? index : minor;

            for (var e = 0; e < seg.length; e += 2) {
              for (var end = 0; end < 2; end++) {
                var edge = seg[e + end];
                var px, py;
                if (edge === 0) {
                  px = x0 + (g * (L - v0)) / (v1 - v0);
                  py = y0;
                } else if (edge === 1) {
                  px = x0 + g;
                  py = y0 + (g * (L - v1)) / (v2 - v1);
                } else if (edge === 2) {
                  px = x0 + (g * (L - v3)) / (v2 - v3);
                  py = y0 + g;
                } else {
                  px = x0;
                  py = y0 + (g * (L - v0)) / (v3 - v0);
                }
                if (end === 0) path.moveTo(px, py);
                else path.lineTo(px, py);
              }
            }
          }
        }
      }

      ctx.strokeStyle = MINOR;
      ctx.lineWidth = 0.8;
      ctx.stroke(minor);
      ctx.strokeStyle = INDEX;
      ctx.lineWidth = 1.3;
      ctx.stroke(index);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.contours = {
    id: 'contours',
    label: 'Contours',
    caption: 'A topographic map of drifting terrain, traced with marching squares. Your cursor is a hill; click to raise a peak.',
    theme: 'light',
    base: BASE,
    Ctor: Contours,
  };
})(window.PF);
