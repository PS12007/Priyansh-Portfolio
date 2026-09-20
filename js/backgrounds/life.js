/* LIFE — Conway's Game of Life, rendered as luminous cells on near-black.

   Three things separate this from a screensaver:

   1. Cells fade in and out rather than popping. The simulation steps about
      nine times a second, but every frame eases a per-cell brightness toward
      the current state, so dying cells leave a short afterglow.
   2. Cells are coloured by age — newborns are near-white cyan, survivors
      settle into deep blue. The result is that gliders and active fronts read
      brightly while stable debris recedes.
   3. Left alone, Life stalls into still lifes and blinkers within a minute.
      A patch of fresh noise is sown periodically, and again whenever the
      population collapses, so the field never goes static.

   Moving the cursor sows cells under it. */
window.PF = window.PF || {};

(function (PF) {
  'use strict';

  var util = PF.util;

  var BASE_RGB = [7, 8, 13];
  var BASE = 'rgb(7, 8, 13)';

  var STEP_SECONDS = 0.11;   // simulation rate, independent of frame rate
  var FADE_RATE = 13;        // how fast a cell's brightness chases its state
  var SEED_DENSITY = 0.17;
  var AGE_CAP = 24;          // generations until a cell reaches its final hue
  var MAX_LEVEL = 0.92;

  var WARMUP_STEPS = 44;
  var STEPS_BETWEEN_SOWINGS = 52;
  var COLLAPSE_FRACTION = 0.02;

  // Newborn -> settled colour ramp.
  var NEW_RGB = [198, 240, 255];
  var OLD_RGB = [72, 96, 214];

  class Life extends PF.Background {
    static options = {
      fps: 30,
      mode: 'fixed',
      maxDim: 190,
      smoothing: false,
      pixelated: true,
      staticTime: 0,
      budget: 9,
    };

    init() {
      this.acc = 0;
      this.stepsSinceSowing = 0;
    }

    resized() {
      var n = this.w * this.h;
      this.image = this.ctx.createImageData(this.w, this.h);
      this.data = this.image.data;

      this.cur = new Uint8Array(n);
      this.next = new Uint8Array(n);
      this.age = new Uint8Array(n);
      this.level = new Float32Array(n);

      this.acc = 0;
      this.stepsSinceSowing = 0;
      this.sow(0, 0, this.w, this.h, SEED_DENSITY);

      // Raw random soup looks like television static. Running it forward
      // before the first paint lets it collapse into the gliders, blinkers
      // and still lifes that actually read as Life.
      for (var i = 0; i < WARMUP_STEPS; i++) this.step();
      this.stepsSinceSowing = 0;
      this.level.set(this.cur);
    }

    /** Sprinkle live cells into a rectangular region. */
    sow(x0, y0, x1, y1, density) {
      var w = this.w;
      var cur = this.cur;
      var age = this.age;
      for (var y = y0; y < y1; y++) {
        var row = y * w;
        for (var x = x0; x < x1; x++) {
          if (Math.random() < density) {
            cur[row + x] = 1;
            age[row + x] = 0;
          }
        }
      }
    }

    /** One generation, on a wrapping (toroidal) grid. */
    step() {
      var w = this.w;
      var h = this.h;
      var cur = this.cur;
      var next = this.next;
      var age = this.age;
      var alive = 0;

      for (var y = 0; y < h; y++) {
        var rowY = y * w;
        var rowU = (y === 0 ? h - 1 : y - 1) * w;
        var rowD = (y === h - 1 ? 0 : y + 1) * w;

        for (var x = 0; x < w; x++) {
          var xL = x === 0 ? w - 1 : x - 1;
          var xR = x === w - 1 ? 0 : x + 1;

          var n =
            cur[rowU + xL] + cur[rowU + x] + cur[rowU + xR] +
            cur[rowY + xL] + cur[rowY + xR] +
            cur[rowD + xL] + cur[rowD + x] + cur[rowD + xR];

          var i = rowY + x;
          var was = cur[i];
          var now = was ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);

          next[i] = now;
          if (now) {
            alive++;
            // Newly born cells restart the age ramp; survivors keep ageing.
            age[i] = was ? (age[i] < AGE_CAP ? age[i] + 1 : AGE_CAP) : 0;
          }
        }
      }

      // Swap the buffers rather than copying.
      this.cur = next;
      this.next = cur;

      this.stepsSinceSowing++;
      var total = w * h;

      if (alive < total * COLLAPSE_FRACTION) {
        // The field has died back — restart it properly.
        this.sow(0, 0, w, h, SEED_DENSITY);
        this.stepsSinceSowing = 0;
      } else if (this.stepsSinceSowing >= STEPS_BETWEEN_SOWINGS) {
        // Routine top-up: one random patch, enough to disturb the still lifes.
        var pw = Math.max(8, Math.round(w * 0.22));
        var ph = Math.max(8, Math.round(h * 0.22));
        var px = Math.floor(Math.random() * (w - pw));
        var py = Math.floor(Math.random() * (h - ph));
        this.sow(px, py, px + pw, py + ph, 0.3);
        this.stepsSinceSowing = 0;
      }
    }

    /** The cursor sows a soft cloud of cells beneath it. */
    sowAtCursor() {
      var pointer = PF.pointer;
      if (pointer.strength < 0.25) return;

      var w = this.w;
      var h = this.h;
      var cx = Math.round(pointer.x * w);
      var cy = Math.round(pointer.y * h);
      var r = Math.max(2, Math.round(w * 0.022));

      var cur = this.cur;
      var age = this.age;

      for (var dy = -r; dy <= r; dy++) {
        var y = cy + dy;
        if (y < 0 || y >= h) continue;
        for (var dx = -r; dx <= r; dx++) {
          var x = cx + dx;
          if (x < 0 || x >= w) continue;
          if (dx * dx + dy * dy > r * r) continue;
          if (Math.random() < 0.16 * pointer.strength) {
            cur[y * w + x] = 1;
            age[y * w + x] = 0;
          }
        }
      }
    }

    frame(t, dt) {
      var w = this.w;
      var h = this.h;

      if (dt > 0) {
        this.acc += dt;
        // Cap the catch-up so returning to the tab never runs a burst of
        // generations in one frame.
        var budget = 3;
        while (this.acc >= STEP_SECONDS && budget-- > 0) {
          this.acc -= STEP_SECONDS;
          this.sowAtCursor();
          this.step();
        }
        if (this.acc >= STEP_SECONDS) this.acc = 0;
      }

      var cur = this.cur;
      var age = this.age;
      var level = this.level;
      var data = this.data;

      // dt === 0 is the reduced-motion single frame: snap, do not ease.
      var k = dt > 0 ? util.damp(FADE_RATE, dt) : 1;

      var baseR = BASE_RGB[0], baseG = BASE_RGB[1], baseB = BASE_RGB[2];
      var newR = NEW_RGB[0], newG = NEW_RGB[1], newB = NEW_RGB[2];
      var oldR = OLD_RGB[0], oldG = OLD_RGB[1], oldB = OLD_RGB[2];

      var i = 0;
      var p = 0;

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++, p++) {
          var target = cur[p];
          var lv = level[p] + (target - level[p]) * k;
          if (lv < 0.004) lv = 0;
          level[p] = lv;

          // Cells live everywhere, text included. Legibility comes from the
          // halo the type carries, not from holes cut in the field.
          if (lv > 0) {
            var a = lv * MAX_LEVEL;

            var g = age[p] / AGE_CAP;
            if (g > 1) g = 1;
            var cr = newR + (oldR - newR) * g;
            var cg = newG + (oldG - newG) * g;
            var cb = newB + (oldB - newB) * g;

            data[i] = baseR + (cr - baseR) * a;
            data[i + 1] = baseG + (cg - baseG) * a;
            data[i + 2] = baseB + (cb - baseB) * a;
          } else {
            data[i] = baseR;
            data[i + 1] = baseG;
            data[i + 2] = baseB;
          }
          data[i + 3] = 255;
          i += 4;
        }
      }

      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  PF.backgrounds = PF.backgrounds || {};
  PF.backgrounds.life = {
    id: 'life',
    label: 'Life',
    caption: 'Conway’s Game of Life. Move the cursor to sow cells.',
    swatch: 'radial-gradient(circle at 35% 35%, #c6f0ff, #4860d6 70%)',
    theme: 'dark',
    base: BASE,
    Ctor: Life,
  };
})(window.PF);
